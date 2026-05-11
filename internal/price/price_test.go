package price

import "testing"

func TestListLLMPricePresetsIncludesConfirmedProviders(t *testing.T) {
	presets := ListLLMPricePresets()
	if len(presets) == 0 {
		t.Fatal("expected price presets")
	}

	want := map[string]bool{
		"gpt-5.5":                false,
		"claude-opus-4-7":        false,
		"gemini-3-flash-preview": false,
		"deepseek-v4-flash":      false,
		"grok-4.3":               false,
		"qwen3.6-plus":           false,
		"glm-5.1":                false,
		"minimax-m2.7":           false,
		"kimi-k2.6":              false,
		"v0-1.5-md":              false,
	}
	for i, preset := range presets {
		if i > 0 && presets[i-1].Name > preset.Name {
			t.Fatalf("expected presets sorted by name, got %q before %q", presets[i-1].Name, preset.Name)
		}
		if _, ok := want[preset.Name]; ok {
			want[preset.Name] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Fatalf("expected preset %q", name)
		}
	}
}
