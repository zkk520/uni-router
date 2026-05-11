package op

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/utils/cache"
	"gorm.io/gorm"
)

var routeCache = cache.New[int, model.RouteProfile](16)

type RouteProfileDetail struct {
	model.RouteProfile
	BoundAPIKeyCount int           `json:"bound_api_key_count"`
	BoundAPIKey      *model.APIKey `json:"bound_api_key,omitempty"`
}

type RouteOptionChannel struct {
	ID          int                     `json:"id"`
	Name        string                  `json:"name"`
	Enabled     bool                    `json:"enabled"`
	Models      []string                `json:"models"`
	Keys        []RouteOptionChannelKey `json:"keys"`
	PricingRule model.PricingRule       `json:"pricing_rule"`
}

type RouteOptionChannelKey struct {
	ID          int               `json:"id"`
	Enabled     bool              `json:"enabled"`
	Remark      string            `json:"remark"`
	MaskedKey   string            `json:"masked_key"`
	PricingRule model.PricingRule `json:"pricing_rule"`
}

func RouteProfileList(ctx context.Context) ([]RouteProfileDetail, error) {
	routes := make([]RouteProfileDetail, 0, routeCache.Len())
	for _, route := range routeCache.GetAll() {
		boundKey, boundCount := APIKeyByRouter(route.ID, ctx)
		routes = append(routes, RouteProfileDetail{
			RouteProfile:     route,
			BoundAPIKeyCount: boundCount,
			BoundAPIKey:      boundKey,
		})
	}
	sort.Slice(routes, func(i, j int) bool { return routes[i].ID < routes[j].ID })
	return routes, nil
}

func RouteProfileGet(id int, ctx context.Context) (*RouteProfileDetail, error) {
	route, ok := routeCache.Get(id)
	if !ok {
		return nil, fmt.Errorf("router not found")
	}
	boundKey, boundCount := APIKeyByRouter(id, ctx)
	return &RouteProfileDetail{
		RouteProfile:     route,
		BoundAPIKeyCount: boundCount,
		BoundAPIKey:      boundKey,
	}, nil
}

func RouteProfileCreate(route *model.RouteProfile, ctx context.Context) error {
	now := time.Now().Unix()
	route.CreatedAt = now
	route.UpdatedAt = now
	if route.Mode == "" {
		route.Mode = model.RouteModeManual
	}
	if !route.FailoverEnabled {
		route.FailoverEnabled = true
	}
	if err := ensureUniqueRouteEndpoints(route.Endpoints); err != nil {
		return err
	}
	for i := range route.Endpoints {
		normalizeEndpoint(&route.Endpoints[i], now)
	}
	if err := db.GetDB().WithContext(ctx).Create(route).Error; err != nil {
		return fmt.Errorf("failed to create router: %w", err)
	}
	return routeRefreshCacheByID(route.ID, ctx)
}

