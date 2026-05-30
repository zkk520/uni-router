package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/server/middleware"
	"github.com/zkk520/uni-router/internal/server/resp"
	"github.com/zkk520/uni-router/internal/server/router"
	"gorm.io/gorm"
)

func init() {
	router.NewGroupRouter("/api/v1/log").
		Use(middleware.Auth()).
		AddRoute(
			router.NewRoute("/list", http.MethodGet).
				Handle(listLog),
		).
		AddRoute(
			router.NewRoute("/page", http.MethodGet).
				Handle(pageLog),
		).
		AddRoute(
			router.NewRoute("/clear", http.MethodDelete).
				Handle(clearLog),
		).
		AddRoute(
			router.NewRoute("/detail", http.MethodGet).
				Handle(detailLog),
		).
		AddRoute(
			router.NewRoute("/stream-token", http.MethodGet).
				Handle(getStreamToken),
		)

	router.NewGroupRouter("/api/v1/log").
		AddRoute(
			router.NewRoute("/stream", http.MethodGet).
				Handle(streamLog),
		)
}

func listLog(c *gin.Context) {
	pageParams := parsePageParams(c)
	filter, includeContent, err := parseLogQuery(c)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	if !includeContent {
		logs, err := op.RelayLogSummaryListWithFilter(c.Request.Context(), filter, pageParams.Page, pageParams.PageSize)
		if err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		resp.Success(c, logs)
		return
	}

	logs, err := op.RelayLogListWithFilter(c.Request.Context(), filter, pageParams.Page, pageParams.PageSize)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	resp.Success(c, logs)
}

func parseLogQuery(c *gin.Context) (op.RelayLogFilter, bool, error) {
	startTimeStr := c.Query("start_time")
	endTimeStr := c.Query("end_time")
	apiKeyName := c.Query("api_key_name")
	routerID, _ := strconv.Atoi(c.Query("router_id"))
	endpointID, _ := strconv.Atoi(c.Query("endpoint_id"))
	status := c.Query("status")
	includeContent, _ := strconv.ParseBool(c.DefaultQuery("include_content", "true"))

	var startTime, endTime *int
	if startTimeStr != "" && endTimeStr != "" {
		st, err := strconv.Atoi(startTimeStr)
		if err != nil {
			return op.RelayLogFilter{}, includeContent, err
		}
		et, err := strconv.Atoi(endTimeStr)
		if err != nil {
			return op.RelayLogFilter{}, includeContent, err
		}
		startTime = &st
		endTime = &et
	}

	return op.RelayLogFilter{
		StartTime:  startTime,
		EndTime:    endTime,
		APIKeyName: apiKeyName,
		RouterID:   routerID,
		EndpointID: endpointID,
		Status:     status,
	}, includeContent, nil
}

func pageLog(c *gin.Context) {
	pageParams := parsePageParams(c)
	filter, includeContent, err := parseLogQuery(c)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if !includeContent {
		logs, err := op.RelayLogSummaryListWithFilter(c.Request.Context(), filter, pageParams.Page, pageParams.PageSize)
		if err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if logs == nil {
			logs = []model.RelayLogSummary{}
		}
		total, err := op.RelayLogCountWithFilter(c.Request.Context(), filter)
		if err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		resp.Success(c, op.PageResult[model.RelayLogSummary]{
			Items:    logs,
			Total:    total,
			Page:     pageParams.Page,
			PageSize: pageParams.PageSize,
		})
		return
	}

	logs, err := op.RelayLogListWithFilter(c.Request.Context(), filter, pageParams.Page, pageParams.PageSize)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if logs == nil {
		logs = []model.RelayLog{}
	}
	total, err := op.RelayLogCountWithFilter(c.Request.Context(), filter)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, op.PageResult[model.RelayLog]{
		Items:    logs,
		Total:    total,
		Page:     pageParams.Page,
		PageSize: pageParams.PageSize,
	})
}

func detailLog(c *gin.Context) {
	id, err := strconv.ParseInt(c.Query("id"), 10, 64)
	if err != nil || id <= 0 {
		resp.Error(c, http.StatusBadRequest, "invalid log id")
		return
	}

	relayLog, err := op.RelayLogGet(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			resp.Error(c, http.StatusNotFound, "log not found")
			return
		}
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	resp.Success(c, relayLog)
}

func clearLog(c *gin.Context) {
	if err := op.RelayLogClear(c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func getStreamToken(c *gin.Context) {
	token, err := op.RelayLogStreamTokenCreate()
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, gin.H{"token": token})
}

func streamLog(c *gin.Context) {
	token := c.Query("token")
	if token == "" || !op.RelayLogStreamTokenVerify(token) {
		resp.Error(c, http.StatusUnauthorized, "invalid stream token")
		return
	}

	op.RelayLogStreamTokenRevoke(token)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	logChan := op.RelayLogSubscribe()
	defer op.RelayLogUnsubscribe(logChan)

	ctx := c.Request.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case log, ok := <-logChan:
			if !ok {
				return
			}
			data, err := json.Marshal(op.RelayLogToSummary(log))
			if err != nil {
				continue
			}
			c.Writer.Write([]byte(fmt.Sprintf("data: %s\n\n", data)))
			c.Writer.Flush()
		}
	}
}
