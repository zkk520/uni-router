package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/helper"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/price"
	"github.com/zkk520/uni-router/internal/server/middleware"
	"github.com/zkk520/uni-router/internal/server/resp"
	"github.com/zkk520/uni-router/internal/server/router"
)

func init() {
	router.NewGroupRouter("/api/v1/model").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(
			router.NewRoute("/list", http.MethodGet).
				Handle(listLLM),
		).
		AddRoute(
			router.NewRoute("/create", http.MethodPost).
				Handle(createLLM),
		).
		AddRoute(
			router.NewRoute("/channel", http.MethodGet).
				Handle(listLLMByChannel),
		).
		AddRoute(
			router.NewRoute("/update", http.MethodPost).
				Handle(updateLLM),
		).
		AddRoute(
			router.NewRoute("/delete", http.MethodPost).
				Handle(deleteLLM),
		).
		AddRoute(
			router.NewRoute("/update-price", http.MethodPost).
				Handle(updateLLMPrice),
		).
		AddRoute(
			router.NewRoute("/last-update-time", http.MethodGet).
				Handle(getLastUpdateTime),
		).
		AddRoute(
			router.NewRoute("/presets", http.MethodGet).
				Handle(listLLMPresets),
		)
	router.NewGroupRouter("/v1").
		Use(middleware.APIKeyAuth()).
		AddRoute(
			router.NewRoute("/models", http.MethodGet).
				Handle(getModelList),
		)
}

func getModelList(c *gin.Context) {
	apiKeyId := c.GetInt("api_key_id")
	apiKey, err := op.APIKeyGet(apiKeyId, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if apiKey.RouterID <= 0 {
		resp.Error(c, http.StatusBadRequest, "API key must be bound to a router")
		return
	}
	route, err := op.RouteProfileGet(apiKey.RouterID, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusServiceUnavailable, "router not available")
		return
	}
	models := collectRouteModelList(c.Request.Context(), route.RouteProfile)
	if len(models) == 0 {
		resp.Error(c, http.StatusServiceUnavailable, "no available model")
		return
	}

	if c.GetString("request_type") == "anthropic" {
		var anthropicModels []model.AnthropicModel
		for _, m := range models {
			anthropicModels = append(anthropicModels, model.AnthropicModel{
				ID:          m,
				CreatedAt:   "2024-01-01T00:00:00Z",
				DisplayName: m,
				Type:        "model",
			})
		}
		response := gin.H{
			"data":     anthropicModels,
			"has_more": false,
		}
		if len(anthropicModels) > 0 {
			response["first_id"] = anthropicModels[0].ID
			response["last_id"] = anthropicModels[len(anthropicModels)-1].ID
		}
		c.JSON(200, response)
	} else {
		var openAIModels []model.OpenAIModel
		for _, m := range models {
			openAIModels = append(openAIModels, model.OpenAIModel{
				ID:      m,
				Object:  "model",
				Created: 1763395200,
				OwnedBy: "uni-router",
			})
		}
		c.JSON(200, gin.H{
			"object": "list",
			"data":   openAIModels,
		})
	}
}

func collectRouteModelList(ctx context.Context, route model.RouteProfile) []string {
	candidates := make([]model.RouteEndpoint, 0, len(route.Endpoints))
	for _, ep := range route.Endpoints {
		if !ep.Enabled || ep.Status == model.RouteEndpointStatusError {
			continue
		}
		candidates = append(candidates, ep)
	}
	if len(candidates) == 0 {
		for _, ep := range route.Endpoints {
			if ep.Enabled {
				candidates = append(candidates, ep)
			}
		}
	}
	seen := map[string]struct{}{}
	models := make([]string, 0)
	for _, ep := range candidates {
		channel, usedKey, err := op.RouteEndpointValidate(ep, ctx)
		if err != nil {
			continue
		}
		keyModels := op.ChannelKeyModelNames(*channel, usedKey.ID)
		if len(keyModels) == 0 {
			fetchReq := *channel
			fetchReq.Keys = []model.ChannelKey{usedKey}
			fetchReq.Type = model.EffectiveChannelKeyType(*channel, usedKey)
			// 使用独立 context，避免客户端超时断开后 fetch 被取消且无法缓存结果
			fetchCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			fetched, err := helper.FetchModels(fetchCtx, fetchReq)
			cancel()
			if err == nil {
				keyModels = fetched
			}
		}
		for _, m := range keyModels {
			m = strings.TrimSpace(m)
			if m == "" {
				continue
			}
			if _, ok := seen[m]; ok {
				continue
			}
			seen[m] = struct{}{}
			models = append(models, m)
		}
	}
	return models
}

func listLLM(c *gin.Context) {
	models, err := op.LLMList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, models)
}

func listLLMPresets(c *gin.Context) {
	models, err := op.LLMList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	existing := make(map[string]struct{}, len(models))
	for _, model := range models {
		existing[strings.ToLower(model.Name)] = struct{}{}
	}
	presets := price.ListLLMPricePresets()
	filtered := make([]model.LLMInfo, 0, len(presets))
	for _, preset := range presets {
		if _, ok := existing[strings.ToLower(preset.Name)]; ok {
			continue
		}
		filtered = append(filtered, preset)
	}
	resp.Success(c, filtered)
}

func listLLMByChannel(c *gin.Context) {
	channels, err := op.ChannelLLMList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, channels)
}

func createLLM(c *gin.Context) {
	var model model.LLMInfo
	if err := c.ShouldBindJSON(&model); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.LLMCreate(model, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, model)
}

func updateLLM(c *gin.Context) {
	var model model.LLMInfo
	if err := c.ShouldBindJSON(&model); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.LLMUpdate(model, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, model)
}

func deleteLLM(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.LLMDelete(req.Name, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func updateLLMPrice(c *gin.Context) {
	err := price.UpdateLLMPrice(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func getLastUpdateTime(c *gin.Context) {
	time := price.GetLastUpdateTime()
	resp.Success(c, time)
}
