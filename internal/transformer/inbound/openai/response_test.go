package openai

import (
	"context"
	"testing"
)

func TestResponseInboundPreservesReasoningContext(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "all turns",
			body: `{"model":"gpt-5.6-sol","input":"hello","reasoning":{"effort":"high","context":"all_turns"}}`,
			want: "all_turns",
		},
		{
			name: "current turn",
			body: `{"model":"gpt-5.6-sol","input":"hello","reasoning":{"context":"current_turn"}}`,
			want: "current_turn",
		},
		{
			name: "omitted",
			body: `{"model":"gpt-5.6-sol","input":"hello","reasoning":{"effort":"low"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inbound := &ResponseInbound{}
			got, err := inbound.TransformRequest(context.Background(), []byte(tt.body))
			if err != nil {
				t.Fatalf("转换请求失败: %v", err)
			}
			if got.ReasoningContext != tt.want {
				t.Fatalf("reasoning context = %q，期望 %q", got.ReasoningContext, tt.want)
			}
		})
	}
}
