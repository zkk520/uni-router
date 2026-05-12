package helper

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
	"github.com/dlclark/regexp2"
)

const (
	modelListInvalidJSONMessage = "上游模型列表响应不是有效 JSON，请检查 Base URL/供应商类型/API Key"
	modelListHTMLMessage        = "上游返回了 HTML 页面，请检查 Base URL/供应商类型/API Key"
)

func FetchModels(ctx context.Context, request model.Channel) ([]string, error) {
	if request.GetBaseUrl() == "" {
		return nil, fmt.Errorf("base url is required")
	}
	if request.GetChannelKey().ChannelKey == "" {
		return nil, fmt.Errorf("api key is required")
	}

	client, err := ChannelHttpClient(&request)
	if err != nil {
		return nil, err
	}
	fetchModel := make([]string, 0)
	switch request.Type {
	case outbound.OutboundTypeAnthropic:
		fetchModel, err = fetchAnthropicModels(client, ctx, request)
	case outbound.OutboundTypeGemini:
		fetchModel, err = fetchGeminiModels(client, ctx, request)
	default:
		fetchModel, err = fetchOpenAIModels(client, ctx, request)
	}
	if err != nil {
		return nil, err
	}
	if request.MatchRegex != nil && *request.MatchRegex != "" {
		matchModel := make([]string, 0)
		re, err := regexp2.Compile(*request.MatchRegex, regexp2.ECMAScript)
		if err != nil {
			return nil, err
		}
		for _, model := range fetchModel {
			matched, err := re.MatchString(model)
			if err != nil {
				return nil, err
			}
			if matched {
				matchModel = append(matchModel, model)
			}
		}
		return matchModel, nil
	}
	return fetchModel, nil
}

func FetchModelsByKey(ctx context.Context, request model.Channel) model.ChannelFetchModelsResponse {
	results := make([]model.ChannelFetchModelsResult, 0, len(request.Keys))
	allModels := make([]string, 0)
	seen := make(map[string]struct{})

	for i, key := range request.Keys {
		if !key.Enabled || strings.TrimSpace(key.ChannelKey) == "" {
			continue
		}

		fetchReq := request
		fetchReq.Keys = []model.ChannelKey{key}
		models, err := FetchModels(ctx, fetchReq)
		cleanModels := uniqueTrimModels(models)
		if cleanModels == nil {
			cleanModels = make([]string, 0)
		}
		result := model.ChannelFetchModelsResult{
			KeyID:          key.ID,
			KeyIndex:       i,
			Remark:         key.Remark,
			MaskedKey:      maskModelFetchKey(key.ChannelKey),
			Success:        err == nil,
			Models:         cleanModels,
			ModelsSyncedAt: timeNowUnix(),
		}
		if err != nil {
			result.Error = err.Error()
		} else {
			for _, m := range cleanModels {
				if _, ok := seen[m]; ok {
					continue
				}
				seen[m] = struct{}{}
				allModels = append(allModels, m)
			}
		}
		results = append(results, result)
	}

	return model.ChannelFetchModelsResponse{
		Results: results,
		Models:  allModels,
	}
}

func uniqueTrimModels(models []string) []string {
	out := make([]string, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, m := range models {
		m = strings.TrimSpace(m)
		if m == "" {
			continue
		}
		if _, ok := seen[m]; ok {
			continue
		}
		seen[m] = struct{}{}
		out = append(out, m)
	}
	return out
}

func maskModelFetchKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:3] + "***" + key[len(key)-4:]
}

func timeNowUnix() int64 {
	return time.Now().Unix()
}

// refer: https://platform.openai.com/docs/api-reference/models/list
func fetchOpenAIModels(client *http.Client, ctx context.Context, request model.Channel) ([]string, error) {
	endpoint, err := appendURLPath(request.GetBaseUrl(), "models")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		endpoint,
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create model list request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+request.GetChannelKey().ChannelKey)
	for _, header := range request.CustomHeader {
		if header.HeaderKey != "" {
			req.Header.Set(header.HeaderKey, header.HeaderValue)
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := readSuccessBody(resp)
	if err != nil {
		return nil, err
	}

	var result model.OpenAIModelList

	if err := decodeModelListJSON(body, &result); err != nil {
		return nil, err
	}

	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		models = append(models, m.ID)
	}
	return models, nil
}

