package model

import (
	"encoding/json"
	"time"

	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

type Channel struct {
	ID            int                   `json:"id" gorm:"primaryKey"`
	Name          string                `json:"name" gorm:"unique;not null"`
	Type          outbound.OutboundType `json:"type"`
	Enabled       bool                  `json:"enabled" gorm:"default:true"`
	BaseUrls      []BaseUrl             `json:"base_urls" gorm:"serializer:json"`
	Keys          []ChannelKey          `json:"keys" gorm:"foreignKey:ChannelID"`
	Model         string                `json:"model"`
	CustomModel   string                `json:"custom_model"`
	Proxy         bool                  `json:"proxy" gorm:"default:false"`
	AutoSync      bool                  `json:"auto_sync" gorm:"default:false"`
	CustomHeader  []CustomHeader        `json:"custom_header" gorm:"serializer:json"`
	ParamOverride *string               `json:"param_override"`
	ChannelProxy  *string               `json:"channel_proxy"`
	Stats         *StatsChannel         `json:"stats,omitempty" gorm:"foreignKey:ChannelID"`
	MatchRegex    *string               `json:"match_regex"`
	PricingRule   PricingRule           `json:"pricing_rule" gorm:"serializer:json"`
}

type BaseUrl struct {
	URL   string `json:"url"`
	Delay int    `json:"delay"`
}

type CustomHeader struct {
	HeaderKey   string `json:"header_key"`
	HeaderValue string `json:"header_value"`
}

type ChannelKey struct {
	ID               int                    `json:"id" gorm:"primaryKey"`
	ChannelID        int                    `json:"channel_id"`
	Enabled          bool                   `json:"enabled" gorm:"default:true"`
	ChannelKey       string                 `json:"channel_key"`
	StatusCode       int                    `json:"status_code"`
	LastUseTimeStamp int64                  `json:"last_use_time_stamp"`
	TotalCost        float64                `json:"total_cost"`
	Remark           string                 `json:"remark"`
	Type             *outbound.OutboundType `json:"type,omitempty"`
	PricingRule      PricingRule            `json:"pricing_rule" gorm:"serializer:json"`
	Models           []string               `json:"models" gorm:"serializer:json"`
	ModelsSyncedAt   int64                  `json:"models_synced_at"`
	ModelsSyncError  string                 `json:"models_sync_error" gorm:"type:text"`
	Stats            *StatsChannelKey       `json:"stats,omitempty" gorm:"foreignKey:ChannelKeyID"`
}

// ChannelUpdateRequest 渠道更新请求 - 仅包含变更的数据
type ChannelUpdateRequest struct {
	ID            int                    `json:"id" binding:"required"`
	Name          *string                `json:"name,omitempty"`
	Type          *outbound.OutboundType `json:"type,omitempty"`
	Enabled       *bool                  `json:"enabled,omitempty"`
	BaseUrls      *[]BaseUrl             `json:"base_urls,omitempty"`
	Model         *string                `json:"model,omitempty"`
	CustomModel   *string                `json:"custom_model,omitempty"`
	Proxy         *bool                  `json:"proxy,omitempty"`
	AutoSync      *bool                  `json:"auto_sync,omitempty"`
	CustomHeader  *[]CustomHeader        `json:"custom_header,omitempty"`
	ChannelProxy  *string                `json:"channel_proxy,omitempty"`
	ParamOverride *string                `json:"param_override,omitempty"`
	MatchRegex    *string                `json:"match_regex,omitempty"`
	PricingRule   *PricingRule           `json:"pricing_rule,omitempty"`

	KeysToAdd    []ChannelKeyAddRequest    `json:"keys_to_add,omitempty"`
	KeysToUpdate []ChannelKeyUpdateRequest `json:"keys_to_update,omitempty"`
	KeysToDelete []int                     `json:"keys_to_delete,omitempty"`
}

type ChannelKeyAddRequest struct {
	Enabled         bool                   `json:"enabled"`
	ChannelKey      string                 `json:"channel_key" binding:"required"`
	Remark          string                 `json:"remark"`
	Type            *outbound.OutboundType `json:"type,omitempty"`
	PricingRule     PricingRule            `json:"pricing_rule"`
	Models          []string               `json:"models,omitempty"`
	ModelsSyncedAt  int64                  `json:"models_synced_at,omitempty"`
	ModelsSyncError string                 `json:"models_sync_error,omitempty"`
}

type ChannelKeyUpdateRequest struct {
	ID              int                  `json:"id" binding:"required"`
	Enabled         *bool                `json:"enabled,omitempty"`
	ChannelKey      *string              `json:"channel_key,omitempty"`
	Remark          *string              `json:"remark,omitempty"`
	Type            OptionalOutboundType `json:"type,omitempty"`
	PricingRule     *PricingRule         `json:"pricing_rule,omitempty"`
	Models          *[]string            `json:"models,omitempty"`
	ModelsSyncedAt  *int64               `json:"models_synced_at,omitempty"`
	ModelsSyncError *string              `json:"models_sync_error,omitempty"`
}

// ChannelFetchModelRequest is used by /channel/fetch-model (not persisted).
type ChannelFetchModelRequest struct {
	Type    outbound.OutboundType `json:"type" binding:"required"`
	BaseURL string                `json:"base_url" binding:"required"`
	Key     string                `json:"key" binding:"required"`
	Proxy   bool                  `json:"proxy"`
}

type ChannelFetchModelsResult struct {
	KeyID          int      `json:"key_id,omitempty"`
	KeyIndex       int      `json:"key_index"`
	Remark         string   `json:"remark"`
	MaskedKey      string   `json:"masked_key"`
	Success        bool     `json:"success"`
	Models         []string `json:"models"`
	Error          string   `json:"error,omitempty"`
	ModelsSyncedAt int64    `json:"models_synced_at,omitempty"`
}

type ChannelFetchModelsResponse struct {
	Results []ChannelFetchModelsResult `json:"results"`
	Models  []string                   `json:"models"`
}

type OptionalOutboundType struct {
	Set   bool
	Value *outbound.OutboundType
}

func (o *OptionalOutboundType) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value outbound.OutboundType
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

func EffectiveChannelKeyType(channel Channel, key ChannelKey) outbound.OutboundType {
	if key.Type != nil {
		return *key.Type
	}
	return channel.Type
}

func (c *Channel) GetBaseUrl() string {
	if c == nil || len(c.BaseUrls) == 0 {
		return ""
	}

	bestURL := ""
	bestDelay := 0
	bestSet := false

	for _, bu := range c.BaseUrls {
		if bu.URL == "" {
			continue
		}
		if !bestSet || bu.Delay < bestDelay {
			bestURL = bu.URL
			bestDelay = bu.Delay
			bestSet = true
		}
	}

	return bestURL
}

func (c *Channel) GetChannelKey() ChannelKey {
	if c == nil || len(c.Keys) == 0 {
		return ChannelKey{}
	}

	nowSec := time.Now().Unix()

	best := ChannelKey{}
	bestCost := 0.0
	bestSet := false

	for _, k := range c.Keys {
		if !k.Enabled || k.ChannelKey == "" {
			continue
		}
		if k.StatusCode == 429 && k.LastUseTimeStamp > 0 {
			if nowSec-k.LastUseTimeStamp < int64(5*time.Minute/time.Second) {
				continue
			}
		}
		if !bestSet || k.TotalCost < bestCost {
			best = k
			bestCost = k.TotalCost
			bestSet = true
		}
	}

	if !bestSet {
		return ChannelKey{}
	}
	return best
}
