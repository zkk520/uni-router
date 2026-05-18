package outbound

import (
	"testing"

	"github.com/zkk520/uni-router/internal/transformer/outbound/openai"
)

func TestNewAPIChatUsesOpenAIChatOutbound(t *testing.T) {
	if !IsChatChannelType(OutboundTypeNewAPIChat) {
		t.Fatal("New API Chat 应支持 chat 请求")
	}
	if IsEmbeddingChannelType(OutboundTypeNewAPIChat) {
		t.Fatal("New API Chat 不应支持 embedding 请求")
	}
	adapter := Get(OutboundTypeNewAPIChat)
	if adapter == nil {
		t.Fatal("New API Chat adapter = nil, want *openai.ChatOutbound")
	}
	if _, ok := adapter.(*openai.ChatOutbound); !ok {
		t.Fatalf("New API Chat adapter = %T, want *openai.ChatOutbound", adapter)
	}
}
