package relay

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/helper"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/price"
	"github.com/zkk520/uni-router/internal/relay/bodycache"
	"github.com/zkk520/uni-router/internal/server/resp"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
	"github.com/zkk520/uni-router/internal/utils/log"
)

const imagesUpstreamErrorBodyLimit = 16 * 1024

// ImagesHandler 是 OpenAI Images API 的统一 relay 入口。
// endpoint 形如：/images/generations、/images/edits、/images/variations（不含 /v1 前缀）。
func ImagesHandler(endpoint string, c *gin.Context) {
	ctx := c.Request.Context()

	apiKeyID := c.GetInt("api_key_id")

	// 缓存请求体，支持多次重试重放
	bc, err := bodycache.New(c.Request.Body)
	if err != nil {
		var tooLarge *bodycache.BodyTooLargeError
		if errors.As(err, &tooLarge) {
			resp.Error(c, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer func() {
		if cerr := bc.Close(); cerr != nil {
			log.Warnf("failed to close images body cache: %v", cerr)
		}
	}()

	contentType := c.GetHeader("Content-Type")
	isMultipart := strings.Contains(strings.ToLower(contentType), "multipart/form-data")

	// 解析 requestModel 与 stream（严格模式：model 必填）
	var (
		requestModel string
		stream       bool
		boundary     string
		jsonPayload  map[string]any
	)
	if isMultipart {
		_, params, perr := mime.ParseMediaType(contentType)
		if perr != nil {
			resp.Error(c, http.StatusBadRequest, "invalid multipart content-type")
			return
		}
		boundary = strings.TrimSpace(params["boundary"])
		if boundary == "" {
			resp.Error(c, http.StatusBadRequest, "invalid multipart boundary")
			return
		}
		m, s, perr := parseMultipartModelAndStream(bc, boundary)
		if perr != nil {
			resp.Error(c, http.StatusBadRequest, perr.Error())
			return
		}
		requestModel = m
		stream = s
	} else {
		payload, m, s, perr := parseJSONModelAndStream(bc)
		if perr != nil {
			resp.Error(c, http.StatusBadRequest, perr.Error())
			return
		}
		jsonPayload = payload
		requestModel = m
		stream = s
	}

	apiKey, err := op.APIKeyGet(apiKeyID, ctx)
	if err != nil || apiKey.RouterID <= 0 {
		resp.Error(c, http.StatusBadRequest, "API key must be bound to a router")
		return
	}
	routeDetail, err := op.RouteProfileGet(apiKey.RouterID, ctx)
	if err != nil || len(routeDetail.Endpoints) == 0 {
		resp.Error(c, http.StatusServiceUnavailable, "router not available")
		return
	}
	route := routeDetail.RouteProfile
	candidates := op.RouteSelectCandidates(route)
	if len(candidates) == 0 {
		resp.Error(c, http.StatusServiceUnavailable, "no available endpoint")
		return
	}

	// 初始化 Metrics（Images 独立，避免 b64_json 内存膨胀）
	metrics := newImagesRelayMetrics(apiKeyID, requestModel)
	metrics.RouterID = route.ID
	metrics.RouterName = route.Name
	metrics.RequestContent = buildImagesRequestContentForLog(isMultipart, bc, jsonPayload)

	var lastErr error
	var attempts []model.ChannelAttempt
	attemptNum := 0

	for idx, ep := range candidates {
		select {
		case <-ctx.Done():
			log.Infof("request context canceled, stopping retry")
			metrics.Save(ctx, false, context.Canceled, attempts)
			return
		default:
		}

		channel, usedKey, err := op.RouteCandidateValidate(ep, ctx)
		if err != nil {
			attemptNum++
			attempts = append(attempts, model.ChannelAttempt{
				ChannelID:    ep.ChannelID,
				ChannelKeyID: ep.ChannelKeyID,
				ChannelName:  fmt.Sprintf("channel_%d", ep.ChannelID),
				EndpointID:   ep.ID,
				EndpointName: ep.Name,
				ModelName:    requestModel,
				AttemptNum:   attemptNum,
				Status:       model.AttemptSkipped,
				Msg:          err.Error(),
			})
			lastErr = err
			continue
		}

		keyType := model.EffectiveChannelKeyType(*channel, usedKey)
		// keyType 限制：仅 OpenAI 兼容图片接口类型。
		if !isImagesKeyTypeSupported(keyType) {
			msg := fmt.Sprintf("unsupported channel key type: %d", keyType)
			attemptNum++
			attempts = append(attempts, model.ChannelAttempt{
				ChannelID:    channel.ID,
				ChannelKeyID: usedKey.ID,
				ChannelName:  channel.Name,
				EndpointID:   ep.ID,
				EndpointName: ep.Name,
				ModelName:    requestModel,
				AttemptNum:   attemptNum,
				Status:       model.AttemptSkipped,
				Msg:          msg,
			})
			lastErr = fmt.Errorf("%s", msg)
			continue
		}

		log.Infof("router %s forwarding images model %s to endpoint %s/channel %s (attempt %d/%d, stream=%t)",
			route.Name, requestModel, ep.Name, channel.Name, idx+1, len(candidates), stream)

		attemptNum++
		start := time.Now()
		attempt := model.ChannelAttempt{
			ChannelID:    channel.ID,
			ChannelKeyID: usedKey.ID,
			ChannelName:  channel.Name,
			EndpointID:   ep.ID,
			EndpointName: ep.Name,
			ModelName:    requestModel,
			AttemptNum:   attemptNum,
		}

		// 尝试一次转发
		statusCode, written, usage, upstreamCT, fwdErr := imagesAttempt(ctx, endpoint, c, bc, isMultipart, boundary, jsonPayload, stream, channel, keyType, usedKey.ChannelKey, 0, metrics)

		// 更新 channel key 状态
		usedKey.StatusCode = statusCode
		usedKey.LastUseTimeStamp = time.Now().Unix()

		if fwdErr == nil {
			// ====== 成功 ======
			metrics.ActualModel = requestModel
			metrics.EndpointID = ep.ID
			metrics.EndpointName = ep.Name
			metrics.SetPricingContext(channel, usedKey)
			if usage != nil {
				metrics.SetUsageFromImages(requestModel, *usage)
			}
			metrics.ResponseContent = buildImagesResponseContentForLog(stream, upstreamCT, usage)

			usedKey.TotalCost += metrics.Stats.InputCost + metrics.Stats.OutputCost
			op.ChannelKeyUpdate(usedKey)

			attempt.Status = model.AttemptSuccess
			attempt.Duration = int(time.Since(start).Milliseconds())
			attempts = append(attempts, attempt)
			_ = op.RouteEndpointMarkStatus(ep.ID, model.RouteEndpointStatusNormal, "", ctx)

			metrics.Save(ctx, true, nil, attempts)
			return
		}

		// ====== 失败 ======
		op.ChannelKeyUpdate(usedKey)
		attempt.Status = model.AttemptFailed
		attempt.Duration = int(time.Since(start).Milliseconds())
		attempt.Msg = fwdErr.Error()
		attempts = append(attempts, attempt)
		if shouldTripRouteEndpoint(statusCode, fwdErr) {
			_ = op.RouteEndpointMarkStatus(ep.ID, model.RouteEndpointStatusError, fwdErr.Error(), ctx)
		}

		if written || c.Writer.Written() {
			metrics.Save(ctx, false, fwdErr, attempts)
			return
		}
		if !route.FailoverEnabled {
			metrics.Save(ctx, false, fwdErr, attempts)
			resp.Error(c, http.StatusBadGateway, fwdErr.Error())
			return
		}

		lastErr = fmt.Errorf("channel %s failed: %v", channel.Name, fwdErr)
	}

	// 所有通道都失败
	metrics.Save(ctx, false, lastErr, attempts)
	resp.Error(c, http.StatusBadGateway, "all channels failed")
}

func isImagesKeyTypeSupported(keyType outbound.OutboundType) bool {
	return keyType == outbound.OutboundTypeOpenAIChat ||
		keyType == outbound.OutboundTypeOpenAIResponse ||
		keyType == outbound.OutboundTypeNewAPIChat
}

func imagesUpstreamURL(baseURL, endpoint string, keyType outbound.OutboundType) (*url.URL, error) {
	normalizedBaseURL, err := outbound.NormalizeBaseURL(baseURL, keyType)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize base url: %w", err)
	}
	parsedURL, err := url.Parse(strings.TrimSuffix(normalizedBaseURL, "/"))
	if err != nil {
		return nil, fmt.Errorf("failed to parse base url: %w", err)
	}
	parsedURL.Path += endpoint
	return parsedURL, nil
}

type imagesUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

type imagesRelayMetrics struct {
	APIKeyID       int
	RequestModel   string
	ActualModel    string
	RouterID       int
	RouterName     string
	EndpointID     int
	EndpointName   string
	PricingChannel *model.Channel
	PricingKey     *model.ChannelKey
	PricingInfo    model.PricingInfo
	StartTime      time.Time
	FirstToken     time.Time

	Stats model.StatsMetrics

	RequestContent  string
	ResponseContent string
}

func newImagesRelayMetrics(apiKeyID int, requestModel string) *imagesRelayMetrics {
	return &imagesRelayMetrics{
		APIKeyID:     apiKeyID,
		RequestModel: requestModel,
		StartTime:    time.Now(),
	}
}

func (m *imagesRelayMetrics) SetFirstTokenTime(t time.Time) {
	if m.FirstToken.IsZero() {
		m.FirstToken = t
	}
}

func (m *imagesRelayMetrics) SetPricingContext(channel *model.Channel, key model.ChannelKey) {
	m.PricingChannel = channel
	pricingKey := key
	m.PricingKey = &pricingKey
}

func (m *imagesRelayMetrics) SetUsageFromImages(actualModel string, u imagesUsage) {
	m.ActualModel = actualModel
	m.Stats.InputToken = int64(u.InputTokens)
	m.Stats.OutputToken = int64(u.OutputTokens)

	resolvedPrice := price.ResolveLLMPrice(actualModel, m.PricingChannel, m.PricingKey)
	if resolvedPrice == nil {
		return
	}
	modelPrice := resolvedPrice.Price
	m.PricingInfo = resolvedPrice.Info

	m.Stats.InputCost = float64(u.InputTokens) * modelPrice.Input * 1e-6
	m.Stats.OutputCost = float64(u.OutputTokens) * modelPrice.Output * 1e-6
	m.Stats.AddCurrencyCosts(m.PricingInfo, m.Stats.InputCost, m.Stats.OutputCost)
}

func (m *imagesRelayMetrics) Save(ctx context.Context, success bool, err error, attempts []model.ChannelAttempt) {
	duration := time.Since(m.StartTime)

	globalStats := model.StatsMetrics{
		WaitTime:             duration.Milliseconds(),
		InputToken:           m.Stats.InputToken,
		OutputToken:          m.Stats.OutputToken,
		InputCost:            m.Stats.InputCost,
		OutputCost:           m.Stats.OutputCost,
		InputCostByCurrency:  m.Stats.InputCostByCurrency,
		OutputCostByCurrency: m.Stats.OutputCostByCurrency,
		TotalCostByCurrency:  m.Stats.TotalCostByCurrency,
	}
	if success {
		globalStats.RequestSuccess = 1
	} else {
		globalStats.RequestFailed = 1
	}

	channelID, channelName := finalChannel(attempts)
	op.StatsTotalUpdate(globalStats)
	op.StatsHourlyUpdate(globalStats)
	op.StatsDailyUpdate(context.Background(), globalStats)
	op.StatsAPIKeyUpdate(m.APIKeyID, globalStats)
	op.StatsChannelUpdate(channelID, globalStats)
	if m.PricingKey != nil && m.PricingKey.ID > 0 {
		op.StatsChannelKeyUpdate(m.PricingKey.ID, globalStats)
	}
	actualModel := m.ActualModel
	if actualModel == "" {
		actualModel = m.RequestModel
	}
	if success && actualModel != "" {
		op.StatsModelUpdate(model.StatsModel{
			Name:         actualModel,
			ChannelID:    channelID,
			StatsMetrics: globalStats,
		})
	}

	log.Infof("images relay complete: model=%s, channel=%d(%s), success=%t, duration=%dms, input_token=%d, output_token=%d, input_cost=%f, output_cost=%f, total_cost=%f, attempts=%d",
		m.RequestModel, channelID, channelName, success, duration.Milliseconds(),
		m.Stats.InputToken, m.Stats.OutputToken,
		m.Stats.InputCost, m.Stats.OutputCost, m.Stats.InputCost+m.Stats.OutputCost,
		len(attempts))

	m.saveLog(ctx, err, duration, attempts, channelID, channelName)
}

func (m *imagesRelayMetrics) saveLog(ctx context.Context, err error, duration time.Duration, attempts []model.ChannelAttempt, channelID int, channelName string) {
	actualModel := m.ActualModel
	if actualModel == "" {
		actualModel = m.RequestModel
	}

	relayLog := model.RelayLog{
		Time:                 m.StartTime.Unix(),
		RequestModelName:     m.RequestModel,
		RouterID:             m.RouterID,
		RouterName:           m.RouterName,
		EndpointID:           m.EndpointID,
		EndpointName:         m.EndpointName,
		ChannelKeyID:         channelKeyIDFromPricingKey(m.PricingKey),
		ChannelName:          channelName,
		ChannelId:            channelID,
		ActualModelName:      actualModel,
		UseTime:              int(duration.Milliseconds()),
		Attempts:             attempts,
		TotalAttempts:        len(attempts),
		RequestContent:       m.RequestContent,
		ResponseContent:      m.ResponseContent,
		CostCurrency:         m.PricingInfo.Currency,
		CostCurrencySymbol:   m.PricingInfo.CurrencySymbol,
		PricingMultiplier:    m.PricingInfo.Multiplier,
		PricingUnit:          m.PricingInfo.Unit,
		PricingRuleSource:    m.PricingInfo.RuleSource,
		InputCostByCurrency:  m.Stats.InputCostByCurrency,
		OutputCostByCurrency: m.Stats.OutputCostByCurrency,
		TotalCostByCurrency:  m.Stats.TotalCostByCurrency,
	}

	if apiKey, getErr := op.APIKeyGet(m.APIKeyID, ctx); getErr == nil {
		relayLog.RequestAPIKeyName = apiKey.Name
	}

	// 首字时间
	if !m.FirstToken.IsZero() {
		relayLog.Ftut = int(m.FirstToken.Sub(m.StartTime).Milliseconds())
	}

	// Usage
	if m.Stats.InputToken > 0 || m.Stats.OutputToken > 0 {
		relayLog.InputTokens = int(m.Stats.InputToken)
		relayLog.OutputTokens = int(m.Stats.OutputToken)
		relayLog.Cost = m.Stats.InputCost + m.Stats.OutputCost
	}

	if err != nil {
		relayLog.Error = err.Error()
	}

	if logErr := op.RelayLogAdd(ctx, relayLog); logErr != nil {
		log.Warnf("failed to save relay log: %v", logErr)
	}
}

func buildImagesRequestContentForLog(isMultipart bool, bc *bodycache.BodyCache, jsonPayload map[string]any) string {
	if isMultipart {
		// multipart 可能包含图片文件，避免落库
		return fmt.Sprintf(`{"content_type":"multipart/form-data","size_bytes":%d,"note":"multipart request content omitted for storage"}`, bc.Size())
	}
	if jsonPayload == nil {
		return ""
	}
	b, err := json.Marshal(jsonPayload)
	if err != nil {
		return ""
	}
	return truncateString(string(b), 8*1024)
}

func buildImagesResponseContentForLog(stream bool, upstreamCT string, usage *imagesUsage) string {
	if usage == nil {
		return ""
	}
	// 不记录 b64_json，仅记录 usage
	type respForLog struct {
		Stream      bool         `json:"stream"`
		ContentType string       `json:"content_type,omitempty"`
		Usage       *imagesUsage `json:"usage,omitempty"`
		Note        string       `json:"note,omitempty"`
	}
	obj := respForLog{
		Stream:      stream,
		ContentType: upstreamCT,
		Usage:       usage,
		Note:        "image data omitted for storage",
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return ""
	}
	return string(b)
}

func truncateString(s string, max int) string {
	if max <= 0 {
		return ""
	}
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

func parseJSONModelAndStream(bc *bodycache.BodyCache) (payload map[string]any, modelName string, stream bool, err error) {
	r, err := bc.NewReader()
	if err != nil {
		return nil, "", false, err
	}
	defer r.Close()

	body, err := io.ReadAll(r)
	if err != nil {
		return nil, "", false, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, "", false, errors.New("empty body")
	}

	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, "", false, errors.New("invalid json")
	}

	rawModel, ok := m["model"]
	if !ok {
		return nil, "", false, errors.New("model is required")
	}
	modelStr, ok := rawModel.(string)
	if !ok || strings.TrimSpace(modelStr) == "" {
		return nil, "", false, errors.New("model is required")
	}

	stream = false
	if v, ok := m["stream"]; ok {
		switch vv := v.(type) {
		case bool:
			stream = vv
		case string:
			stream = strings.EqualFold(strings.TrimSpace(vv), "true")
		case float64:
			stream = vv != 0
		}
	}

	return m, strings.TrimSpace(modelStr), stream, nil
}

func parseMultipartModelAndStream(bc *bodycache.BodyCache, boundary string) (modelName string, stream bool, err error) {
	r, err := bc.NewReader()
	if err != nil {
		return "", false, err
	}
	defer r.Close()

	mr := multipart.NewReader(r, boundary)

	stream = false
	for {
		part, err := mr.NextPart()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return "", false, err
		}

		name := part.FormName()
		if name == "" {
			_, _ = io.Copy(io.Discard, part)
			_ = part.Close()
			continue
		}

		switch name {
		case "model":
			b, _ := io.ReadAll(io.LimitReader(part, 1024))
			modelName = strings.TrimSpace(string(b))
		case "stream":
			b, _ := io.ReadAll(io.LimitReader(part, 16))
			stream = strings.EqualFold(strings.TrimSpace(string(b)), "true")
		default:
			_, _ = io.Copy(io.Discard, part)
		}
		_ = part.Close()
	}

	if strings.TrimSpace(modelName) == "" {
		return "", false, errors.New("model is required")
	}
	return modelName, stream, nil
}

func imagesAttempt(
	ctx context.Context,
	endpoint string,
	c *gin.Context,
	bc *bodycache.BodyCache,
	isMultipart bool,
	boundary string,
	jsonPayload map[string]any,
	stream bool,
	channel *model.Channel,
	keyType outbound.OutboundType,
	channelKey string,
	firstTokenTimeOutSec int,
	metrics *imagesRelayMetrics,
) (statusCode int, written bool, usage *imagesUsage, upstreamCT string, err error) {
	// 构建 URL（baseUrl.Path 后追加 endpoint）
	parsedURL, err := imagesUpstreamURL(channel.GetBaseUrl(), endpoint, keyType)
	if err != nil {
		return 0, false, nil, "", err
	}

	var bodyReader io.Reader
	var contentType string

	if isMultipart {
		pr, pw := io.Pipe()
		mw := multipart.NewWriter(pw)
		contentType = mw.FormDataContentType()
		bodyReader = pr

		go func() {
			src, err := bc.NewReader()
			if err != nil {
				_ = pw.CloseWithError(err)
				return
			}
			defer src.Close()

			if err := copyMultipartPreserveModel(src, boundary, mw); err != nil {
				_ = pw.CloseWithError(err)
				return
			}
			// 先关闭 multipart.Writer 写入结束 boundary，再关闭 pipe writer
			if err := mw.Close(); err != nil {
				_ = pw.CloseWithError(err)
				return
			}
			_ = pw.Close()
		}()
	} else {
		// JSON：保持 model 字段和其他参数原样，确保项目只负责路由转发
		// 注意：每次尝试都重新 marshal 生成 body，确保可重试重建
		if jsonPayload == nil {
			return 0, false, nil, "", errors.New("nil json payload")
		}
		b, err := json.Marshal(jsonPayload)
		if err != nil {
			return 0, false, nil, "", fmt.Errorf("failed to marshal json: %w", err)
		}
		bodyReader = bytes.NewReader(b)
		contentType = "application/json"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "", bodyReader)
	if err != nil {
		return 0, false, nil, "", fmt.Errorf("failed to create request: %w", err)
	}
	req.URL = parsedURL
	req.Method = http.MethodPost

	// Header 透传：复制下游 header，过滤 hop-by-hop 与鉴权相关
	copyHeadersToUpstream(req, c, channel, channelKey, contentType, stream)

	// 发送请求
	httpClientFn := helper.ChannelHttpClient
	if stream {
		httpClientFn = helper.ChannelStreamHttpClient
	}
	httpClient, err := httpClientFn(channel)
	if err != nil {
		return 0, false, nil, "", err
	}

	respUp, err := httpClient.Do(req)
	if err != nil {
		return 0, false, nil, "", fmt.Errorf("failed to send request: %w", err)
	}
	defer respUp.Body.Close()

	upstreamCT = respUp.Header.Get("Content-Type")

	// stream=true：逐行解析 event/data/空行边界透传
	if stream {
		if respUp.StatusCode < 200 || respUp.StatusCode >= 300 {
			b, _ := io.ReadAll(io.LimitReader(respUp.Body, imagesUpstreamErrorBodyLimit))
			return respUp.StatusCode, false, nil, upstreamCT, fmt.Errorf("upstream error: %d: %s", respUp.StatusCode, string(b))
		}
		u, w, err := proxySSE(ctx, c, respUp, firstTokenTimeOutSec, metrics)
		return respUp.StatusCode, w, u, upstreamCT, err
	}

	// 非流式：2xx 透传，否则读取限长错误体用于错误信息与重试判定
	if respUp.StatusCode < 200 || respUp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(respUp.Body, imagesUpstreamErrorBodyLimit))
		return respUp.StatusCode, false, nil, upstreamCT, fmt.Errorf("upstream error: %d: %s", respUp.StatusCode, string(b))
	}

	u, w, err := proxyNonStream(c, respUp)
	return respUp.StatusCode, w, u, upstreamCT, err
}

