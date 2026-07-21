package relay

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/conf"
	dbmodel "github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/transformer/inbound"
	inboundopenai "github.com/zkk520/uni-router/internal/transformer/inbound/openai"
	transformermodel "github.com/zkk520/uni-router/internal/transformer/model"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

func TestParseRequestPreservesRawBodyAndFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rawBody := []byte(`{"model":"gpt-5.6-sol","input":"hello","future_field":{"enabled":true}}`)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses?trace=one", bytes.NewReader(rawBody))

	request, _, err := parseRequest(inbound.InboundTypeOpenAIResponse, c)
	if err != nil {
		t.Fatalf("解析请求失败: %v", err)
	}
	if !bytes.Equal(request.RawRequest, rawBody) {
		t.Fatalf("原始请求体被修改: %q", request.RawRequest)
	}
	if request.RawAPIFormat != transformermodel.APIFormatOpenAIResponse {
		t.Fatalf("原始协议 = %q，期望 %q", request.RawAPIFormat, transformermodel.APIFormatOpenAIResponse)
	}
	if request.Query.Get("trace") != "one" {
		t.Fatalf("查询参数未保留: %#v", request.Query)
	}
}

func TestIsTransparentProtocolPair(t *testing.T) {
	tests := []struct {
		name    string
		format  transformermodel.APIFormat
		keyType outbound.OutboundType
		want    bool
	}{
		{name: "Responses", format: transformermodel.APIFormatOpenAIResponse, keyType: outbound.OutboundTypeOpenAIResponse, want: true},
		{name: "OpenAI Chat", format: transformermodel.APIFormatOpenAIChatCompletion, keyType: outbound.OutboundTypeOpenAIChat, want: true},
		{name: "NewAPI Chat", format: transformermodel.APIFormatOpenAIChatCompletion, keyType: outbound.OutboundTypeNewAPIChat, want: true},
		{name: "Anthropic", format: transformermodel.APIFormatAnthropicMessage, keyType: outbound.OutboundTypeAnthropic, want: true},
		{name: "Embedding", format: transformermodel.APIFormatOpenAIEmbedding, keyType: outbound.OutboundTypeOpenAIEmbedding, want: true},
		{name: "Responses 到 Volcengine", format: transformermodel.APIFormatOpenAIResponse, keyType: outbound.OutboundTypeVolcengine},
		{name: "Chat 到 Anthropic", format: transformermodel.APIFormatOpenAIChatCompletion, keyType: outbound.OutboundTypeAnthropic},
		{name: "Gemini", format: transformermodel.APIFormatGeminiContents, keyType: outbound.OutboundTypeGemini},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isTransparentProtocolPair(tt.format, tt.keyType); got != tt.want {
				t.Fatalf("isTransparentProtocolPair() = %v，期望 %v", got, tt.want)
			}
		})
	}
}

func TestPrepareTransparentRequestPreservesBodyAndProtectsConfiguredQuery(t *testing.T) {
	rawBody := []byte("{ \"model\" : \"gpt-5.6-sol\", \"future\" : true }")
	req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/responses?adapter=one&token=config", strings.NewReader("rebuilt"))
	incoming := url.Values{
		"token": {"client"},
		"trace": {"first", "second"},
	}

	if err := prepareTransparentRequest(req, rawBody, "https://upstream.example/v1?token=config", incoming); err != nil {
		t.Fatalf("准备透明请求失败: %v", err)
	}
	gotBody, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("读取透明请求体失败: %v", err)
	}
	if !bytes.Equal(gotBody, rawBody) {
		t.Fatalf("请求体 = %q，期望 %q", gotBody, rawBody)
	}
	if req.ContentLength != int64(len(rawBody)) {
		t.Fatalf("ContentLength = %d，期望 %d", req.ContentLength, len(rawBody))
	}
	if got := req.URL.Query().Get("token"); got != "config" {
		t.Fatalf("渠道查询参数被覆盖: %q", got)
	}
	if got := req.URL.Query()["trace"]; len(got) != 2 || got[0] != "first" || got[1] != "second" {
		t.Fatalf("客户端查询参数未保留: %#v", got)
	}
	if got := req.URL.Query().Get("adapter"); got != "one" {
		t.Fatalf("适配器查询参数未保留: %q", got)
	}
}

