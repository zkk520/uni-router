package relay

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	dbmodel "github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/gin-gonic/gin"
)

func handleRoute(internalRequest *model.InternalLLMRequest, inAdapter model.Inbound, apiKeyID int, requestModel string, routerID int, c *gin.Context) {
	routeDetail, err := op.RouteProfileGet(routerID, c.Request.Context())
	if err != nil || len(routeDetail.Endpoints) == 0 {
		resp.Error(c, http.StatusServiceUnavailable, "router not available")
		return
	}
	route := routeDetail.RouteProfile
	candidates := op.RouteSelectCandidates(route)
	if len(candidates) == 0 {
		resp.Error(c, http.StatusServiceUnavailable, "no available endpoint")
		return
	}

	metrics := NewRelayMetrics(apiKeyID, requestModel, internalRequest)
	metrics.RouterID = route.ID
	metrics.RouterName = route.Name
	req := &relayRequest{
		c:               c,
		inAdapter:       inAdapter,
		internalRequest: internalRequest,
		metrics:         metrics,
		apiKeyID:        apiKeyID,
		requestModel:    requestModel,
		routerID:        route.ID,
		routerName:      route.Name,
	}

	var lastErr error
	for idx, ep := range candidates {
		select {
		case <-c.Request.Context().Done():
			metrics.Save(c.Request.Context(), false, context.Canceled, req.routeAttempts)
			return
		default:
		}

		channel, usedKey, err := op.RouteEndpointValidate(ep, c.Request.Context())
		if err != nil {
			req.addRouteAttempt(ep, nil, dbmodel.AttemptSkipped, 0, err.Error())
			lastErr = err
			continue
		}

		outAdapter := outbound.Get(channel.Type)
		if outAdapter == nil {
			msg := fmt.Sprintf("unsupported channel type: %d", channel.Type)
			req.addRouteAttempt(ep, channel, dbmodel.AttemptSkipped, 0, msg)
			lastErr = fmt.Errorf("%s", msg)
			continue
		}
		if internalRequest.IsEmbeddingRequest() && !outbound.IsEmbeddingChannelType(channel.Type) {
			msg := "channel type not compatible with embedding request"
			req.addRouteAttempt(ep, channel, dbmodel.AttemptSkipped, 0, msg)
			lastErr = fmt.Errorf("%s", msg)
			continue
		}
		if internalRequest.IsChatRequest() && !outbound.IsChatChannelType(channel.Type) {
			msg := "channel type not compatible with chat request"
			req.addRouteAttempt(ep, channel, dbmodel.AttemptSkipped, 0, msg)
			lastErr = fmt.Errorf("%s", msg)
			continue
		}

		internalRequest.Model = op.RouteRequestModel(requestModel)
		req.endpointID = ep.ID
		req.endpointName = ep.Name
		metrics.EndpointID = ep.ID
		metrics.EndpointName = ep.Name
		metrics.SetPricingContext(channel, usedKey)

		log.Infof("router %s forwarding model %s to endpoint %s/channel %s model %s (attempt %d/%d)",
			route.Name, requestModel, ep.Name, channel.Name, internalRequest.Model, idx+1, len(candidates))

		ra := &relayAttempt{
			relayRequest: req,
			outAdapter:   outAdapter,
			channel:      channel,
			usedKey:      usedKey,
		}
		span := req.startRouteAttempt(ep, channel, usedKey)
		statusCode, fwdErr := ra.forward()
		usedKey.StatusCode = statusCode
		usedKey.LastUseTimeStamp = time.Now().Unix()

		if fwdErr == nil {
			ra.collectResponse()
			usedKey.TotalCost += metrics.Stats.InputCost + metrics.Stats.OutputCost
			op.ChannelKeyUpdate(usedKey)
			span(dbmodel.AttemptSuccess, statusCode, "")
			_ = op.RouteEndpointMarkStatus(ep.ID, dbmodel.RouteEndpointStatusNormal, "", c.Request.Context())
			metrics.Save(c.Request.Context(), true, nil, req.routeAttempts)
			return
		}
		op.ChannelKeyUpdate(usedKey)

		written := c.Writer.Written()
		if written {
			ra.collectResponse()
		}
		span(dbmodel.AttemptFailed, statusCode, fwdErr.Error())
		lastErr = fmt.Errorf("endpoint %s failed: %v", ep.Name, fwdErr)
		if shouldTripRouteEndpoint(statusCode, fwdErr) {
			_ = op.RouteEndpointMarkStatus(ep.ID, dbmodel.RouteEndpointStatusError, fwdErr.Error(), c.Request.Context())
		}
		if written || !route.FailoverEnabled {
			metrics.Save(c.Request.Context(), false, lastErr, req.routeAttempts)
			return
		}
	}

	metrics.Save(c.Request.Context(), false, lastErr, req.routeAttempts)
	resp.Error(c, http.StatusBadGateway, "all endpoints failed")
}

func (r *relayRequest) addRouteAttempt(ep dbmodel.RouteEndpoint, channel *dbmodel.Channel, status dbmodel.AttemptStatus, statusCode int, msg string) {
	r.routeAttemptNum++
	channelID := ep.ChannelID
	channelName := fmt.Sprintf("channel_%d", ep.ChannelID)
	if channel != nil {
		channelID = channel.ID
		channelName = channel.Name
	}
	r.routeAttempts = append(r.routeAttempts, dbmodel.ChannelAttempt{
		ChannelID:    channelID,
		ChannelKeyID: ep.ChannelKeyID,
		ChannelName:  channelName,
		EndpointID:   ep.ID,
		EndpointName: ep.Name,
		ModelName:    r.internalRequest.Model,
		AttemptNum:   r.routeAttemptNum,
		Status:       status,
		Msg:          msg,
	})
}

func (r *relayRequest) startRouteAttempt(ep dbmodel.RouteEndpoint, channel *dbmodel.Channel, key dbmodel.ChannelKey) func(dbmodel.AttemptStatus, int, string) {
	r.routeAttemptNum++
	start := time.Now()
	attempt := dbmodel.ChannelAttempt{
		ChannelID:    channel.ID,
		ChannelKeyID: key.ID,
		ChannelName:  channel.Name,
		EndpointID:   ep.ID,
		EndpointName: ep.Name,
		ModelName:    r.internalRequest.Model,
		AttemptNum:   r.routeAttemptNum,
	}
	return func(status dbmodel.AttemptStatus, statusCode int, msg string) {
		attempt.Status = status
		attempt.Duration = int(time.Since(start).Milliseconds())
		attempt.Msg = msg
		r.routeAttempts = append(r.routeAttempts, attempt)
	}
}

func shouldTripRouteEndpoint(statusCode int, err error) bool {
	if err == nil {
		return false
	}
	if statusCode == http.StatusTooManyRequests || statusCode >= 500 {
		return true
	}
	if statusCode >= 400 && statusCode < 500 {
		return false
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded") {
		return true
	}
	if strings.Contains(msg, "insufficient") || strings.Contains(msg, "balance") || strings.Contains(msg, "quota") {
		return true
	}
	return statusCode == 0
}
