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
	if hasVersionPathSegment(parsed.Path) {
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

func hasVersionPathSegment(pathValue string) bool {
	for _, part := range strings.Split(pathValue, "/") {
		if isVersionSegment(part) {
			return true
		}
	}
	return false
}

func isVersionSegment(segment string) bool {
	if len(segment) < 2 || segment[0] != 'v' {
		return false
	}
	for _, r := range segment[1:] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
