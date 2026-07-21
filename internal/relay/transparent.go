package relay

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tmaxmax/go-sse"
	"github.com/zkk520/uni-router/internal/conf"
	"github.com/zkk520/uni-router/internal/transformer/inbound"
	transformermodel "github.com/zkk520/uni-router/internal/transformer/model"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
	"github.com/zkk520/uni-router/internal/utils/log"
)

const transparentObserverBuffer = 64

func inboundAPIFormat(inboundType inbound.InboundType) transformermodel.APIFormat {
	switch inboundType {
	case inbound.InboundTypeOpenAIChat:
		return transformermodel.APIFormatOpenAIChatCompletion
	case inbound.InboundTypeOpenAIResponse:
		return transformermodel.APIFormatOpenAIResponse
	case inbound.InboundTypeAnthropic:
		return transformermodel.APIFormatAnthropicMessage
	case inbound.InboundTypeGemini:
		return transformermodel.APIFormatGeminiContents
	case inbound.InboundTypeOpenAIEmbedding:
		return transformermodel.APIFormatOpenAIEmbedding
	default:
		return ""
	}
}

func isTransparentProtocolPair(format transformermodel.APIFormat, keyType outbound.OutboundType) bool {
	switch format {
	case transformermodel.APIFormatOpenAIResponse:
		return keyType == outbound.OutboundTypeOpenAIResponse
	case transformermodel.APIFormatOpenAIChatCompletion:
		return keyType == outbound.OutboundTypeOpenAIChat || keyType == outbound.OutboundTypeNewAPIChat
	case transformermodel.APIFormatAnthropicMessage:
		return keyType == outbound.OutboundTypeAnthropic
	case transformermodel.APIFormatOpenAIEmbedding:
		return keyType == outbound.OutboundTypeOpenAIEmbedding
	default:
		return false
	}
}

func (ra *relayAttempt) useTransparentRelay() bool {
	return conf.AppConfig.Relay.TransparentSameProtocol &&
		len(ra.internalRequest.RawRequest) > 0 &&
		ra.internalRequest.Model == ra.requestModel &&
		isTransparentProtocolPair(ra.internalRequest.RawAPIFormat, ra.keyType)
}

func prepareTransparentRequest(req *http.Request, rawBody []byte, baseURL string, incomingQuery url.Values) error {
	configuredURL, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("failed to parse transparent base url: %w", err)
	}

	mergedQuery := req.URL.Query()
	configuredQuery := configuredURL.Query()
	for key, values := range incomingQuery {
		if _, configured := configuredQuery[key]; configured {
			continue
		}
		mergedQuery[key] = append([]string(nil), values...)
	}
	for key, values := range configuredQuery {
		mergedQuery[key] = append([]string(nil), values...)
	}
	req.URL.RawQuery = mergedQuery.Encode()

	body := append([]byte(nil), rawBody...)
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
	return nil
}