func RouteProfileUpdate(req *model.RouteProfileUpdateRequest, ctx context.Context) (*RouteProfileDetail, error) {
	oldRoute, ok := routeCache.Get(req.ID)
	if !ok {
		return nil, fmt.Errorf("router not found")
	}
	if len(req.EndpointsToAdd) > 0 {
		deleted := map[int]bool{}
		for _, id := range req.EndpointsToDelete {
			deleted[id] = true
		}
		existing := make([]model.RouteEndpoint, 0, len(oldRoute.Endpoints))
		for _, ep := range oldRoute.Endpoints {
			if !deleted[ep.ID] {
				existing = append(existing, ep)
			}
		}
		if err := ensureUniqueRouteEndpointAdds(existing, req.EndpointsToAdd); err != nil {
			return nil, err
		}
	}

	now := time.Now().Unix()
	tx := db.GetDB().WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	updates := map[string]any{"updated_at": now}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Mode != nil {
		updates["mode"] = *req.Mode
	}
	if req.PreferredEndpointID != nil {
		updates["preferred_endpoint_id"] = *req.PreferredEndpointID
	}
	if req.FailoverEnabled != nil {
		updates["failover_enabled"] = *req.FailoverEnabled
	}
	if err := tx.Model(&model.RouteProfile{}).Where("id = ?", req.ID).Updates(updates).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to update router: %w", err)
	}

	if len(req.EndpointsToDelete) > 0 {
		if err := tx.Where("id IN ? AND router_id = ?", req.EndpointsToDelete, req.ID).Delete(&model.RouteEndpoint{}).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to delete endpoints: %w", err)
		}
	}

	for _, item := range req.EndpointsToUpdate {
		up := map[string]any{"updated_at": now}
		if item.Name != nil {
			up["name"] = *item.Name
		}
		if item.ChannelID != nil {
			up["channel_id"] = *item.ChannelID
		}
		if item.ChannelKeyID != nil {
			up["channel_key_id"] = *item.ChannelKeyID
		}
		if item.Priority != nil {
			up["priority"] = *item.Priority
		}
		if item.Weight != nil {
			up["weight"] = *item.Weight
		}
		if item.Enabled != nil {
			up["enabled"] = *item.Enabled
		}
		if item.Status != nil {
			up["status"] = *item.Status
		}
		if item.UsePricingOverride != nil {
			up["use_pricing_override"] = *item.UsePricingOverride
		}
		if item.PricingRuleOverride != nil {
			value, err := pricingRuleDBValue(*item.PricingRuleOverride)
			if err != nil {
				tx.Rollback()
				return nil, fmt.Errorf("failed to serialize endpoint pricing rule override: %w", err)
			}
			up["pricing_rule_override"] = value
		}
		if err := tx.Model(&model.RouteEndpoint{}).
			Where("id = ? AND router_id = ?", item.ID, req.ID).
			Updates(up).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to update endpoint: %w", err)
		}
	}

	if len(req.EndpointsToAdd) > 0 {
		newItems := make([]model.RouteEndpoint, 0, len(req.EndpointsToAdd))
		for _, item := range req.EndpointsToAdd {
			ep := model.RouteEndpoint{
				RouterID:            req.ID,
				Name:                item.Name,
				ChannelID:           item.ChannelID,
				ChannelKeyID:        item.ChannelKeyID,
				Priority:            item.Priority,
				Weight:              item.Weight,
				Enabled:             item.Enabled,
				UsePricingOverride:  item.UsePricingOverride,
				PricingRuleOverride: item.PricingRuleOverride,
			}
			normalizeEndpoint(&ep, now)
			newItems = append(newItems, ep)
		}
		if err := tx.Create(&newItems).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to create endpoints: %w", err)
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit router update: %w", err)
	}
	if oldRoute.Name != "" {
		routeCache.Del(oldRoute.ID)
	}
	return RouteProfileGetFresh(req.ID, ctx)
}

func RouteProfileGetFresh(id int, ctx context.Context) (*RouteProfileDetail, error) {
	if err := routeRefreshCacheByID(id, ctx); err != nil {
		return nil, err
	}
	return RouteProfileGet(id, ctx)
}

