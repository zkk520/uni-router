package client

import (
	"context"
	"net/http"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
)

func resetHTTPClientCacheForTest() {
	clientLock.Lock()
	defer clientLock.Unlock()
	systemDirectClient = nil
	systemProxyClient = nil
	systemProxyURL = ""
	systemDirectStreamClient = nil
	systemProxyStreamClient = nil
	systemProxyStreamURL = ""
}

func transportForTest(t *testing.T, hc *http.Client) *http.Transport {
	t.Helper()
	transport, ok := hc.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", hc.Transport)
	}
	return transport
}

func setupSettingsForTest(t *testing.T) context.Context {
	t.Helper()
	resetHTTPClientCacheForTest()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := db.InitDB("sqlite", dbPath, false); err != nil {
		t.Fatalf("init db: %v", err)
	}
	t.Cleanup(func() {
		resetHTTPClientCacheForTest()
		if err := db.Close(); err != nil {
			t.Fatalf("close db: %v", err)
		}
	})
	if err := op.InitCache(); err != nil {
		t.Fatalf("init cache: %v", err)
	}
	return context.Background()
}

func TestHTTPClientTimeoutProfiles(t *testing.T) {
	resetHTTPClientCacheForTest()

	normalClient, err := GetHTTPClientSystemProxy(false)
	if err != nil {
		t.Fatalf("get normal client: %v", err)
	}
	if normalClient.Timeout != 30*time.Second {
		t.Fatalf("expected normal client timeout 30s, got %v", normalClient.Timeout)
	}
	normalTransport := transportForTest(t, normalClient)
	if normalTransport.ResponseHeaderTimeout != 0 {
		t.Fatalf("expected normal response header timeout 0, got %v", normalTransport.ResponseHeaderTimeout)
	}

	streamClient, err := GetHTTPClientSystemProxyForStream(false)
	if err != nil {
		t.Fatalf("get stream client: %v", err)
	}
	if streamClient.Timeout != 0 {
		t.Fatalf("expected stream client timeout 0, got %v", streamClient.Timeout)
	}
	streamTransport := transportForTest(t, streamClient)
	if streamTransport.ResponseHeaderTimeout != 60*time.Second {
		t.Fatalf("expected stream response header timeout 60s, got %v", streamTransport.ResponseHeaderTimeout)
	}
}

func TestHTTPClientProxyProfiles(t *testing.T) {
	setupSettingsForTest(t)
	if err := op.SettingSetString(model.SettingKeyProxyURL, "http://127.0.0.1:7890"); err != nil {
		t.Fatalf("set proxy url: %v", err)
	}

	systemProxyClient, err := GetHTTPClientSystemProxy(true)
	if err != nil {
		t.Fatalf("get system proxy client: %v", err)
	}
	if systemProxyClient.Timeout != 30*time.Second {
		t.Fatalf("expected system proxy client timeout 30s, got %v", systemProxyClient.Timeout)
	}

	systemProxyStreamClient, err := GetHTTPClientSystemProxyForStream(true)
	if err != nil {
		t.Fatalf("get system proxy stream client: %v", err)
	}
	if systemProxyStreamClient.Timeout != 0 {
		t.Fatalf("expected system proxy stream client timeout 0, got %v", systemProxyStreamClient.Timeout)
	}
	systemProxyStreamTransport := transportForTest(t, systemProxyStreamClient)
	if systemProxyStreamTransport.ResponseHeaderTimeout != 60*time.Second {
		t.Fatalf("expected system proxy stream response header timeout 60s, got %v", systemProxyStreamTransport.ResponseHeaderTimeout)
	}
	if systemProxyStreamTransport.Proxy == nil {
		t.Fatalf("expected system proxy stream transport to have an HTTP proxy")
	}

	customProxyClient, err := GetHTTPClientCustomProxy("http://127.0.0.1:7890")
	if err != nil {
		t.Fatalf("get custom proxy client: %v", err)
	}
	if customProxyClient.Timeout != 30*time.Second {
		t.Fatalf("expected custom proxy client timeout 30s, got %v", customProxyClient.Timeout)
	}
	customProxyTransport := transportForTest(t, customProxyClient)
	reqURL, _ := url.Parse("https://example.com")
	proxyURL, err := customProxyTransport.Proxy(&http.Request{URL: reqURL})
	if err != nil {
		t.Fatalf("resolve custom proxy url: %v", err)
	}
	if proxyURL == nil || proxyURL.String() != "http://127.0.0.1:7890" {
		t.Fatalf("expected custom HTTP proxy url, got %v", proxyURL)
	}

	customProxyStreamClient, err := GetHTTPClientCustomProxyForStream("http://127.0.0.1:7890")
	if err != nil {
		t.Fatalf("get custom proxy stream client: %v", err)
	}
	if customProxyStreamClient.Timeout != 0 {
		t.Fatalf("expected custom proxy stream client timeout 0, got %v", customProxyStreamClient.Timeout)
	}
	customProxyStreamTransport := transportForTest(t, customProxyStreamClient)
	if customProxyStreamTransport.ResponseHeaderTimeout != 60*time.Second {
		t.Fatalf("expected custom proxy stream response header timeout 60s, got %v", customProxyStreamTransport.ResponseHeaderTimeout)
	}
}

func TestHTTPClientSocksProxyProfiles(t *testing.T) {
	resetHTTPClientCacheForTest()

	socksClient, err := GetHTTPClientCustomProxy("socks5://127.0.0.1:7891")
	if err != nil {
		t.Fatalf("get socks proxy client: %v", err)
	}
	if socksClient.Timeout != 30*time.Second {
		t.Fatalf("expected socks client timeout 30s, got %v", socksClient.Timeout)
	}
	socksTransport := transportForTest(t, socksClient)
	if socksTransport.Proxy != nil {
		t.Fatalf("expected socks transport Proxy nil because DialContext handles socks")
	}
	if socksTransport.DialContext == nil {
		t.Fatalf("expected socks transport DialContext")
	}

	socksStreamClient, err := GetHTTPClientCustomProxyForStream("socks5://127.0.0.1:7891")
	if err != nil {
		t.Fatalf("get socks proxy stream client: %v", err)
	}
	if socksStreamClient.Timeout != 0 {
		t.Fatalf("expected socks stream client timeout 0, got %v", socksStreamClient.Timeout)
	}
	socksStreamTransport := transportForTest(t, socksStreamClient)
	if socksStreamTransport.ResponseHeaderTimeout != 60*time.Second {
		t.Fatalf("expected socks stream response header timeout 60s, got %v", socksStreamTransport.ResponseHeaderTimeout)
	}
	if socksStreamTransport.Proxy != nil {
		t.Fatalf("expected socks stream transport Proxy nil because DialContext handles socks")
	}
	if socksStreamTransport.DialContext == nil {
		t.Fatalf("expected socks stream transport DialContext")
	}
}