func copyTransparentResponseHeaders(dst, src http.Header) {
	for key, values := range src {
		if hopByHopHeaders[strings.ToLower(key)] {
			continue
		}
		dst.Del(key)
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func (ra *relayAttempt) handleTransparentResponse(ctx context.Context, response *http.Response) error {
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("failed to read transparent response body: %w", err)
	}

	copyTransparentResponseHeaders(ra.c.Writer.Header(), response.Header)
	ra.c.Status(response.StatusCode)
	if _, err := ra.c.Writer.Write(body); err != nil {
		return fmt.Errorf("failed to write transparent response: %w", err)
	}
	ra.observeTransparentResponse(ctx, response, body)
	return nil
}

func (ra *relayAttempt) observeTransparentResponse(ctx context.Context, response *http.Response, body []byte) {
	shadow := new(http.Response)
	*shadow = *response
	shadow.Header = response.Header.Clone()
	shadow.Body = io.NopCloser(bytes.NewReader(body))
	shadow.ContentLength = int64(len(body))

	internalResponse, err := ra.outAdapter.TransformResponse(ctx, shadow)
	if err != nil {
		log.Warnf("failed to observe transparent response: %v", err)
		return
	}
	if _, err := ra.inAdapter.TransformResponse(ctx, internalResponse); err != nil {
		log.Warnf("failed to record transparent response metrics: %v", err)
	}
}

func (ra *relayAttempt) handleTransparentStreamResponse(ctx context.Context, response *http.Response) error {
	copyTransparentResponseHeaders(ra.c.Writer.Header(), response.Header)
	ra.c.Header("X-Accel-Buffering", "no")

	var observer *transparentStreamObserver
	if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		observer = newTransparentStreamObserver(ctx, ra)
		defer observer.Close()
	}

	results := make(chan transparentReadResult, 1)
	stopReads := make(chan struct{})
	defer close(stopReads)
	go func() {
		defer close(results)
		buffer := make([]byte, 32*1024)
		for {
			n, readErr := response.Body.Read(buffer)
			result := transparentReadResult{err: readErr}
			if n > 0 {
				result.chunk = append([]byte(nil), buffer[:n]...)
			}
			select {
			case results <- result:
			case <-stopReads:
				return
			}
			if readErr != nil {
				return
			}
		}
	}()

	firstChunk := true
	var firstTokenTimer *time.Timer
	var firstTokenC <-chan time.Time
	if ra.firstTokenTimeOutSec > 0 {
		firstTokenTimer = time.NewTimer(time.Duration(ra.firstTokenTimeOutSec) * time.Second)
		firstTokenC = firstTokenTimer.C
		defer firstTokenTimer.Stop()
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-firstTokenC:
			_ = response.Body.Close()
			return fmt.Errorf("first token timeout (%ds)", ra.firstTokenTimeOutSec)
		case result, ok := <-results:
			if !ok {
				if firstChunk {
					ra.c.Status(response.StatusCode)
				}
				return nil
			}
			if len(result.chunk) > 0 {
				if firstChunk {
					ra.c.Status(response.StatusCode)
					ra.metrics.SetFirstTokenTime(time.Now())
					firstChunk = false
					if firstTokenTimer != nil {
						if !firstTokenTimer.Stop() {
							select {
							case <-firstTokenTimer.C:
							default:
							}
						}
						firstTokenC = nil
					}
				}
				if _, err := ra.c.Writer.Write(result.chunk); err != nil {
					return fmt.Errorf("failed to write transparent stream: %w", err)
				}
				ra.c.Writer.Flush()
				if observer != nil {
					observer.Observe(result.chunk)
				}
			}
			if result.err != nil {
				if result.err == io.EOF {
					if firstChunk {
						ra.c.Status(response.StatusCode)
					}
					return nil
				}
				return fmt.Errorf("failed to read transparent stream: %w", result.err)
			}
		}
	}
}

type transparentReadResult struct {
	chunk []byte
	err   error
}

type transparentStreamObserver struct {
	chunks   chan []byte
	done     chan struct{}
	disabled bool
}

func newTransparentStreamObserver(ctx context.Context, ra *relayAttempt) *transparentStreamObserver {
	observer := &transparentStreamObserver{
		chunks: make(chan []byte, transparentObserverBuffer),
		done:   make(chan struct{}),
	}
	go observer.run(ctx, ra)
	return observer
}

func (o *transparentStreamObserver) Observe(chunk []byte) {
	if o.disabled {
		return
	}
	copyOfChunk := append([]byte(nil), chunk...)
	select {
	case o.chunks <- copyOfChunk:
	default:
		o.disabled = true
		close(o.chunks)
		log.Warnf("transparent stream observer buffer is full; response forwarding continues without metrics observation")
	}
}

func (o *transparentStreamObserver) Close() {
	if !o.disabled {
		o.disabled = true
		close(o.chunks)
	}
	<-o.done
}

func (o *transparentStreamObserver) run(ctx context.Context, ra *relayAttempt) {
	defer close(o.done)
	reader := &chunkChannelReader{chunks: o.chunks}
	readConfig := &sse.ReadConfig{MaxEventSize: maxSSEEventSize}
	for event, err := range sse.Read(reader, readConfig) {
		if err != nil {
			log.Warnf("failed to observe transparent stream: %v", err)
			return
		}
		internalStream, err := ra.outAdapter.TransformStream(ctx, []byte(event.Data))
		if err != nil {
			log.Warnf("failed to parse transparent stream event for metrics: %v", err)
			continue
		}
		if internalStream == nil {
			continue
		}
		if _, err := ra.inAdapter.TransformStream(ctx, internalStream); err != nil {
			log.Warnf("failed to record transparent stream metrics: %v", err)
		}
	}
}

type chunkChannelReader struct {
	chunks  <-chan []byte
	current []byte
}

func (r *chunkChannelReader) Read(dst []byte) (int, error) {
	for len(r.current) == 0 {
		chunk, ok := <-r.chunks
		if !ok {
			return 0, io.EOF
		}
		r.current = chunk
	}

	n := copy(dst, r.current)
	r.current = r.current[n:]
	return n, nil
}
