package op

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/zkk520/uni-router/internal/model"
)

func setupTestLogDB(t *testing.T) context.Context {
	t.Helper()
	ctx := setupTestDB(t)
	relayLogCacheLock.Lock()
	relayLogCache = make([]model.RelayLog, 0, relayLogMaxSize)
	relayLogCacheLock.Unlock()
	return ctx
}

func TestRelayLogSummaryListOmitsContentAndKeepsLengths(t *testing.T) {
	ctx := setupTestLogDB(t)
	relayLog := model.RelayLog{
		Time:             time.Now().Unix(),
		RequestModelName: "gpt-test",
		ChannelName:      "channel-test",
		ActualModelName:  "gpt-test",
		RequestContent:   `{"message":"hello"}`,
		ResponseContent:  `{"message":"world"}`,
	}
	if err := RelayLogAdd(ctx, relayLog); err != nil {
		t.Fatalf("add relay log: %v", err)
	}
	if err := RelayLogSaveDBTask(ctx); err != nil {
		t.Fatalf("flush relay log: %v", err)
	}

	logs, err := RelayLogSummaryListWithFilter(ctx, RelayLogFilter{}, 1, 10)
	if err != nil {
		t.Fatalf("list summary logs: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 summary log, got %d", len(logs))
	}
	got := logs[0]
	if got.RequestContent != "" || got.ResponseContent != "" {
		t.Fatalf("summary should omit content, got request=%q response=%q", got.RequestContent, got.ResponseContent)
	}
	if got.RequestContentLength != len(relayLog.RequestContent) {
		t.Fatalf("expected request length %d, got %d", len(relayLog.RequestContent), got.RequestContentLength)
	}
	if got.ResponseContentLength != len(relayLog.ResponseContent) {
		t.Fatalf("expected response length %d, got %d", len(relayLog.ResponseContent), got.ResponseContentLength)
	}
	if !got.HasRequestContent || !got.HasResponseContent {
		t.Fatalf("expected content flags to be true")
	}
}

func TestRelayLogGetReturnsFullContent(t *testing.T) {
	ctx := setupTestLogDB(t)
	relayLog := model.RelayLog{
		Time:             time.Now().Unix(),
		RequestModelName: "gpt-test",
		ChannelName:      "channel-test",
		ActualModelName:  "gpt-test",
		RequestContent:   `{"message":"hello"}`,
		ResponseContent:  `{"message":"world"}`,
	}
	if err := RelayLogAdd(ctx, relayLog); err != nil {
		t.Fatalf("add relay log: %v", err)
	}
	if err := RelayLogSaveDBTask(ctx); err != nil {
		t.Fatalf("flush relay log: %v", err)
	}

	summaries, err := RelayLogSummaryListWithFilter(ctx, RelayLogFilter{}, 1, 10)
	if err != nil {
		t.Fatalf("list summary logs: %v", err)
	}
	full, err := RelayLogGet(ctx, summaries[0].ID)
	if err != nil {
		t.Fatalf("get relay log: %v", err)
	}
	if full.RequestContent != relayLog.RequestContent {
		t.Fatalf("expected full request content")
	}
	if full.ResponseContent != relayLog.ResponseContent {
		t.Fatalf("expected full response content")
	}
}

func TestRelayLogAddTruncatesContentBySettings(t *testing.T) {
	ctx := setupTestLogDB(t)
	if err := SettingSetInt(model.SettingKeyRelayLogRequestMaxBytes, 32); err != nil {
		t.Fatalf("set request limit: %v", err)
	}
	if err := SettingSetInt(model.SettingKeyRelayLogResponseMaxBytes, 32); err != nil {
		t.Fatalf("set response limit: %v", err)
	}

	relayLog := model.RelayLog{
		Time:             time.Now().Unix(),
		RequestModelName: "gpt-test",
		ChannelName:      "channel-test",
		ActualModelName:  "gpt-test",
		RequestContent:   strings.Repeat("你", 40),
		ResponseContent:  strings.Repeat("a", 80),
	}
	if err := RelayLogAdd(ctx, relayLog); err != nil {
		t.Fatalf("add relay log: %v", err)
	}

	summaries, err := RelayLogSummaryListWithFilter(ctx, RelayLogFilter{}, 1, 10)
	if err != nil {
		t.Fatalf("list summary logs: %v", err)
	}
	full, err := RelayLogGet(ctx, summaries[0].ID)
	if err != nil {
		t.Fatalf("get relay log: %v", err)
	}
	if len(full.RequestContent) > 32 {
		t.Fatalf("request content exceeds limit: %d", len(full.RequestContent))
	}
	if len(full.ResponseContent) > 32 {
		t.Fatalf("response content exceeds limit: %d", len(full.ResponseContent))
	}
	if !strings.HasSuffix(full.RequestContent, relayLogContentTruncatedSuffix) {
		t.Fatalf("request content should have truncation suffix")
	}
	if !strings.HasSuffix(full.ResponseContent, relayLogContentTruncatedSuffix) {
		t.Fatalf("response content should have truncation suffix")
	}
}

func TestRelayLogAddAllowsDisablingContentStorage(t *testing.T) {
	ctx := setupTestLogDB(t)
	if err := SettingSetInt(model.SettingKeyRelayLogRequestMaxBytes, 0); err != nil {
		t.Fatalf("set request limit: %v", err)
	}
	if err := SettingSetInt(model.SettingKeyRelayLogResponseMaxBytes, 0); err != nil {
		t.Fatalf("set response limit: %v", err)
	}

	relayLog := model.RelayLog{
		Time:             time.Now().Unix(),
		RequestModelName: "gpt-test",
		ChannelName:      "channel-test",
		ActualModelName:  "gpt-test",
		RequestContent:   `{"message":"hello"}`,
		ResponseContent:  `{"message":"world"}`,
	}
	if err := RelayLogAdd(ctx, relayLog); err != nil {
		t.Fatalf("add relay log: %v", err)
	}

	summaries, err := RelayLogSummaryListWithFilter(ctx, RelayLogFilter{}, 1, 10)
	if err != nil {
		t.Fatalf("list summary logs: %v", err)
	}
	full, err := RelayLogGet(ctx, summaries[0].ID)
	if err != nil {
		t.Fatalf("get relay log: %v", err)
	}
	if full.RequestContent != "" || full.ResponseContent != "" {
		t.Fatalf("expected content storage to be disabled")
	}
}
