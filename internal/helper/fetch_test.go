package helper

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

func TestAppendURLPath(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "base path without trailing slash",
			baseURL: "https://api.openai.com/v1",
			want:    "https://api.openai.com/v1/models",
		},
		{
			name:    "base path with trailing slash",
			baseURL: "https://generativelanguage.googleapis.com/v1beta/",
			want:    "https://generativelanguage.googleapis.com/v1beta/models",
		},
		{
			name:    "base url with query",
			baseURL: "https://example.com/api?version=1",
			want:    "https://example.com/api/models?version=1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := appendURLPath(tt.baseURL, "models")
			if err != nil {
				t.Fatalf("appendURLPath returned error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("appendURLPath() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAppendURLPathRejectsInvalidBaseURL(t *testing.T) {
	if _, err := appendURLPath("api.openai.com/v1", "models"); err == nil {
		t.Fatal("appendURLPath() error = nil, want error")
	}
}

func TestExtractErrorMessage(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "openai style error",
			body: `{"error":{"message":"invalid api key","type":"invalid_request_error"}}`,
			want: "invalid api key",
		},
		{
			name: "plain message error",
			body: `{"message":"permission denied"}`,
			want: "permission denied",
		},
		{
			name: "string error",
			body: `{"error":"not found"}`,
			want: "not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractErrorMessage([]byte(tt.body))
			if got != tt.want {
				t.Fatalf("extractErrorMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDecodeModelListJSON(t *testing.T) {
	type result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}

	t.Run("html body returns friendly error", func(t *testing.T) {
		var got result
		err := decodeModelListJSON([]byte("<html><body>ok</body></html>"), &got)
		if err == nil {
			t.Fatal("decodeModelListJSON() error = nil, want error")
		}
		if err.Error() != modelListHTMLMessage {
			t.Fatalf("decodeModelListJSON() = %q, want %q", err.Error(), modelListHTMLMessage)
		}
	})

	t.Run("plain invalid json returns friendly error", func(t *testing.T) {
		var got result
		err := decodeModelListJSON([]byte("not json"), &got)
		if err == nil {
			t.Fatal("decodeModelListJSON() error = nil, want error")
		}
		if err.Error() != modelListInvalidJSONMessage {
			t.Fatalf("decodeModelListJSON() = %q, want %q", err.Error(), modelListInvalidJSONMessage)
		}
	})

	t.Run("valid json succeeds", func(t *testing.T) {
		var got result
		err := decodeModelListJSON([]byte(`{"data":[{"id":"gpt-4o"}]}`), &got)
		if err != nil {
			t.Fatalf("decodeModelListJSON() error = %v, want nil", err)
		}
		if len(got.Data) != 1 || got.Data[0].ID != "gpt-4o" {
			t.Fatalf("decodeModelListJSON() = %#v, want parsed data", got)
		}
	})
}

func TestFetchModelsByKeyReturnsPartialSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Authorization") {
		case "Bearer good-key":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"},{"id":"gpt-4o"}]}`))
		default:
			http.Error(w, `{"error":{"message":"invalid api key"}}`, http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:     outbound.OutboundTypeOpenAIChat,
		BaseUrls: []model.BaseUrl{{URL: server.URL + "/v1"}},
		Keys: []model.ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "good-key", Remark: "成功"},
			{ID: 2, Enabled: true, ChannelKey: "bad-key", Remark: "失败"},
		},
	})

	if len(got.Results) != 2 {
		t.Fatalf("FetchModelsByKey results = %d, want 2", len(got.Results))
	}
	if !got.Results[0].Success || len(got.Results[0].Models) != 2 {
		t.Fatalf("first key result = %#v, want success with deduped models", got.Results[0])
	}
	if got.Results[1].Success || got.Results[1].Error == "" {
		t.Fatalf("second key result = %#v, want failure with error", got.Results[1])
	}
	if got.Results[1].Models == nil || len(got.Results[1].Models) != 0 {
		t.Fatalf("second key models = %#v, want empty slice", got.Results[1].Models)
	}
	if len(got.Models) != 2 || got.Models[0] != "gpt-4o" || got.Models[1] != "gpt-4o-mini" {
		t.Fatalf("models = %#v, want successful key union", got.Models)
	}
}

func TestFetchModelsByKeySupportsNewAPIChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q, want /v1/models", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer new-api-key" {
			t.Fatalf("authorization = %q, want Bearer new-api-key", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"claude-3-5-sonnet"}]}`))
	}))
	defer server.Close()

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:     outbound.OutboundTypeNewAPIChat,
		BaseUrls: []model.BaseUrl{{URL: server.URL + "/v1"}},
		Keys:     []model.ChannelKey{{ID: 1, Enabled: true, ChannelKey: "new-api-key"}},
	})

	if len(got.Results) != 1 || !got.Results[0].Success {
		t.Fatalf("result = %#v, want one successful key", got.Results)
	}
	if len(got.Models) != 2 || got.Models[0] != "gpt-4o" || got.Models[1] != "claude-3-5-sonnet" {
		t.Fatalf("models = %#v, want OpenAI-compatible New API models", got.Models)
	}
}

func TestFetchModelsByKeyAddsV1ForOpenAIBaseURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q, want /v1/models", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"}]}`))
	}))
	defer server.Close()

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:     outbound.OutboundTypeOpenAIChat,
		BaseUrls: []model.BaseUrl{{URL: server.URL}},
		Keys:     []model.ChannelKey{{ID: 1, Enabled: true, ChannelKey: "openai-key"}},
	})

	if len(got.Results) != 1 || !got.Results[0].Success {
		t.Fatalf("result = %#v, want one successful key", got.Results)
	}
	if len(got.Models) != 1 || got.Models[0] != "gpt-4o" {
		t.Fatalf("models = %#v, want gpt-4o", got.Models)
	}
}

