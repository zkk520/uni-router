package helper

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/zkk520/uni-router/internal/client"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/utils/log"
)

func ChannelHttpClient(channel *model.Channel) (*http.Client, error) {
	return channelHTTPClient(channel, false)
}

func ChannelStreamHttpClient(channel *model.Channel) (*http.Client, error) {
	return channelHTTPClient(channel, true)
}

func channelHTTPClient(channel *model.Channel, stream bool) (*http.Client, error) {
	if channel == nil {
		return nil, errors.New("channel is nil")
	}
	if !channel.Proxy {
		if stream {
			return client.GetHTTPClientSystemProxyForStream(false)
		}
		return client.GetHTTPClientSystemProxy(false)
	} else if channel.ChannelProxy == nil || strings.TrimSpace(*channel.ChannelProxy) == "" {
		if stream {
			return client.GetHTTPClientSystemProxyForStream(true)
		}
		return client.GetHTTPClientSystemProxy(true)
	} else {
		proxyURL := strings.TrimSpace(*channel.ChannelProxy)
		if stream {
			return client.GetHTTPClientCustomProxyForStream(proxyURL)
		}
		return client.GetHTTPClientCustomProxy(proxyURL)
	}
}

func ChannelBaseUrlDelayUpdate(channel *model.Channel, ctx context.Context) {
	if channel == nil {
		return
	}
	newBaseUrls := make([]model.BaseUrl, 0, len(channel.BaseUrls))
	for _, baseUrl := range channel.BaseUrls {
		if baseUrl.URL == "" {
			continue
		}
		httpClient, err := ChannelHttpClient(channel)
		if err != nil {
			log.Warnf("failed to get http client (channel=%d): %v", channel.ID, err)
			continue
		}
		delay, err := GetUrlDelay(httpClient, baseUrl.URL, ctx)
		if err != nil {
			log.Warnf("failed to get url delay (channel=%d): %v", channel.ID, err)
			continue
		}
		newBaseUrls = append(newBaseUrls, model.BaseUrl{
			URL:   baseUrl.URL,
			Delay: delay,
		})
	}
	if len(newBaseUrls) > 0 {
		op.ChannelBaseUrlUpdate(channel.ID, newBaseUrls)
	}
}
