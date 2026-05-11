package price

import "testing"

func TestListLLMPricePresetsIncludesKnownProviders(t *testing.T) {
	presets := ListLLMPricePresets()
	if len(presets) == 0 {
		t.Fatal("expected price presets")
	}

	var hasClaude, hasGemini bool
	for i, preset := range presets {
		if i > 0 && presets[i-1].Name > preset.Name {
			t.Fatalf("expected presets sorted by name, got %q before %q", presets[i-1].Name, preset.Name)
		}
		switch preset.Name {
		case "claude-3-5-sonnet-20241022":
			hasClaude = true
		case "gemini-2.5-pro":
			hasGemini = true
		}
	}
	if !hasClaude {
		t.Fatal("expected claude preset")
	}
	if !hasGemini {
		t.Fatal("expected gemini preset")
	}
}