func TestTransparentForwardPreservesRequestAndSuccessfulResponse(t *testing.T) {
	setTransparentRelayForTest(t, true)
	gin.SetMode(gin.TestMode)

	rawRequest := []byte("{\n  \"model\": \"gpt-5.6-sol\",\n  \"input\": \"hello\",\n  \"reasoning\": {\"effort\": \"high\", \"context\": \"all_turns\"},\n  \"future_request\": true\n}")
	rawResponse := []byte(`{"id":"resp_1","object":"response","model":"gpt-5.6-sol","created_at":1,"output":[],"status":"completed","future_response":{"kept":true},"usage":{"input_tokens":3,"input_tokens_details":{"cached_tokens":0},"output_tokens":4,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":7}}`)

	var capturedBody []byte
	var capturedHeader http.Header
	var capturedQuery url.Values
	var capturedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		capturedHeader = r.Header.Clone()
		capturedQuery = r.URL.Query()
		capturedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Upstream-Feature", "kept")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(rawResponse)
	}))
	defer server.Close()

	recorder, attempt := newResponsesRelayAttempt(t, server.URL+"/v1?token=config", rawRequest, false)
	attempt.c.Request.URL.RawQuery = "token=client&trace=one"
	attempt.internalRequest.Query = attempt.c.Request.URL.Query()
	attempt.c.Request.Header.Set("Authorization", "Bearer client-key")
	attempt.c.Request.Header.Set(openAIResponsesLiteHeader, "true")
	attempt.c.Request.Header.Set("X-Route-Header", "client")
	attempt.channel.CustomHeader = []dbmodel.CustomHeader{{HeaderKey: "X-Route-Header", HeaderValue: "channel"}}

	statusCode, err := attempt.forward()
	if err != nil {
		t.Fatalf("透明转发失败: %v", err)
	}
	if statusCode != http.StatusCreated || recorder.Code != http.StatusCreated {
		t.Fatalf("状态码 = (%d, %d)，期望 %d", statusCode, recorder.Code, http.StatusCreated)
	}
	if !bytes.Equal(capturedBody, rawRequest) {
		t.Fatalf("上游收到的请求体被修改: %q", capturedBody)
	}
	if !bytes.Equal(recorder.Body.Bytes(), rawResponse) {
		t.Fatalf("客户端收到的响应体被修改: %q", recorder.Body.Bytes())
	}
	if capturedPath != "/v1/responses" {
		t.Fatalf("上游路径 = %q", capturedPath)
	}
	if got := capturedHeader.Get("Authorization"); got != "Bearer upstream-key" {
		t.Fatalf("上游认证 = %q", got)
	}
	if got := capturedHeader.Get(openAIResponsesLiteHeader); got != "true" {
		t.Fatalf("Codex Lite Header 未透传: %q", got)
	}
	if got := capturedHeader.Get("X-Route-Header"); got != "channel" {
		t.Fatalf("渠道自定义 Header 未覆盖客户端值: %q", got)
	}
	if got := capturedQuery.Get("token"); got != "config" {
		t.Fatalf("渠道查询参数被客户端覆盖: %q", got)
	}
	if got := capturedQuery.Get("trace"); got != "one" {
		t.Fatalf("客户端查询参数未透传: %q", got)
	}
	if got := recorder.Header().Get("X-Upstream-Feature"); got != "kept" {
		t.Fatalf("上游响应 Header 未透传: %q", got)
	}
	attempt.collectResponse()
	if attempt.metrics.InternalResponse == nil || attempt.metrics.InternalResponse.Usage == nil {
		t.Fatal("透明响应的 usage 未进入统计")
	}
	if attempt.metrics.Stats.InputToken != 3 || attempt.metrics.Stats.OutputToken != 4 {
		t.Fatalf("统计 token = (%d, %d)，期望 (3, 4)", attempt.metrics.Stats.InputToken, attempt.metrics.Stats.OutputToken)
	}
}

