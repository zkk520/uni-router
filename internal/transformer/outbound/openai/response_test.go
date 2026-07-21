package openai

import (
	"encoding/json"
	"testing"

	"github.com/zkk520/uni-router/internal/transformer/model"
)

func TestConvertToResponsesRequestPreservesReasoningContext(t *testing.T) {
	tests := []struct {
		name        string
		request     *model.InternalLLMRequest
		wantContext string
		wantReason  bool
	}{
		{
			name: "all turns",
			request: &model.InternalLLMRequest{
				Model:            "gpt-5.6-sol",
				ReasoningEffort:  "high",
				ReasoningContext: "all_turns",
			},
			wantContext: "all_turns",
			wantReason:  true,
		},
		{
			name: "current turn",
			request: &model.InternalLLMRequest{
				Model:            "gpt-5.6-sol",
				ReasoningContext: "current_turn",
			},
			wantContext: "current_turn",
			wantReason:  true,
		},
		{
			name: "omitted",
			request: &model.InternalLLMRequest{
				Model: "gpt-5.6-sol",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ConvertToResponsesRequest(tt.request)
			if tt.wantReason != (got.Reasoning != nil) {
				t.Fatalf("reasoning 是否存在 = %v，期望 %v", got.Reasoning != nil, tt.wantReason)
			}
			if got.Reasoning != nil && got.Reasoning.Context != tt.wantContext {
				t.Fatalf("reasoning context = %q，期望 %q", got.Reasoning.Context, tt.wantContext)
			}

			body, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("序列化请求失败: %v", err)
			}
			var decoded map[string]any
			if err := json.Unmarshal(body, &decoded); err != nil {
				t.Fatalf("解析请求失败: %v", err)
			}
			_, hasReasoning := decoded["reasoning"]
			if hasReasoning != tt.wantReason {
				t.Fatalf("序列化后的 reasoning 是否存在 = %v，期望 %v", hasReasoning, tt.wantReason)
			}
		})
	}
}
