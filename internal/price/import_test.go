package price

import (
	"strings"
	"testing"
)

func TestParsePriceImportStandardJSON(t *testing.T) {
	input := `{
		"version": 1,
		"source": {
			"site": "ai.centos.hk",
			"url": "https://ai.centos.hk/pricing",
			"captured_at": "2026-05-09T12:00:00+08:00",
			"capture_method": "bookmarklet"
		},
		"models": [{
			"name": "gpt-5.5",
			"groups": [{
				"name": "gpt-pro分组",
				"billing_mode": "token",
				"currency": "CNY",
				"unit": "per_1m_tokens",
				"input": 1.5,
				"output": 9,
				"cache_read": 0.15
			}]
		}]
	}`

	res, err := ParsePriceImport(PriceImportParseRequest{
		Template: "standard_json",
		Content:  input,
	})
	if err != nil {
		t.Fatalf("ParsePriceImport returned error: %v", err)
	}
	if len(res.Rules) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(res.Rules))
	}
	rule := res.Rules[0]
	if rule.ProviderName != "ai.centos.hk" {
		t.Fatalf("expected provider ai.centos.hk, got %q", rule.ProviderName)
	}
	if rule.ModelName != "gpt-5.5" || rule.GroupName != "gpt-pro分组" {
		t.Fatalf("unexpected model/group: %q/%q", rule.ModelName, rule.GroupName)
	}
	if rule.Currency != "CNY" || rule.BillingMode != "token" || rule.Unit != "per_1m_tokens" {
		t.Fatalf("unexpected billing metadata: %q %q %q", rule.Currency, rule.BillingMode, rule.Unit)
	}
	if rule.InputPrice != 1.5 || rule.OutputPrice != 9 || rule.CacheReadPrice != 0.15 || rule.CacheWritePrice != 0 {
		t.Fatalf("unexpected prices: %+v", rule)
	}
	if len(res.Warnings) == 0 || !strings.Contains(res.Warnings[0], "cache_write") {
		t.Fatalf("expected missing cache_write warning, got %#v", res.Warnings)
	}
}

func TestParsePriceImportNewAPIText(t *testing.T) {
	input := `
gpt-5.5
分组价格
不同用户分组的价格信息
分组        计费类型        价格摘要
codex特惠分组    按量计费
输入 价格 ¥0.5000
/ 1M Tokens
补全价格 ¥3.0000
/ 1M Tokens
缓存读取价格 ¥0.0500
/ 1M Tokens
gpt-pro分组    按量计费
输入 价格 ¥1.5000
/ 1M Tokens
补全价格 ¥9.0000
/ 1M Tokens
缓存读取价格 ¥0.1500
/ 1M Tokens
`

	res, err := ParsePriceImport(PriceImportParseRequest{
		Template: "new_api_text",
		Content:  input,
	})
	if err != nil {
		t.Fatalf("ParsePriceImport returned error: %v", err)
	}
	if len(res.Rules) != 2 {
		t.Fatalf("expected 2 rules, got %d: %#v", len(res.Rules), res.Rules)
	}

	byGroup := map[string]PriceImportRule{}
	for _, rule := range res.Rules {
		byGroup[rule.GroupName] = rule
		if rule.ModelName != "gpt-5.5" {
			t.Fatalf("expected model gpt-5.5, got %q", rule.ModelName)
		}
		if rule.Currency != "CNY" || rule.Unit != "per_1m_tokens" || rule.BillingMode != "token" {
			t.Fatalf("unexpected billing metadata: %+v", rule)
		}
	}
	if byGroup["codex特惠分组"].InputPrice != 0.5 || byGroup["codex特惠分组"].OutputPrice != 3 || byGroup["codex特惠分组"].CacheReadPrice != 0.05 {
		t.Fatalf("unexpected codex prices: %+v", byGroup["codex特惠分组"])
	}
	if byGroup["gpt-pro分组"].InputPrice != 1.5 || byGroup["gpt-pro分组"].OutputPrice != 9 || byGroup["gpt-pro分组"].CacheReadPrice != 0.15 {
		t.Fatalf("unexpected gpt-pro prices: %+v", byGroup["gpt-pro分组"])
	}
}
