package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/server/middleware"
	"github.com/zkk520/uni-router/internal/server/resp"
	"github.com/zkk520/uni-router/internal/server/router"
)

func init() {
	router.NewGroupRouter("/api/v1/usage").
		Use(middleware.Auth()).
		AddRoute(
			router.NewRoute("/summary", http.MethodGet).
				Handle(getUsageSummary),
		).
		AddRoute(
			router.NewRoute("/trend", http.MethodGet).
				Handle(getUsageTrend),
		).
		AddRoute(
			router.NewRoute("/rank", http.MethodGet).
				Handle(getUsageRank),
		)
}

func getUsageSummary(c *gin.Context) {
	summary, err := op.UsageSummaryGet(c.Request.Context(), c.DefaultQuery("period", "today"))
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, summary)
}

func getUsageTrend(c *gin.Context) {
	items, err := op.UsageTrendList(
		c.Request.Context(),
		c.DefaultQuery("period", "today"),
		c.Query("granularity"),
	)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, items)
}

func getUsageRank(c *gin.Context) {
	items, err := op.UsageRankList(
		c.Request.Context(),
		c.DefaultQuery("period", "today"),
		c.Query("dimension"),
		c.Query("sort"),
	)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, items)
}

