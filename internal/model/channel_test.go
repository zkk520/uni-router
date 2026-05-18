package model

import (
	"encoding/json"
	"testing"

	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

func TestEffectiveChannelKeyType(t *testing.T) {
	channel := Channel{Type: outbound.OutboundTypeOpenAIChat}
	key := ChannelKey{}
	if got := EffectiveChannelKeyType(channel, key); got != outbound.OutboundTypeOpenAIChat {
		t.Fatalf("继承类型 = %d, want %d", got, outbound.OutboundTypeOpenAIChat)
	}

	keyType := outbound.OutboundTypeAnthropic
	key.Type = &keyType
	if got := EffectiveChannelKeyType(channel, key); got != outbound.OutboundTypeAnthropic {
		t.Fatalf("覆盖类型 = %d, want %d", got, outbound.OutboundTypeAnthropic)
	}
}

func TestOptionalOutboundTypeUnmarshalJSON(t *testing.T) {
	var withValue struct {
		Type OptionalOutboundType `json:"type"`
	}
	if err := json.Unmarshal([]byte(`{"type":6}`), &withValue); err != nil {
		t.Fatalf("json.Unmarshal value error = %v", err)
	}
	if !withValue.Type.Set || withValue.Type.Value == nil || *withValue.Type.Value != outbound.OutboundTypeNewAPIChat {
		t.Fatalf("type = %#v, want set New API Chat", withValue.Type)
	}

	var withNull struct {
		Type OptionalOutboundType `json:"type"`
	}
	if err := json.Unmarshal([]byte(`{"type":null}`), &withNull); err != nil {
		t.Fatalf("json.Unmarshal null error = %v", err)
	}
	if !withNull.Type.Set || withNull.Type.Value != nil {
		t.Fatalf("type = %#v, want explicit null", withNull.Type)
	}

	var omitted struct {
		Type OptionalOutboundType `json:"type"`
	}
	if err := json.Unmarshal([]byte(`{}`), &omitted); err != nil {
		t.Fatalf("json.Unmarshal omitted error = %v", err)
	}
	if omitted.Type.Set {
		t.Fatalf("type = %#v, want unset", omitted.Type)
	}
}
