package relay

import (
	"testing"

	transformermodel "github.com/zkk520/uni-router/internal/transformer/model"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

func TestIsRouteRequestCompatibleWithKeyType(t *testing.T) {
	input := "hello"
	tests := []struct {
		name    string
		request *transformermodel.InternalLLMRequest
		keyType outbound.OutboundType
		want    bool
	}{
		{
			name: "聊天请求允许 New API Chat Key",
			request: &transformermodel.InternalLLMRequest{
				Messages: []transformermodel.Message{{Role: "user"}},
			},
			keyType: outbound.OutboundTypeNewAPIChat,
			want:    true,
		},
		{
			name: "聊天请求跳过 Embedding Key",
			request: &transformermodel.InternalLLMRequest{
				Messages: []transformermodel.Message{{Role: "user"}},
			},
			keyType: outbound.OutboundTypeOpenAIEmbedding,
			want:    false,
		},
		{
			name: "Embedding 请求允许 Embedding Key",
			request: &transformermodel.InternalLLMRequest{
				EmbeddingInput: &transformermodel.EmbeddingInput{Single: &input},
			},
			keyType: outbound.OutboundTypeOpenAIEmbedding,
			want:    true,
		},
		{
			name: "Embedding 请求跳过 New API Chat Key",
			request: &transformermodel.InternalLLMRequest{
				EmbeddingInput: &transformermodel.EmbeddingInput{Single: &input},
			},
			keyType: outbound.OutboundTypeNewAPIChat,
			want:    false,
		},
		{
			name: "混合请求必须同时满足 Chat 与 Embedding 能力",
			request: &transformermodel.InternalLLMRequest{
				Messages:       []transformermodel.Message{{Role: "user"}},
				EmbeddingInput: &transformermodel.EmbeddingInput{Single: &input},
			},
			keyType: outbound.OutboundTypeNewAPIChat,
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isRouteRequestCompatibleWithKeyType(tt.request, tt.keyType); got != tt.want {
				t.Fatalf("isRouteRequestCompatibleWithKeyType() = %t, want %t", got, tt.want)
			}
		})
	}
}