func TestCrossProtocolForwardFiltersResponsesLiteHeader(t *testing.T) {
	setTransparentRelayForTest(t, true)
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name    string
		keyType outbound.OutboundType
	}{
		{name: "OpenAI Chat", keyType: outbound.OutboundTypeOpenAIChat},
		{name: "NewAPI Chat", keyType: outbound.OutboundTypeNewAPIChat},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rawRequest := []byte(`{"model":"gpt-5.6-sol","input":"hello","reasoning":{"effort":"high","context":"all_turns"}}`)
			upstreamResponse := []byte(`{"id":"chatcmpl_1","object":"chat.completion","created":1,"model":"gpt-5.6-sol","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)

			var capturedHeader http.Header
			var capturedPath string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				capturedHeader = r.Header.Clone()
				capturedPath = r.URL.Path
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(upstreamResponse)
			}))
			defer server.Close()

			_, attempt := newResponsesRelayAttemptForType(t, server.URL+"/v1", rawRequest, false, tt.keyType)
			attempt.c.Request.Header.Set(openAIResponsesLiteHeader, "true")
			attempt.c.Request.Header.Set("X-Client-Feature", "kept")
			attempt.c.Request.Header.Set("X-Route-Header", "client")
			attempt.channel.CustomHeader = []dbmodel.CustomHeader{{HeaderKey: "X-Route-Header", HeaderValue: "channel"}}

			statusCode, err := attempt.forward()
			if err != nil {
				t.Fatalf("跨协议转发失败: %v", err)
			}
			if statusCode != http.StatusOK {
				t.Fatalf("状态码 = %d，期望 %d", statusCode, http.StatusOK)
			}
			if capturedPath != "/v1/chat/completions" {
				t.Fatalf("上游路径 = %q，期望 /v1/chat/completions", capturedPath)
			}
			if got := capturedHeader.Get(openAIResponsesLiteHeader); got != "" {
				t.Fatalf("Responses Lite Header 泄露到 Chat 上游: %q", got)
			}
			if got := capturedHeader.Get("X-Client-Feature"); got != "kept" {
				t.Fatalf("普通客户端 Header 未保留: %q", got)
			}
			if got := capturedHeader.Get("Authorization"); got != "Bearer upstream-key" {
				t.Fatalf("上游认证 = %q，期望渠道密钥", got)
			}
			if got := capturedHeader.Get("X-Route-Header"); got != "channel" {
				t.Fatalf("渠道自定义 Header 未覆盖客户端值: %q", got)
			}
		})
	}
}

func TestTransparentForwardPreservesSSEBytes(t *testing.T) {
	setTransparentRelayForTest(t, true)
	gin.SetMode(gin.TestMode)

	rawRequest := []byte(`{"model":"gpt-5.6-sol","input":"hello","stream":true,"future_request":true}`)
	rawStream := "event: response.created\n" +
		"data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\",\"object\":\"response\",\"model\":\"gpt-5.6-sol\",\"created_at\":1,\"output\":[]}}\n\n" +
		"event: response.future\n" +
		"data: {\"type\":\"response.future\",\"future\":\"kept\"}\n\n" +
		"data: [DONE]\n\n"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, rawStream)
	}))
	defer server.Close()

	recorder, attempt := newResponsesRelayAttempt(t, server.URL+"/v1", rawRequest, true)
	statusCode, err := attempt.forward()
	if err != nil {
		t.Fatalf("透明流式转发失败: %v", err)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("状态码 = %d", statusCode)
	}
	if recorder.Body.String() != rawStream {
		t.Fatalf("SSE 字节被修改:\n%s", recorder.Body.String())
	}
	if attempt.metrics.FirstTokenTime.IsZero() {
		t.Fatal("透明 SSE 未记录首字节时间")
	}
}

func TestTransparentStreamKeepsFirstTokenTimeout(t *testing.T) {
	setTransparentRelayForTest(t, true)
	gin.SetMode(gin.TestMode)

	recorder, attempt := newResponsesRelayAttempt(t, "https://upstream.example/v1", []byte(`{"model":"gpt-5.6-sol","input":"hello","stream":true}`), true)
	attempt.firstTokenTimeOutSec = 1
	body := &blockingReadCloser{closed: make(chan struct{})}
	response := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       body,
	}

	err := attempt.handleTransparentStreamResponse(context.Background(), response)
	if err == nil || !strings.Contains(err.Error(), "first token timeout") {
		t.Fatalf("首 Token 超时错误 = %v", err)
	}
	if attempt.c.Writer.Written() || recorder.Body.Len() != 0 {
		t.Fatalf("首 Token 超时前不应写客户端响应: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestTransparentRelayCanBeDisabled(t *testing.T) {
	setTransparentRelayForTest(t, false)
	gin.SetMode(gin.TestMode)

	rawRequest := []byte(`{"model":"gpt-5.6-sol","input":"hello","future_request":true}`)
	rawResponse := []byte(`{"id":"resp_1","object":"response","model":"gpt-5.6-sol","created_at":1,"output":[],"status":"completed","future_response":true}`)
	var capturedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(rawResponse)
	}))
	defer server.Close()

	recorder, attempt := newResponsesRelayAttempt(t, server.URL+"/v1", rawRequest, false)
	statusCode, err := attempt.forward()
	if err != nil {
		t.Fatalf("旧转换链路转发失败: %v", err)
	}
	if statusCode != http.StatusCreated {
		t.Fatalf("上游状态码 = %d", statusCode)
	}
	if bytes.Equal(capturedBody, rawRequest) || bytes.Contains(capturedBody, []byte("future_request")) {
		t.Fatalf("关闭透明转发后仍发送原始未知字段: %q", capturedBody)
	}
	if recorder.Code != http.StatusOK || bytes.Contains(recorder.Body.Bytes(), []byte("future_response")) {
		t.Fatalf("关闭透明转发后未回到旧响应转换: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestTransparentUpstreamErrorDoesNotWriteClientResponse(t *testing.T) {
	setTransparentRelayForTest(t, true)
	gin.SetMode(gin.TestMode)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid"}}`)
	}))
	defer server.Close()

	recorder, attempt := newResponsesRelayAttempt(t, server.URL+"/v1", []byte(`{"model":"gpt-5.6-sol","input":"hello"}`), false)
	statusCode, err := attempt.forward()
	if err == nil || statusCode != http.StatusBadRequest {
		t.Fatalf("上游错误结果 = (%d, %v)", statusCode, err)
	}
	if recorder.Code != http.StatusOK || recorder.Body.Len() != 0 {
		t.Fatalf("故障转移前不应写客户端响应: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func newResponsesRelayAttempt(t *testing.T, baseURL string, rawRequest []byte, stream bool) (*httptest.ResponseRecorder, *relayAttempt) {
	return newResponsesRelayAttemptForType(t, baseURL, rawRequest, stream, outbound.OutboundTypeOpenAIResponse)
}

func newResponsesRelayAttemptForType(t *testing.T, baseURL string, rawRequest []byte, stream bool, keyType outbound.OutboundType) (*httptest.ResponseRecorder, *relayAttempt) {
	t.Helper()
	inAdapter := &inboundopenai.ResponseInbound{}
	request, err := inAdapter.TransformRequest(context.Background(), rawRequest)
	if err != nil {
		t.Fatalf("构造内部请求失败: %v", err)
	}
	request.RawRequest = append([]byte(nil), rawRequest...)
	request.RawAPIFormat = transformermodel.APIFormatOpenAIResponse
	request.Stream = &stream

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(rawRequest))

	relayRequest := &relayRequest{
		c:               c,
		inAdapter:       inAdapter,
		internalRequest: request,
		metrics:         NewRelayMetrics(0, request.Model, request),
		requestModel:    request.Model,
	}
	return recorder, &relayAttempt{
		relayRequest: relayRequest,
		outAdapter:   outbound.Get(keyType),
		channel: &dbmodel.Channel{
			BaseUrls: []dbmodel.BaseUrl{{URL: baseURL}},
		},
		usedKey: dbmodel.ChannelKey{ChannelKey: "upstream-key"},
		keyType: keyType,
	}
}

func setTransparentRelayForTest(t *testing.T, enabled bool) {
	t.Helper()
	previous := conf.AppConfig.Relay.TransparentSameProtocol
	conf.AppConfig.Relay.TransparentSameProtocol = enabled
	t.Cleanup(func() {
		conf.AppConfig.Relay.TransparentSameProtocol = previous
	})
}

type blockingReadCloser struct {
	closed chan struct{}
	once   sync.Once
}

func (r *blockingReadCloser) Read([]byte) (int, error) {
	<-r.closed
	return 0, io.EOF
}

func (r *blockingReadCloser) Close() error {
	r.once.Do(func() {
		close(r.closed)
	})
	return nil
}
