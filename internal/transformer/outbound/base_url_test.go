package outbound

import "testing"

func TestNormalizeBaseURLAddsV1ForOpenAICompatibleTypes(t *testing.T) {
	tests := []struct {
		name    string
		keyType OutboundType
	}{
		{name: "OpenAI Chat", keyType: OutboundTypeOpenAIChat},
		{name: "New API Chat", keyType: OutboundTypeNewAPIChat},
		{name: "OpenAI Response", keyType: OutboundTypeOpenAIResponse},
		{name: "OpenAI Embedding", keyType: OutboundTypeOpenAIEmbedding},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeBaseURL("https://api.example.com", tt.keyType)
			if err != nil {
				t.Fatalf("NormalizeBaseURL() error = %v", err)
			}
			if got != "https://api.example.com/v1" {
				t.Fatalf("NormalizeBaseURL() = %q, want %q", got, "https://api.example.com/v1")
			}
		})
	}
}

func TestNormalizeBaseURLDoesNotDuplicateV1(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "root v1",
			baseURL: "https://api.example.com/v1",
			want:    "https://api.example.com/v1",
		},
		{
			name:    "nested v1",
			baseURL: "https://api.example.com/proxy/v1",
			want:    "https://api.example.com/proxy/v1",
		},
		{
			name:    "v1beta is not v1",
			baseURL: "https://api.example.com/v1beta",
			want:    "https://api.example.com/v1beta/v1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeBaseURL(tt.baseURL, OutboundTypeOpenAIChat)
			if err != nil {
				t.Fatalf("NormalizeBaseURL() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("NormalizeBaseURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeBaseURLKeepsNonOpenAIBaseURL(t *testing.T) {
	tests := []struct {
		name    string
		keyType OutboundType
		baseURL string
	}{
		{name: "Anthropic", keyType: OutboundTypeAnthropic, baseURL: "https://api.anthropic.com"},
		{name: "Gemini", keyType: OutboundTypeGemini, baseURL: "https://generativelanguage.googleapis.com/v1beta"},
		{name: "Volcengine", keyType: OutboundTypeVolcengine, baseURL: "https://ark.cn-beijing.volces.com/api/v3"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeBaseURL("  "+tt.baseURL+"  ", tt.keyType)
			if err != nil {
				t.Fatalf("NormalizeBaseURL() error = %v", err)
			}
			if got != tt.baseURL {
				t.Fatalf("NormalizeBaseURL() = %q, want %q", got, tt.baseURL)
			}
		})
	}
}

func TestNormalizeBaseURLPreservesQuery(t *testing.T) {
	got, err := NormalizeBaseURL("https://api.example.com/proxy?region=us", OutboundTypeOpenAIResponse)
	if err != nil {
		t.Fatalf("NormalizeBaseURL() error = %v", err)
	}
	if got != "https://api.example.com/proxy/v1?region=us" {
		t.Fatalf("NormalizeBaseURL() = %q, want %q", got, "https://api.example.com/proxy/v1?region=us")
	}
}

func TestNormalizeBaseURLRejectsInvalidURL(t *testing.T) {
	if _, err := NormalizeBaseURL("api.example.com", OutboundTypeOpenAIChat); err == nil {
		t.Fatal("NormalizeBaseURL() error = nil, want error")
	}
}
