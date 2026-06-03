package model

type RouteMode string

const (
	RouteModeManual   RouteMode = "manual"
	RouteModeWeighted RouteMode = "weighted"
)

type RouteEndpointStatus string

const (
	RouteEndpointStatusUnknown RouteEndpointStatus = "unknown"
	RouteEndpointStatusNormal  RouteEndpointStatus = "normal"
	RouteEndpointStatusError   RouteEndpointStatus = "error"
)

type RouteProfile struct {
	ID                  int             `json:"id" gorm:"primaryKey"`
	Name                string          `json:"name" gorm:"unique;not null"`
	Mode                RouteMode       `json:"mode" gorm:"not null;default:manual"`
	PreferredEndpointID int             `json:"preferred_endpoint_id"`
	FailoverEnabled     bool            `json:"failover_enabled" gorm:"default:true"`
	SortOrder           int             `json:"sort_order" gorm:"not null;default:0;index"`
	Endpoints           []RouteEndpoint `json:"endpoints,omitempty" gorm:"foreignKey:RouterID"`
	CreatedAt           int64           `json:"created_at"`
	UpdatedAt           int64           `json:"updated_at"`
}

type RouteProfileCreateRequest struct {
	Name                string                    `json:"name" binding:"required"`
	Mode                RouteMode                 `json:"mode"`
	PreferredEndpointID int                       `json:"preferred_endpoint_id"`
	FailoverEnabled     *bool                     `json:"failover_enabled,omitempty"`
	Endpoints           []RouteEndpointAddRequest `json:"endpoints,omitempty"`
}

type RouteEndpoint struct {
	ID                  int                 `json:"id" gorm:"primaryKey"`
	RouterID            int                 `json:"router_id" gorm:"not null;index"`
	Name                string              `json:"name" gorm:"not null"`
	ChannelID           int                 `json:"channel_id" gorm:"not null;index"`
	ChannelKeyID        int                 `json:"channel_key_id" gorm:"not null;index"`
	Priority            int                 `json:"priority"`
	Weight              int                 `json:"weight"`
	Enabled             bool                `json:"enabled" gorm:"default:true"`
	Status              RouteEndpointStatus `json:"status" gorm:"not null;default:unknown"`
	LastCheckedAt       int64               `json:"last_checked_at"`
	LastError           string              `json:"last_error" gorm:"type:text"`
	UsePricingOverride  bool                `json:"use_pricing_override" gorm:"default:false"`
	PricingRuleOverride PricingRule         `json:"pricing_rule_override" gorm:"serializer:json"`
	CreatedAt           int64               `json:"created_at"`
	UpdatedAt           int64               `json:"updated_at"`
}

type RouteProfileUpdateRequest struct {
	ID                  int                          `json:"id" binding:"required"`
	Name                *string                      `json:"name,omitempty"`
	Mode                *RouteMode                   `json:"mode,omitempty"`
	PreferredEndpointID *int                         `json:"preferred_endpoint_id,omitempty"`
	FailoverEnabled     *bool                        `json:"failover_enabled,omitempty"`
	EndpointsToAdd      []RouteEndpointAddRequest    `json:"endpoints_to_add,omitempty"`
	EndpointsToUpdate   []RouteEndpointUpdateRequest `json:"endpoints_to_update,omitempty"`
	EndpointsToDelete   []int                        `json:"endpoints_to_delete,omitempty"`
}

type RouteProfileReorderRequest struct {
	IDs []int `json:"ids" binding:"required"`
}

type RouteEndpointAddRequest struct {
	Name                string      `json:"name" binding:"required"`
	ChannelID           int         `json:"channel_id" binding:"required"`
	ChannelKeyID        int         `json:"channel_key_id" binding:"required"`
	Priority            int         `json:"priority"`
	Weight              int         `json:"weight"`
	Enabled             bool        `json:"enabled"`
	UsePricingOverride  bool        `json:"use_pricing_override"`
	PricingRuleOverride PricingRule `json:"pricing_rule_override"`
}

type RouteEndpointUpdateRequest struct {
	ID                  int                  `json:"id" binding:"required"`
	Name                *string              `json:"name,omitempty"`
	ChannelID           *int                 `json:"channel_id,omitempty"`
	ChannelKeyID        *int                 `json:"channel_key_id,omitempty"`
	Priority            *int                 `json:"priority,omitempty"`
	Weight              *int                 `json:"weight,omitempty"`
	Enabled             *bool                `json:"enabled,omitempty"`
	Status              *RouteEndpointStatus `json:"status,omitempty"`
	UsePricingOverride  *bool                `json:"use_pricing_override,omitempty"`
	PricingRuleOverride *PricingRule         `json:"pricing_rule_override,omitempty"`
}