func TestFetchModelsByKeyUsesPerKeyTypeOverride(t *testing.T) {
	anthropicType := outbound.OutboundTypeAnthropic
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Header.Get("Authorization") == "Bearer openai-key":
			if r.URL.Path != "/v1/models" {
				t.Fatalf("openai path = %q, want /v1/models", r.URL.Path)
			}
			_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"}]}`))
		case r.Header.Get("X-Api-Key") == "anthropic-key":
			if r.URL.Path != "/models" {
				t.Fatalf("anthropic path = %q, want /models", r.URL.Path)
			}
			_, _ = w.Write([]byte(`{"data":[{"id":"claude-3-5-sonnet"}],"has_more":false}`))
		default:
			t.Fatalf("unexpected headers: authorization=%q x-api-key=%q", r.Header.Get("Authorization"), r.Header.Get("X-Api-Key"))
		}
	}))
	defer server.Close()

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:     outbound.OutboundTypeOpenAIChat,
		BaseUrls: []model.BaseUrl{{URL: server.URL}},
		Keys: []model.ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "openai-key"},
			{ID: 2, Enabled: true, ChannelKey: "anthropic-key", Type: &anthropicType},
		},
	})

	if len(got.Results) != 2 {
		t.Fatalf("results = %d, want 2", len(got.Results))
	}
	if !got.Results[0].Success || len(got.Results[0].Models) != 1 || got.Results[0].Models[0] != "gpt-4o" {
		t.Fatalf("openai result = %#v, want gpt-4o", got.Results[0])
	}
	if !got.Results[1].Success || len(got.Results[1].Models) != 1 || got.Results[1].Models[0] != "claude-3-5-sonnet" {
		t.Fatalf("anthropic result = %#v, want claude-3-5-sonnet", got.Results[1])
	}
	if len(got.Models) != 2 || got.Models[0] != "gpt-4o" || got.Models[1] != "claude-3-5-sonnet" {
		t.Fatalf("models = %#v, want mixed protocol union", got.Models)
	}
}

func TestFetchModelsByKeyReturnsEmptySlicesWhenAllFail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"invalid api key"}}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:     outbound.OutboundTypeOpenAIChat,
		BaseUrls: []model.BaseUrl{{URL: server.URL + "/v1"}},
		Keys: []model.ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "bad-key-1"},
			{ID: 2, Enabled: true, ChannelKey: "bad-key-2"},
		},
	})

	if got.Models == nil || len(got.Models) != 0 {
		t.Fatalf("models = %#v, want empty slice", got.Models)
	}
	if len(got.Results) != 2 {
		t.Fatalf("results = %d, want 2", len(got.Results))
	}
	for _, result := range got.Results {
		if result.Success || result.Error == "" {
			t.Fatalf("result = %#v, want failure with error", result)
		}
		if result.Models == nil || len(result.Models) != 0 {
			t.Fatalf("result models = %#v, want empty slice", result.Models)
		}
	}

	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if string(payload) == "" || !json.Valid(payload) {
		t.Fatalf("payload = %q, want valid json", string(payload))
	}
	if strings.Contains(string(payload), `"models":null`) {
		t.Fatalf("payload = %s, want models serialized as []", string(payload))
	}
}

func TestFetchModelsByKeyKeepsHTMLFriendlyError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body>login</body></html>"))
	}))
	defer server.Close()

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:     outbound.OutboundTypeOpenAIChat,
		BaseUrls: []model.BaseUrl{{URL: server.URL + "/v1"}},
		Keys:     []model.ChannelKey{{ID: 1, Enabled: true, ChannelKey: "bad-key"}},
	})

	if len(got.Results) != 1 {
		t.Fatalf("results = %d, want 1", len(got.Results))
	}
	if got.Results[0].Success {
		t.Fatalf("result = %#v, want failure", got.Results[0])
	}
	if got.Results[0].Error != modelListHTMLMessage {
		t.Fatalf("error = %q, want %q", got.Results[0].Error, modelListHTMLMessage)
	}
	if got.Results[0].Models == nil || len(got.Results[0].Models) != 0 {
		t.Fatalf("models = %#v, want empty slice", got.Results[0].Models)
	}
}

func TestFetchModelsByKeyAppliesMatchRegexPerKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"text-embedding-3-small"}]}`))
	}))
	defer server.Close()
	regex := "^gpt-"

	got := FetchModelsByKey(context.Background(), model.Channel{
		Type:       outbound.OutboundTypeOpenAIChat,
		BaseUrls:   []model.BaseUrl{{URL: server.URL + "/v1"}},
		Keys:       []model.ChannelKey{{ID: 1, Enabled: true, ChannelKey: "good-key"}},
		MatchRegex: &regex,
	})

	if len(got.Models) != 1 || got.Models[0] != "gpt-4o" {
		t.Fatalf("models = %#v, want regex-filtered model", got.Models)
	}
}
