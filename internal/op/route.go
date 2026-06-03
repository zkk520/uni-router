package op

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
	"github.com/zkk520/uni-router/internal/utils/cache"
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
	ID              int                    `json:"id"`
	Enabled         bool                   `json:"enabled"`
	Remark          string                 `json:"remark"`
	MaskedKey       string                 `json:"masked_key"`
	Type            *outbound.OutboundType `json:"type,omitempty"`
	EffectiveType   outbound.OutboundType  `json:"effective_type"`
	Models          []string               `json:"models"`
	ModelsSyncedAt  int64                  `json:"models_synced_at"`
	ModelsSyncError string                 `json:"models_sync_error"`
	PricingRule     model.PricingRule      `json:"pricing_rule"`
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
	sort.SliceStable(routes, func(i, j int) bool {
		if routes[i].SortOrder != routes[j].SortOrder {
			return routes[i].SortOrder < routes[j].SortOrder
		}
		return routes[i].ID < routes[j].ID
	})
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
	return routeProfileCreate(route, ctx, true)
}

func RouteProfileCreateFromRequest(req *model.RouteProfileCreateRequest, ctx context.Context) (*RouteProfileDetail, error) {
	failoverEnabled := true
	if req.FailoverEnabled != nil {
		failoverEnabled = *req.FailoverEnabled
	}
	route := &model.RouteProfile{
		Name:                req.Name,
		Mode:                req.Mode,
		PreferredEndpointID: req.PreferredEndpointID,
		FailoverEnabled:     failoverEnabled,
		Endpoints:           make([]model.RouteEndpoint, 0, len(req.Endpoints)),
	}
	for _, item := range req.Endpoints {
		route.Endpoints = append(route.Endpoints, model.RouteEndpoint{
			Name:                item.Name,
			ChannelID:           item.ChannelID,
			ChannelKeyID:        item.ChannelKeyID,
			Priority:            item.Priority,
			Weight:              item.Weight,
			Enabled:             item.Enabled,
			UsePricingOverride:  item.UsePricingOverride,
			PricingRuleOverride: item.PricingRuleOverride,
		})
	}
	if err := routeProfileCreate(route, ctx, req.FailoverEnabled == nil); err != nil {
		return nil, err
	}
	return RouteProfileGet(route.ID, ctx)
}

func routeProfileCreate(route *model.RouteProfile, ctx context.Context, defaultFailover bool) error {
	now := time.Now().Unix()
	route.CreatedAt = now
	route.UpdatedAt = now
	if route.Mode == "" {
		route.Mode = model.RouteModeManual
	}
	if defaultFailover && !route.FailoverEnabled {
		route.FailoverEnabled = true
	}
	if route.SortOrder <= 0 {
		nextSortOrder, err := nextRouteSortOrder(ctx)
		if err != nil {
			return err
		}
		route.SortOrder = nextSortOrder
	}
	if err := ensureUniqueRouteEndpoints(route.Endpoints); err != nil {
		return err
	}
	for i := range route.Endpoints {
		normalizeEndpoint(&route.Endpoints[i], now)
	}
	preserveDisabledFailover := !defaultFailover && !route.FailoverEnabled
	if err := db.GetDB().WithContext(ctx).Create(route).Error; err != nil {
		return fmt.Errorf("failed to create router: %w", err)
	}
	if preserveDisabledFailover {
		if err := db.GetDB().WithContext(ctx).Model(&model.RouteProfile{}).
			Where("id = ?", route.ID).
			Update("failover_enabled", false).Error; err != nil {
			return fmt.Errorf("failed to preserve router failover setting: %w", err)
		}
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

func RouteProfileReorder(ids []int, ctx context.Context) ([]RouteProfileDetail, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("router ids are required")
	}

	seen := make(map[int]bool, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, fmt.Errorf("invalid router id: %d", id)
		}
		if seen[id] {
			return nil, fmt.Errorf("duplicated router id: %d", id)
		}
		seen[id] = true
	}

	existingIDs := make([]int, 0)
	if err := db.GetDB().WithContext(ctx).Model(&model.RouteProfile{}).Pluck("id", &existingIDs).Error; err != nil {
		return nil, fmt.Errorf("failed to list routers: %w", err)
	}
	if len(ids) != len(existingIDs) {
		return nil, fmt.Errorf("router reorder ids must include all routers")
	}
	for _, id := range existingIDs {
		if !seen[id] {
			return nil, fmt.Errorf("router not found in reorder ids: %d", id)
		}
	}

	now := time.Now().Unix()
	tx := db.GetDB().WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()
	for index, id := range ids {
		if err := tx.Model(&model.RouteProfile{}).
			Where("id = ?", id).
			Updates(map[string]any{"sort_order": (index + 1) * 10, "updated_at": now}).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to update router sort order: %w", err)
		}
	}
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit router reorder: %w", err)
	}
	if err := routeRefreshCache(ctx); err != nil {
		return nil, err
	}
	return RouteProfileList(ctx)
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
				ID:              k.ID,
				Enabled:         k.Enabled,
				Remark:          k.Remark,
				MaskedKey:       maskKey(k.ChannelKey),
				Type:            k.Type,
				EffectiveType:   model.EffectiveChannelKeyType(ch, k),
				Models:          append([]string(nil), k.Models...),
				ModelsSyncedAt:  k.ModelsSyncedAt,
				ModelsSyncError: k.ModelsSyncError,
				PricingRule:     k.PricingRule,
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

