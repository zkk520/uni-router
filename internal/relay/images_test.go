package relay

import (
	"testing"

	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

func TestIsImagesKeyTypeSupported(t *testing.T) {
	tests := []struct {
		name    string
		keyType outbound.OutboundType
		want    bool
	}{
		{name: "允许 OpenAI Chat", keyType: outbound.OutboundTypeOpenAIChat, want: true},
		{name: "允许 OpenAI Response", keyType: outbound.OutboundTypeOpenAIResponse, want: true},
		{name: "允许 New API Chat", keyType: outbound.OutboundTypeNewAPIChat, want: true},
		{name: "拒绝 Anthropic", keyType: outbound.OutboundTypeAnthropic, want: false},
		{name: "拒绝 Gemini", keyType: outbound.OutboundTypeGemini, want: false},
		{name: "拒绝 Embedding", keyType: outbound.OutboundTypeOpenAIEmbedding, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isImagesKeyTypeSupported(tt.keyType); got != tt.want {
				t.Fatalf("isImagesKeyTypeSupported() = %t, want %t", got, tt.want)
			}
		})
	}
}