func copyHeadersToUpstream(req *http.Request, c *gin.Context, channel *model.Channel, channelKey string, contentType string, stream bool) {
	for k, values := range c.Request.Header {
		if hopByHopHeaders[strings.ToLower(k)] {
			continue
		}
		for _, v := range values {
			req.Header.Add(k, v)
		}
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	} else if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+channelKey)

	if len(channel.CustomHeader) > 0 {
		for _, h := range channel.CustomHeader {
			req.Header.Set(h.HeaderKey, h.HeaderValue)
		}
	}
}

func copyMultipartPreserveModel(src io.Reader, boundary string, dst *multipart.Writer) error {
	mr := multipart.NewReader(src, boundary)

	for {
		part, err := mr.NextPart()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return err
		}

		hdr := make(textproto.MIMEHeader, len(part.Header))
		for k, vv := range part.Header {
			cp := make([]string, len(vv))
			copy(cp, vv)
			hdr[k] = cp
		}

		pw, err := dst.CreatePart(hdr)
		if err != nil {
			_ = part.Close()
			return err
		}

		_, err = io.Copy(pw, part)
		_ = part.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// proxyNonStream 将上游非流式响应原样透传到下游，同时尽量提取 usage（避免解析巨大 b64_json）。
func proxyNonStream(c *gin.Context, respUp *http.Response) (*imagesUsage, bool, error) {
	ct := respUp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	c.Header("Content-Type", ct)
	c.Status(respUp.StatusCode)

	scanner := newUsageScanner()

	buf := make([]byte, 32*1024)
	for {
		n, rerr := respUp.Body.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			scanner.Feed(chunk)
			if _, werr := c.Writer.Write(chunk); werr != nil {
				return scanner.Usage(), true, werr
			}
		}
		if rerr != nil {
			if errors.Is(rerr, io.EOF) {
				break
			}
			return scanner.Usage(), c.Writer.Written(), rerr
		}
	}

	return scanner.Usage(), c.Writer.Written(), nil
}