func RouteCandidateValidate(ep model.RouteEndpoint, ctx context.Context) (*model.Channel, model.ChannelKey, error) {
	if !ep.Enabled {
		return nil, model.ChannelKey{}, fmt.Errorf("endpoint disabled")
	}
	return RouteEndpointValidate(ep, ctx)
}

func RouteSelectCandidates(route model.RouteProfile) []model.RouteEndpoint {
	enabled := routeSelectableEndpoints(route.Endpoints)
	if len(enabled) == 0 {
		return nil
	}

	if route.Mode == model.RouteModeWeighted {
		ordered := weightedEndpointOrder(enabled)
		if !route.FailoverEnabled && len(ordered) > 1 {
			return ordered[:1]
		}
		return ordered
	}

	orderManualRouteEndpoints(enabled, route.PreferredEndpointID)
	if !route.FailoverEnabled && len(enabled) > 1 {
		return enabled[:1]
	}
	return enabled
}

func RouteSelectModelListEndpoint(route model.RouteProfile) (model.RouteEndpoint, bool) {
	candidates := RouteSelectModelListCandidates(route)
	if len(candidates) == 0 {
		return model.RouteEndpoint{}, false
	}
	if route.PreferredEndpointID > 0 {
		for _, ep := range candidates {
			if ep.ID == route.PreferredEndpointID {
				return ep, true
			}
		}
	}
	return candidates[0], true
}

func RouteSelectModelListCandidates(route model.RouteProfile) []model.RouteEndpoint {
	candidates := routeSelectableEndpoints(route.Endpoints)
	if len(candidates) == 0 {
		return nil
	}
	orderManualRouteEndpoints(candidates, route.PreferredEndpointID)
	return candidates
}

func RouteRequestModel(requestModel string) string {
	return requestModel
}

func routeRefreshCache(ctx context.Context) error {
	routes := []model.RouteProfile{}
	if err := db.GetDB().WithContext(ctx).Preload("Endpoints").Order("sort_order ASC, id ASC").Find(&routes).Error; err != nil {
		return err
	}
	routeCache.Clear()
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

func nextRouteSortOrder(ctx context.Context) (int, error) {
	var maxSortOrder int
	if err := db.GetDB().WithContext(ctx).Model(&model.RouteProfile{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxSortOrder).Error; err != nil {
		return 0, fmt.Errorf("failed to calculate router sort order: %w", err)
	}
	return maxSortOrder + 10, nil
}

func sortRouteEndpoints(route *model.RouteProfile) {
	sort.Slice(route.Endpoints, func(i, j int) bool {
		if route.Endpoints[i].Enabled != route.Endpoints[j].Enabled {
			return route.Endpoints[i].Enabled
		}
		if route.Mode == model.RouteModeManual && route.PreferredEndpointID > 0 {
			if route.Endpoints[i].ID == route.PreferredEndpointID {
				return true
			}
			if route.Endpoints[j].ID == route.PreferredEndpointID {
				return false
			}
		}
		return route.Endpoints[i].Priority < route.Endpoints[j].Priority
	})
}

func routeSelectableEndpoints(endpoints []model.RouteEndpoint) []model.RouteEndpoint {
	enabled := make([]model.RouteEndpoint, 0, len(endpoints))
	for _, ep := range endpoints {
		if !ep.Enabled || ep.Status == model.RouteEndpointStatusError {
			continue
		}
		enabled = append(enabled, ep)
	}
	if len(enabled) > 0 {
		return enabled
	}
	for _, ep := range endpoints {
		if ep.Enabled {
			enabled = append(enabled, ep)
		}
	}
	return enabled
}

func orderManualRouteEndpoints(endpoints []model.RouteEndpoint, preferredEndpointID int) {
	sort.Slice(endpoints, func(i, j int) bool {
		return endpoints[i].Priority < endpoints[j].Priority
	})
	if preferredEndpointID <= 0 {
		return
	}
	for i, ep := range endpoints {
		if ep.ID == preferredEndpointID {
			copy(endpoints[1:i+1], endpoints[0:i])
			endpoints[0] = ep
			break
		}
	}
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
