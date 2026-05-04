package task

import (
	"context"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/utils/log"
)

func RouteHealthCheckTask() {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	routes, err := op.RouteProfileList(ctx)
	if err != nil {
		log.Warnf("route health list failed: %v", err)
		return
	}
	for _, route := range routes {
		for _, ep := range route.Endpoints {
			if ep.Status != model.RouteEndpointStatusError {
				continue
			}
			if _, _, err := op.RouteEndpointValidate(ep, ctx); err != nil {
				_ = op.RouteEndpointMarkStatus(ep.ID, model.RouteEndpointStatusError, err.Error(), ctx)
				continue
			}
			_ = op.RouteEndpointMarkStatus(ep.ID, model.RouteEndpointStatusNormal, "", ctx)
		}
	}
}