// proxySSE 将上游 SSE 逐行解析 event/data/空行并透传到下游；首事件计为 FirstTokenTime；支持 FirstTokenTimeOut 切换。
func proxySSE(ctx context.Context, c *gin.Context, respUp *http.Response, firstTokenTimeOutSec int, metrics *imagesRelayMetrics) (*imagesUsage, bool, error) {
	if ct := respUp.Header.Get("Content-Type"); ct != "" && !strings.Contains(strings.ToLower(ct), "text/event-stream") {
		b, _ := io.ReadAll(io.LimitReader(respUp.Body, imagesUpstreamErrorBodyLimit))
		return nil, false, fmt.Errorf("upstream returned non-SSE content-type %q for stream request: %s", ct, string(b))
	}

	// 设置 SSE 响应头
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	type lineResult struct {
		line []byte
		err  error
		eof  bool
	}

	results := make(chan lineResult, 1)
	go func() {
		defer close(results)
		br := bufio.NewReaderSize(respUp.Body, 64*1024)
		for {
			line, err := readLineLimited(br, maxSSEEventSize)
			if err != nil {
				if errors.Is(err, io.EOF) {
					results <- lineResult{eof: true}
					return
				}
				results <- lineResult{err: err}
				return
			}
			results <- lineResult{line: line}
		}
	}()

	var firstTokenTimer *time.Timer
	var firstTokenC <-chan time.Time
	if firstTokenTimeOutSec > 0 {
		firstTokenTimer = time.NewTimer(time.Duration(firstTokenTimeOutSec) * time.Second)
		firstTokenC = firstTokenTimer.C
		defer func() {
			if firstTokenTimer != nil {
				firstTokenTimer.Stop()
			}
		}()
	}

	var (
		firstWrite       = true
		currentEvent     string
		completedScanner = newUsageScanner()
	)

	for {
		select {
		case <-ctx.Done():
			log.Infof("client disconnected, stopping stream")
			return completedScanner.Usage(), c.Writer.Written(), nil

		case <-firstTokenC:
			log.Warnf("first token timeout (%ds), switching channel", firstTokenTimeOutSec)
			_ = respUp.Body.Close()
			return completedScanner.Usage(), c.Writer.Written(), fmt.Errorf("first token timeout (%ds)", firstTokenTimeOutSec)

		case r, ok := <-results:
			if !ok {
				return completedScanner.Usage(), c.Writer.Written(), nil
			}
			if r.eof {
				return completedScanner.Usage(), c.Writer.Written(), nil
			}
			if r.err != nil {
				return completedScanner.Usage(), c.Writer.Written(), fmt.Errorf("failed to read stream line: %w", r.err)
			}

			line := r.line
			trimmed := bytes.TrimRight(line, "\r\n")
			if len(trimmed) == 0 {
				// 空行：事件边界
				currentEvent = ""
			} else if bytes.HasPrefix(trimmed, []byte("event:")) {
				currentEvent = strings.TrimSpace(string(trimmed[len("event:"):]))
			} else if bytes.HasPrefix(trimmed, []byte("data:")) {
				// 仅在 completed 事件上尝试提取 usage（避免解析/分配巨大 b64_json）
				payload := bytes.TrimSpace(trimmed[len("data:"):])
				if currentEvent == "image_generation.completed" || bytes.Contains(payload, []byte(`"type":"image_generation.completed"`)) {
					completedScanner.Feed(payload)
				}
			}

			if _, werr := c.Writer.Write(line); werr != nil {
				return completedScanner.Usage(), true, werr
			}
			c.Writer.Flush()

			if firstWrite {
				metrics.SetFirstTokenTime(time.Now())
				firstWrite = false
				if firstTokenTimer != nil {
					if !firstTokenTimer.Stop() {
						select {
						case <-firstTokenTimer.C:
						default:
						}
					}
					firstTokenTimer = nil
					firstTokenC = nil
				}
			}
		}
	}
}

