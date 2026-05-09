package handlers

import (
	"net/http"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	priceimport "github.com/bestruirui/octopus/internal/price"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/price").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(
			router.NewRoute("/import/parse", http.MethodPost).
				Handle(parsePriceImport),
		).
		AddRoute(
			router.NewRoute("/import/apply", http.MethodPost).
				Handle(applyPriceImport),
		).
		AddRoute(
			router.NewRoute("/rules", http.MethodGet).
				Handle(listPriceRules),
		).
		AddRoute(
			router.NewRoute("/rules/update", http.MethodPost).
				Handle(updatePriceRule),
		).
		AddRoute(
			router.NewRoute("/rules/delete", http.MethodPost).
				Handle(deletePriceRule),
		)
}

type priceImportApplyRequest struct {
	ScopeType model.PriceRuleScope          `json:"scope_type" binding:"required"`
	ScopeID   int                           `json:"scope_id"`
	Rules     []priceimport.PriceImportRule `json:"rules" binding:"required"`
}

func parsePriceImport(c *gin.Context) {
	var req priceimport.PriceImportParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := priceimport.ParsePriceImport(req)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, result)
}

func applyPriceImport(c *gin.Context) {
	var req priceImportApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.ScopeType != model.PriceRuleScopeGlobal && req.ScopeID == 0 && req.ScopeType != model.PriceRuleScopeProviderGroup {
		resp.Error(c, http.StatusBadRequest, "scope_id is required for selected scope")
		return
	}
	rules := make([]model.PriceRule, 0, len(req.Rules))
	for _, rule := range req.Rules {
		rules = append(rules, priceimport.PriceImportRuleToModel(rule, req.ScopeType, req.ScopeID))
	}
	saved, err := op.PriceRuleBatchUpsert(rules, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, saved)
}

func listPriceRules(c *gin.Context) {
	rules, err := op.PriceRuleList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, rules)
}

func updatePriceRule(c *gin.Context) {
	var rule model.PriceRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := op.PriceRuleUpsert(rule, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, saved)
}

func deletePriceRule(c *gin.Context) {
	var req struct {
		ID int `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.PriceRuleDelete(req.ID, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}