// refer: https://ai.google.dev/api/models
func fetchGeminiModels(client *http.Client, ctx context.Context, request model.Channel) ([]string, error) {
	var allModels []string
	pageToken := ""

	for {
		endpoint, err := appendURLPath(request.GetBaseUrl(), "models")
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			endpoint,
			nil,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create model list request: %w", err)
		}
		req.Header.Set("X-Goog-Api-Key", request.GetChannelKey().ChannelKey)
		for _, header := range request.CustomHeader {
			if header.HeaderKey != "" {
				req.Header.Set(header.HeaderKey, header.HeaderValue)
			}
		}
		if pageToken != "" {
			q := req.URL.Query()
			q.Add("pageToken", pageToken)
			req.URL.RawQuery = q.Encode()
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := readSuccessBody(resp)
		closeErr := resp.Body.Close()
		if err != nil {
			if fallbackModels, fallbackErr := fetchOpenAIModels(client, ctx, request); fallbackErr == nil {
				return fallbackModels, nil
			}
			return nil, err
		}
		if closeErr != nil {
			return nil, fmt.Errorf("failed to close response body: %w", closeErr)
		}

		var result model.GeminiModelList

		if err := decodeModelListJSON(body, &result); err != nil {
			if fallbackModels, fallbackErr := fetchOpenAIModels(client, ctx, request); fallbackErr == nil {
				return fallbackModels, nil
			}
			return nil, err
		}

		for _, m := range result.Models {
			name := strings.TrimPrefix(m.Name, "models/")
			allModels = append(allModels, name)
		}

		if result.NextPageToken == "" {
			break
		}
		pageToken = result.NextPageToken
	}
	if len(allModels) == 0 {
		return fetchOpenAIModels(client, ctx, request)
	}
	return allModels, nil
}

// refer: https://platform.claude.com/docs
func fetchAnthropicModels(client *http.Client, ctx context.Context, request model.Channel) ([]string, error) {

	var allModels []string
	var afterID string
	for {
		endpoint, err := appendURLPath(request.GetBaseUrl(), "models")
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			endpoint,
			nil,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create model list request: %w", err)
		}
		req.Header.Set("X-Api-Key", request.GetChannelKey().ChannelKey)
		req.Header.Set("Anthropic-Version", "2023-06-01")
		for _, header := range request.CustomHeader {
			if header.HeaderKey != "" {
				req.Header.Set(header.HeaderKey, header.HeaderValue)
			}
		}
		// 设置多页参数
		q := req.URL.Query()

		if afterID != "" {
			q.Set("after_id", afterID)
		}
		req.URL.RawQuery = q.Encode()

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := readSuccessBody(resp)
		closeErr := resp.Body.Close()
		if err != nil {
			if fallbackModels, fallbackErr := fetchOpenAIModels(client, ctx, request); fallbackErr == nil {
				return fallbackModels, nil
			}
			return nil, err
		}
		if closeErr != nil {
			return nil, fmt.Errorf("failed to close response body: %w", closeErr)
		}

		var result model.AnthropicModelList

		if err := decodeModelListJSON(body, &result); err != nil {
			if fallbackModels, fallbackErr := fetchOpenAIModels(client, ctx, request); fallbackErr == nil {
				return fallbackModels, nil
			}
			return nil, err
		}

		for _, m := range result.Data {
			allModels = append(allModels, m.ID)
		}

		if !result.HasMore {
			break
		}

		afterID = result.LastID
	}
	if len(allModels) == 0 {
		return fetchOpenAIModels(client, ctx, request)
	}
	return allModels, nil
}

func appendURLPath(baseURL string, elems ...string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("failed to parse base url: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid base url: %s", baseURL)
	}

	basePath := strings.TrimRight(parsed.Path, "/")
	for _, elem := range elems {
		trimmed := strings.Trim(elem, "/")
		if trimmed == "" {
			continue
		}
		basePath += "/" + trimmed
	}
	parsed.Path = basePath
	return parsed.String(), nil
}

func readSuccessBody(resp *http.Response) ([]byte, error) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return body, nil
	}

	if looksLikeHTML(body) {
		return nil, fmt.Errorf("upstream returned HTTP %d: %s", resp.StatusCode, modelListHTMLMessage)
	}

	message := extractErrorMessage(body)
	if message == "" {
		message = strings.TrimSpace(string(body))
	}
	if message == "" {
		message = resp.Status
	}
	return nil, fmt.Errorf("upstream returned HTTP %d: %s", resp.StatusCode, message)
}

func decodeModelListJSON(body []byte, target any) error {
	if err := json.Unmarshal(body, target); err != nil {
		if looksLikeHTML(body) {
			return fmt.Errorf(modelListHTMLMessage)
		}
		return fmt.Errorf(modelListInvalidJSONMessage)
	}
	return nil
}

func looksLikeHTML(body []byte) bool {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return false
	}
	lower := bytes.ToLower(body)
	return bytes.HasPrefix(lower, []byte("<!doctype html")) ||
		bytes.HasPrefix(lower, []byte("<html")) ||
		bytes.HasPrefix(lower, []byte("<head")) ||
		bytes.HasPrefix(lower, []byte("<body"))
}

func extractErrorMessage(body []byte) string {
	body = bytes.TrimSpace(body)
	if len(body) == 0 || !json.Valid(body) {
		return ""
	}

	var payload struct {
		Error   any    `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}

	switch errPayload := payload.Error.(type) {
	case string:
		return errPayload
	case map[string]any:
		if msg, ok := errPayload["message"].(string); ok {
			return msg
		}
		if msg, ok := errPayload["error"].(string); ok {
			return msg
		}
	}

	return payload.Message
}
