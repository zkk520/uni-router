package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/server/middleware"
	"github.com/zkk520/uni-router/internal/server/resp"
	"github.com/zkk520/uni-router/internal/server/router"
)

func init() {
	router.NewGroupRouter("/api/v1/router").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(router.NewRoute("/list", http.MethodGet).Handle(listRouter)).
		AddRoute(router.NewRoute("/page", http.MethodGet).Handle(pageRouter)).
		AddRoute(router.NewRoute("/options", http.MethodGet).Handle(routerOptions)).
		AddRoute(router.NewRoute("/create", http.MethodPost).Handle(createRouter)).
		AddRoute(router.NewRoute("/update", http.MethodPost).Handle(updateRouter)).
		AddRoute(router.NewRoute("/delete/:id", http.MethodDelete).Handle(deleteRouter)).
		AddRoute(router.NewRoute("/switch", http.MethodPost).Handle(switchRouter)).
		AddRoute(router.NewRoute("/test-endpoint", http.MethodPost).Handle(testRouterEndpoint)).
		AddRoute(router.NewRoute("/:id", http.MethodGet).Handle(getRouter))
}

func listRouter(c *gin.Context) {
	routes, err := op.RouteProfileList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, routes)
}

func pageRouter(c *gin.Context) {
	result, err := op.RouteProfilePage(c.Request.Context(), op.RoutePageFilter{
		PageParams: parsePageParams(c),
		Mode:       c.Query("mode"),
	})
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, result)
}

func getRouter(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidParam)
		return
	}
	route, err := op.RouteProfileGet(id, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	resp.Success(c, route)
}

func createRouter(c *gin.Context) {
	var route model.RouteProfile
	if err := c.ShouldBindJSON(&route); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	if err := op.RouteProfileCreate(&route, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	detail, _ := op.RouteProfileGet(route.ID, c.Request.Context())
	resp.Success(c, detail)
}

func updateRouter(c *gin.Context) {
	var req model.RouteProfileUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	route, err := op.RouteProfileUpdate(&req, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, route)
}

func deleteRouter(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidParam)
		return
	}
	if err := op.RouteProfileDelete(id, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, nil)
}

func switchRouter(c *gin.Context) {
	var req struct {
		RouterID   int `json:"router_id" binding:"required"`
		EndpointID int `json:"endpoint_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	route, err := op.RouteProfileSwitch(req.RouterID, req.EndpointID, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, route)
}

func testRouterEndpoint(c *gin.Context) {
	var req struct {
		EndpointID int `json:"endpoint_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	start := time.Now()
	var target *model.RouteEndpoint
	routes, _ := op.RouteProfileList(c.Request.Context())
	for _, route := range routes {
		for _, ep := range route.Endpoints {
			if ep.ID == req.EndpointID {
				copy := ep
				target = &copy
				break
			}
		}
	}
	if target == nil {
		resp.Error(c, http.StatusNotFound, "endpoint not found")
		return
	}
	_, _, err := op.RouteEndpointValidate(*target, c.Request.Context())
	if err != nil {
		_ = op.RouteEndpointMarkStatus(req.EndpointID, model.RouteEndpointStatusError, err.Error(), c.Request.Context())
		resp.Success(c, gin.H{"success": false, "latency_ms": time.Since(start).Milliseconds(), "error": err.Error()})
		return
	}
	_ = op.RouteEndpointMarkStatus(req.EndpointID, model.RouteEndpointStatusNormal, "", c.Request.Context())
	resp.Success(c, gin.H{"success": true, "latency_ms": time.Since(start).Milliseconds(), "error": ""})
}

func routerOptions(c *gin.Context) {
	options, err := op.RouteOptions(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, options)
}