func RouteProfileSwitch(routerID, endpointID int, ctx context.Context) (*RouteProfileDetail, error) {
	route, ok := routeCache.Get(routerID)
	if !ok {
		return nil, fmt.Errorf("router not found")
	}
	found := false
	for _, ep := range route.Endpoints {
		if ep.ID == endpointID {
			found = true
			if !ep.Enabled {
				return nil, fmt.Errorf("endpoint is disabled")
			}
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("endpoint not found in router")
	}
	req := &model.RouteProfileUpdateRequest{ID: routerID, PreferredEndpointID: &endpointID}
	return RouteProfileUpdate(req, ctx)
}

func RouteProfileDelete(id int, ctx context.Context) error {
	if APIKeyCountByRouter(id, ctx) > 0 {
		return fmt.Errorf("router is bound by API keys")
	}
	tx := db.GetDB().WithContext(ctx).Begin()
	if err := tx.Where("router_id = ?", id).Delete(&model.RouteEndpoint{}).Error; err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Delete(&model.RouteProfile{}, id).Error; err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit().Error; err != nil {
		return err
	}
	routeCache.Del(id)
	return nil
}

func RouteOptions(ctx context.Context) ([]RouteOptionChannel, error) {
	channels, err := ChannelList(ctx)
	if err != nil {
		return nil, err
	}
	options := make([]RouteOptionChannel, 0, len(channels))
	for _, ch := range channels {
		models := strings.Split(ch.Model+","+ch.CustomModel, ",")
		cleanModels := make([]string, 0, len(models))
		for _, m := range models {
			if s := strings.TrimSpace(m); s != "" {
				cleanModels = append(cleanModels, s)
			}
		}
		keys := make([]RouteOptionChannelKey, 0, len(ch.Keys))
		for _, k := range ch.Keys {
			keys = append(keys, RouteOptionChannelKey{
				ID:          k.ID,
				Enabled:     k.Enabled,
				Remark:      k.Remark,
				MaskedKey:   maskKey(k.ChannelKey),
				PricingRule: k.PricingRule,
			})
		}
		options = append(options, RouteOptionChannel{
			ID:          ch.ID,
			Name:        ch.Name,
			Enabled:     ch.Enabled,
			Models:      cleanModels,
			Keys:        keys,
			PricingRule: ch.PricingRule,
		})
	}
	return options, nil
}

func RouteEndpointMarkStatus(endpointID int, status model.RouteEndpointStatus, lastErr string, ctx context.Context) error {
	now := time.Now().Unix()
	err := db.GetDB().WithContext(ctx).Model(&model.RouteEndpoint{}).
		Where("id = ?", endpointID).
		Updates(map[string]any{
			"status":          status,
			"last_error":      lastErr,
			"last_checked_at": now,
			"updated_at":      now,
		}).Error
	if err != nil {
		return err
	}
	return routeRefreshCacheByEndpointID(endpointID, ctx)
}

func RouteEndpointValidate(ep model.RouteEndpoint, ctx context.Context) (*model.Channel, model.ChannelKey, error) {
	channel, err := ChannelGet(ep.ChannelID, ctx)
	if err != nil {
		return nil, model.ChannelKey{}, fmt.Errorf("channel not found")
	}
	if !channel.Enabled {
		return nil, model.ChannelKey{}, fmt.Errorf("channel disabled")
	}
	for _, key := range channel.Keys {
		if key.ID == ep.ChannelKeyID {
			if !key.Enabled || key.ChannelKey == "" {
				return nil, model.ChannelKey{}, fmt.Errorf("channel key disabled")
			}
			return channel, key, nil
		}
	}
	return nil, model.ChannelKey{}, fmt.Errorf("channel key not found")
}

func RouteSelectCandidates(route model.RouteProfile) []model.RouteEndpoint {
	enabled := make([]model.RouteEndpoint, 0, len(route.Endpoints))
	for _, ep := range route.Endpoints {
		if !ep.Enabled || ep.Status == model.RouteEndpointStatusError {
			continue
		}
		enabled = append(enabled, ep)
	}
	if len(enabled) == 0 {
		for _, ep := range route.Endpoints {
			if ep.Enabled {
				enabled = append(enabled, ep)
			}
		}
	}
	if len(enabled) == 0 {
		return nil
	}

	if route.Mode == model.RouteModeWeighted {
		return weightedEndpointOrder(enabled)
	}

	sort.Slice(enabled, func(i, j int) bool {
		return enabled[i].Priority < enabled[j].Priority
	})
	if route.PreferredEndpointID > 0 {
		for i, ep := range enabled {
			if ep.ID == route.PreferredEndpointID {
				copy(enabled[1:i+1], enabled[0:i])
				enabled[0] = ep
				break
			}
		}
	}
	if !route.FailoverEnabled && len(enabled) > 1 {
		return enabled[:1]
	}
	return enabled
}

func RouteSelectModelListEndpoint(route model.RouteProfile) (model.RouteEndpoint, bool) {
	enabled := make([]model.RouteEndpoint, 0, len(route.Endpoints))
	for _, ep := range route.Endpoints {
		if !ep.Enabled || ep.Status == model.RouteEndpointStatusError {
			continue
		}
		enabled = append(enabled, ep)
	}
	if len(enabled) == 0 {
		for _, ep := range route.Endpoints {
			if ep.Enabled {
				enabled = append(enabled, ep)
			}
		}
	}
	if len(enabled) == 0 {
		return model.RouteEndpoint{}, false
	}
	sort.Slice(enabled, func(i, j int) bool {
		return enabled[i].Priority < enabled[j].Priority
	})
	if route.PreferredEndpointID > 0 {
		for _, ep := range enabled {
			if ep.ID == route.PreferredEndpointID {
				return ep, true
			}
		}
	}
	return enabled[0], true
}

func RouteRequestModel(requestModel string) string {
	return requestModel
}

func routeRefreshCache(ctx context.Context) error {
	routes := []model.RouteProfile{}
	if err := db.GetDB().WithContext(ctx).Preload("Endpoints").Find(&routes).Error; err != nil {
		return err
	}
	for _, route := range routes {
		sortRouteEndpoints(&route)
		routeCache.Set(route.ID, route)
	}
	return nil
}

func routeRefreshCacheByID(id int, ctx context.Context) error {
	var route model.RouteProfile
	if err := db.GetDB().WithContext(ctx).Preload("Endpoints").First(&route, id).Error; err != nil {
		return err
	}
	sortRouteEndpoints(&route)
	routeCache.Set(route.ID, route)
	return nil
}

func routeRefreshCacheByEndpointID(endpointID int, ctx context.Context) error {
	var ep model.RouteEndpoint
	if err := db.GetDB().WithContext(ctx).First(&ep, endpointID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}
	return routeRefreshCacheByID(ep.RouterID, ctx)
}

func sortRouteEndpoints(route *model.RouteProfile) {
	sort.Slice(route.Endpoints, func(i, j int) bool {
		return route.Endpoints[i].Priority < route.Endpoints[j].Priority
	})
}

func normalizeEndpoint(ep *model.RouteEndpoint, now int64) {
	if ep.Priority <= 0 {
		ep.Priority = 1
	}
	if ep.Weight <= 0 {
		ep.Weight = 1
	}
	if ep.Status == "" {
		ep.Status = model.RouteEndpointStatusUnknown
	}
	if ep.UsePricingOverride {
		ep.PricingRuleOverride = model.NormalizePricingRule(ep.PricingRuleOverride)
		ep.PricingRuleOverride.Enabled = true
	}
	ep.CreatedAt = now
	ep.UpdatedAt = now
}

type routeEndpointIdentity struct {
	ChannelID    int
	ChannelKeyID int
}

func ensureUniqueRouteEndpointAdds(existing []model.RouteEndpoint, additions []model.RouteEndpointAddRequest) error {
	seen := map[routeEndpointIdentity]bool{}
	for _, ep := range existing {
		seen[routeEndpointIdentity{ChannelID: ep.ChannelID, ChannelKeyID: ep.ChannelKeyID}] = true
	}
	for _, ep := range additions {
		key := routeEndpointIdentity{ChannelID: ep.ChannelID, ChannelKeyID: ep.ChannelKeyID}
		if seen[key] {
			return fmt.Errorf("endpoint already exists in router")
		}
		seen[key] = true
	}
	return nil
}

func ensureUniqueRouteEndpoints(endpoints []model.RouteEndpoint) error {
	seen := map[routeEndpointIdentity]bool{}
	for _, ep := range endpoints {
		key := routeEndpointIdentity{ChannelID: ep.ChannelID, ChannelKeyID: ep.ChannelKeyID}
		if seen[key] {
			return fmt.Errorf("endpoint already exists in router")
		}
		seen[key] = true
	}
	return nil
}

func weightedEndpointOrder(items []model.RouteEndpoint) []model.RouteEndpoint {
	result := make([]model.RouteEndpoint, len(items))
	copy(result, items)
	rand.Shuffle(len(result), func(i, j int) { result[i], result[j] = result[j], result[i] })
	sort.SliceStable(result, func(i, j int) bool {
		wi := result[i].Weight
		if wi <= 0 {
			wi = 1
		}
		wj := result[j].Weight
		if wj <= 0 {
			wj = 1
		}
		return rand.Intn(wi+wj) < wi
	})
	return result
}

func maskKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:3] + "***" + key[len(key)-4:]
}