func readLineLimited(br *bufio.Reader, limit int) ([]byte, error) {
	var out []byte
	for {
		part, err := br.ReadSlice('\n')
		out = append(out, part...)
		if len(out) > limit {
			return nil, fmt.Errorf("sse line exceeds limit %d bytes", limit)
		}
		if err == nil {
			return out, nil
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		// 允许返回已读部分 + err（调用方按 err 处理）
		return out, err
	}
}

type usageScanner struct {
	matchIdx       int
	waitForObject  bool
	collecting     bool
	braceDepth     int
	inString       bool
	escape         bool
	buf            bytes.Buffer
	usage          *imagesUsage
	done           bool
	maxCollectSize int
}

func newUsageScanner() *usageScanner {
	return &usageScanner{maxCollectSize: 64 * 1024}
}

// Feed 逐字节扫描输入，定位 "usage":{...} 并仅解析 usage 子对象。
// 该实现用于避免整体 json.Unmarshal 造成 b64_json 巨大内存分配。
func (s *usageScanner) Feed(p []byte) {
	if s.done || len(p) == 0 {
		return
	}
	const pat = `"usage":`

	for _, b := range p {
		if s.done {
			return
		}

		if s.collecting {
			if s.buf.Len() >= s.maxCollectSize {
				s.collecting = false
				s.done = true
				return
			}
			s.buf.WriteByte(b)

			if s.inString {
				if s.escape {
					s.escape = false
				} else if b == '\\' {
					s.escape = true
				} else if b == '"' {
					s.inString = false
				}
				continue
			}

			if b == '"' {
				s.inString = true
				continue
			}

			switch b {
			case '{':
				s.braceDepth++
			case '}':
				s.braceDepth--
				if s.braceDepth == 0 {
					var u imagesUsage
					if err := json.Unmarshal(s.buf.Bytes(), &u); err == nil {
						s.usage = &u
					}
					s.done = true
					s.collecting = false
					return
				}
			}
			continue
		}

		if s.waitForObject {
			if b == '{' {
				s.collecting = true
				s.braceDepth = 1
				s.buf.Reset()
				s.buf.WriteByte('{')
				s.inString = false
				s.escape = false
				s.waitForObject = false
				continue
			}
			// 跳过空白，遇到其他字符则放弃
			if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
				continue
			}
			s.waitForObject = false
			continue
		}

		// 匹配 "usage":
		if b == pat[s.matchIdx] {
			s.matchIdx++
			if s.matchIdx == len(pat) {
				s.waitForObject = true
				s.matchIdx = 0
			}
			continue
		}

		// 失败回退：若当前字符可能是 pat[0]，则 matchIdx=1
		if b == pat[0] {
			s.matchIdx = 1
		} else {
			s.matchIdx = 0
		}
	}
}

func (s *usageScanner) Usage() *imagesUsage {
	return s.usage
}
