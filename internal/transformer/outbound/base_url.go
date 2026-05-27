package outbound

import (
	"fmt"
	"net/url"
	"strings"
)

func NormalizeBaseURL(baseURL string, keyType OutboundType) (string, error) {
	trimmed := strings.TrimSpace(baseURL)
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("failed to parse base url: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid base url: %s", baseURL)
	}
	if !isOpenAICompatibleType(keyType) {
		return trimmed, nil
	}
	if hasPathSegment(parsed.Path, "v1") {
		return parsed.String(), nil
	}

	basePath := strings.TrimRight(parsed.Path, "/")
	parsed.Path = basePath + "/v1"
	return parsed.String(), nil
}

func isOpenAICompatibleType(keyType OutboundType) bool {
	switch keyType {
	case OutboundTypeOpenAIChat,
		OutboundTypeNewAPIChat,
		OutboundTypeOpenAIResponse,
		OutboundTypeOpenAIEmbedding:
		return true
	default:
		return false
	}
}

func hasPathSegment(pathValue, segment string) bool {
	for _, part := range strings.Split(pathValue, "/") {
		if part == segment {
			return true
		}
	}
	return false
}
