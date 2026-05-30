package client

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"golang.org/x/net/proxy"
)

var (
	systemDirectClient       *http.Client
	systemProxyClient        *http.Client
	systemProxyURL           string
	systemDirectStreamClient *http.Client
	systemProxyStreamClient  *http.Client
	systemProxyStreamURL     string
	clientLock               sync.RWMutex
)

const (
	defaultHTTPClientTimeout    = 30 * time.Second
	streamResponseHeaderTimeout = 60 * time.Second
)

// GetHTTPClientSystemProxy returns a cached http.Client.
// - useProxy=false: bypass proxy
// - useProxy=true: use proxy settings from system/app settings (setting key: proxy_url)
func GetHTTPClientSystemProxy(useProxy bool) (*http.Client, error) {
	return getHTTPClientSystemProxy(useProxy, false)
}

// GetHTTPClientSystemProxyForStream 返回用于流式响应的缓存客户端。
// 流式客户端不设置 http.Client.Timeout，避免整个响应体读取被总时限截断。
func GetHTTPClientSystemProxyForStream(useProxy bool) (*http.Client, error) {
	return getHTTPClientSystemProxy(useProxy, true)
}

func getHTTPClientSystemProxy(useProxy bool, stream bool) (*http.Client, error) {
	if useProxy {
		currentProxyURL, err := op.SettingGetString(model.SettingKeyProxyURL)
		if err != nil {
			return nil, err
		}
		if currentProxyURL == "" {
			return nil, fmt.Errorf("proxy url is empty")
		}

		clientLock.RLock()
		if stream {
			if systemProxyStreamClient != nil && systemProxyStreamURL == currentProxyURL {
				clientLock.RUnlock()
				return systemProxyStreamClient, nil
			}
		} else {
			if systemProxyClient != nil && systemProxyURL == currentProxyURL {
				clientLock.RUnlock()
				return systemProxyClient, nil
			}
		}
		clientLock.RUnlock()

		clientLock.Lock()
		defer clientLock.Unlock()

		// Re-check after acquiring write lock.
		if stream {
			if systemProxyStreamClient != nil && systemProxyStreamURL == currentProxyURL {
				return systemProxyStreamClient, nil
			}
		} else {
			if systemProxyClient != nil && systemProxyURL == currentProxyURL {
				return systemProxyClient, nil
			}
		}

		client, err := newHTTPClientCustomProxyWithStream(currentProxyURL, stream)
		if err != nil {
			return nil, err
		}
		if stream {
			systemProxyStreamClient = client
			systemProxyStreamURL = currentProxyURL
			return systemProxyStreamClient, nil
		}
		systemProxyClient = client
		systemProxyURL = currentProxyURL
		return systemProxyClient, nil
	}

	clientLock.RLock()
	if stream {
		if systemDirectStreamClient != nil {
			clientLock.RUnlock()
			return systemDirectStreamClient, nil
		}
	} else {
		if systemDirectClient != nil {
			clientLock.RUnlock()
			return systemDirectClient, nil
		}
	}
	clientLock.RUnlock()

	clientLock.Lock()
	defer clientLock.Unlock()

	if stream {
		if systemDirectStreamClient != nil {
			return systemDirectStreamClient, nil
		}
	} else {
		if systemDirectClient != nil {
			return systemDirectClient, nil
		}
	}
	client, err := newHTTPClientNoProxyWithStream(stream)
	if err != nil {
		return nil, err
	}
	if stream {
		systemDirectStreamClient = client
		return systemDirectStreamClient, nil
	}
	systemDirectClient = client
	return systemDirectClient, nil
}

// GetHTTPClientCustomProxy returns a NEW http.Client every time (no reuse).
// proxyURL supports: http, https, socks, socks5
func GetHTTPClientCustomProxy(proxyURL string) (*http.Client, error) {
	if proxyURL == "" {
		return nil, fmt.Errorf("proxy url is empty")
	}
	return newHTTPClientCustomProxy(proxyURL)
}

// GetHTTPClientCustomProxyForStream 每次返回新的流式 http.Client（不复用）。
// proxyURL 支持：http、https、socks、socks5。
func GetHTTPClientCustomProxyForStream(proxyURL string) (*http.Client, error) {
	if proxyURL == "" {
		return nil, fmt.Errorf("proxy url is empty")
	}
	return newHTTPClientCustomProxyWithStream(proxyURL, true)
}

func clonedDefaultTransport() (*http.Transport, error) {
	transport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return nil, fmt.Errorf("default transport is not *http.Transport")
	}
	return transport.Clone(), nil
}

func newHTTPClientNoProxy() (*http.Client, error) {
	return newHTTPClientNoProxyWithStream(false)
}

func newHTTPClientNoProxyWithStream(stream bool) (*http.Client, error) {
	cloned, err := clonedDefaultTransport()
	if err != nil {
		return nil, err
	}
	cloned.Proxy = nil
	return newHTTPClient(cloned, stream), nil
}

func newHTTPClientCustomProxy(proxyURLStr string) (*http.Client, error) {
	return newHTTPClientCustomProxyWithStream(proxyURLStr, false)
}

func newHTTPClientCustomProxyWithStream(proxyURLStr string, stream bool) (*http.Client, error) {
	cloned, err := clonedDefaultTransport()
	if err != nil {
		return nil, err
	}

	proxyURL, err := url.Parse(proxyURLStr)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy url: %w", err)
	}

	switch proxyURL.Scheme {
	case "http", "https":
		cloned.Proxy = http.ProxyURL(proxyURL)
	case "socks", "socks5":
		socksDialer, err := proxy.FromURL(proxyURL, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("invalid socks proxy: %w", err)
		}
		cloned.Proxy = nil
		cloned.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return socksDialer.Dial(network, addr)
		}
	default:
		return nil, fmt.Errorf("unsupported proxy scheme: %s", proxyURL.Scheme)
	}

	return newHTTPClient(cloned, stream), nil
}

func newHTTPClient(transport *http.Transport, stream bool) *http.Client {
	if stream {
		transport.ResponseHeaderTimeout = streamResponseHeaderTimeout
		return &http.Client{Transport: transport}
	}
	return &http.Client{Transport: transport, Timeout: defaultHTTPClientTimeout}
}
