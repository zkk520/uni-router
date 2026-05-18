package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/conf"
	"github.com/zkk520/uni-router/internal/devfrontend"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	appruntime "github.com/zkk520/uni-router/internal/runtime"
	"github.com/zkk520/uni-router/internal/server/middleware"
	"github.com/zkk520/uni-router/internal/server/resp"
	"github.com/zkk520/uni-router/internal/server/router"
	"github.com/zkk520/uni-router/internal/utils/log"
	"github.com/zkk520/uni-router/internal/utils/portutil"
)

type portsInfo struct {
	BackendPort              int    `json:"backend_port"`
	FrontendPort             int    `json:"frontend_port"`
	Debug                    bool   `json:"debug"`
	FrontendManaged          bool   `json:"frontend_managed"`
	BackendURL               string `json:"backend_url"`
	FrontendURL              string `json:"frontend_url"`
	FrontendPortConfigurable bool   `json:"frontend_port_configurable"`
}

type setPortsRequest struct {
	BackendPort  int  `json:"backend_port"`
	FrontendPort int  `json:"frontend_port"`
	Restart      bool `json:"restart"`
}

type setPortsResponse struct {
	portsInfo
	BackendRestarting  bool `json:"backend_restarting"`
	FrontendRestarting bool `json:"frontend_restarting"`
}

type portConflictResponse struct {
	Field           string `json:"field"`
	Port            int    `json:"port"`
	RecommendedPort int    `json:"recommended_port"`
}

func init() {
	router.NewGroupRouter("/api/v1/setting").
		Use(middleware.Auth()).
		AddRoute(
			router.NewRoute("/ports", http.MethodGet).
				Handle(getPorts),
		).
		AddRoute(
			router.NewRoute("/ports", http.MethodPost).
				Use(middleware.RequireJSON()).
				Handle(setPorts),
		)
}

func getPorts(c *gin.Context) {
	info, err := buildPortsInfo()
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, info)
}

func setPorts(c *gin.Context) {
	var req setPortsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePortsRequest(req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	currentBackendPort := conf.AppConfig.Server.Port
	currentFrontendPort, err := getDevFrontendPort()
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	if req.BackendPort != currentBackendPort && !portutil.IsAvailable(req.BackendPort) {
		respondPortConflict(c, "backend_port", req.BackendPort)
		return
	}
	if conf.IsDebug() && req.FrontendPort != currentFrontendPort && !portutil.IsAvailable(req.FrontendPort) {
		respondPortConflict(c, "frontend_port", req.FrontendPort)
		return
	}

	backendChanged := req.BackendPort != currentBackendPort
	frontendChanged := conf.IsDebug() && req.FrontendPort != currentFrontendPort

	if backendChanged {
		if err := conf.SaveServerPort(req.BackendPort); err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if frontendChanged {
		if err := op.SettingSetInt(model.SettingKeyDevFrontendPort, req.FrontendPort); err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if err := conf.SaveDevFrontendPort(req.FrontendPort); err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	info, err := buildPortsInfoWith(req.BackendPort, req.FrontendPort)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	result := setPortsResponse{
		portsInfo:          info,
		BackendRestarting:  req.Restart && backendChanged,
		FrontendRestarting: req.Restart && frontendChanged && !backendChanged && devfrontend.Enabled(),
	}
	resp.Success(c, result)

	if !req.Restart {
		return
	}

	if backendChanged {
		appruntime.RestartAfter(800*time.Millisecond, map[string]string{
			"UNI_ROUTER_SERVER_PORT": strconv.Itoa(req.BackendPort),
		})
		return
	}
	if frontendChanged && devfrontend.Enabled() {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := devfrontend.Restart(req.FrontendPort, info.BackendURL); err != nil {
				log.Errorf("restart dev frontend failed: %v", err)
			}
		}()
	}
}

func validatePortsRequest(req setPortsRequest) error {
	if err := portutil.ValidatePort(req.BackendPort); err != nil {
		return fmt.Errorf("后端%s", err.Error())
	}
	if req.FrontendPort != 0 {
		if err := portutil.ValidatePort(req.FrontendPort); err != nil {
			return fmt.Errorf("前端%s", err.Error())
		}
	}
	return nil
}

func respondPortConflict(c *gin.Context, field string, port int) {
	recommended, err := portutil.NextAvailable(port)
	if err != nil {
		resp.Error(c, http.StatusConflict, err.Error())
		return
	}
	c.AbortWithStatusJSON(http.StatusConflict, resp.ResponseStruct{
		Code:    http.StatusConflict,
		Message: "端口已被占用",
		Data: portConflictResponse{
			Field:           field,
			Port:            port,
			RecommendedPort: recommended,
		},
	})
}

func buildPortsInfo() (portsInfo, error) {
	frontendPort, err := getDevFrontendPort()
	if err != nil {
		return portsInfo{}, err
	}
	return buildPortsInfoWith(conf.AppConfig.Server.Port, frontendPort)
}

func buildPortsInfoWith(backendPort int, frontendPort int) (portsInfo, error) {
	debug := conf.IsDebug()
	return portsInfo{
		BackendPort:              backendPort,
		FrontendPort:             frontendPort,
		Debug:                    debug,
		FrontendManaged:          devfrontend.Managed(),
		BackendURL:               fmt.Sprintf("http://127.0.0.1:%d", backendPort),
		FrontendURL:              fmt.Sprintf("http://127.0.0.1:%d", frontendPort),
		FrontendPortConfigurable: debug,
	}, nil
}

func getDevFrontendPort() (int, error) {
	port, err := op.SettingGetInt(model.SettingKeyDevFrontendPort)
	if err != nil {
		return 3000, nil
	}
	return port, nil
}
