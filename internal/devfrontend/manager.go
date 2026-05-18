package devfrontend

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/zkk520/uni-router/internal/conf"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/utils/log"
	"github.com/zkk520/uni-router/internal/utils/portutil"
)

const ManageFrontendEnv = "UNI_ROUTER_MANAGE_FRONTEND"

var manager = &Manager{}

type Manager struct {
	mu      sync.Mutex
	process *exec.Cmd
	port    int
	apiURL  string
	webRoot string
}

func Enabled() bool {
	return conf.IsDebug() && os.Getenv(ManageFrontendEnv) == "true"
}

func Managed() bool {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.process != nil && manager.process.Process != nil
}

func StartFromSettings() error {
	if !Enabled() {
		return nil
	}

	port, err := op.SettingGetInt(model.SettingKeyDevFrontendPort)
	if err != nil {
		return err
	}
	return Restart(port, backendURL(conf.AppConfig.Server.Port))
}

func Restart(port int, apiURL string) error {
	if !Enabled() {
		return nil
	}
	if err := portutil.ValidatePort(port); err != nil {
		return err
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	if manager.process != nil && manager.port == port && manager.apiURL == apiURL {
		return nil
	}

	if err := manager.stopLocked(); err != nil {
		return err
	}

	webRoot, err := findWebRoot()
	if err != nil {
		return err
	}

	cmd := exec.Command("cmd.exe", "/d", "/s", "/c", fmt.Sprintf("pnpm exec next dev -p %d", port))
	if runtime.GOOS != "windows" {
		cmd = exec.Command("sh", "-c", fmt.Sprintf("pnpm exec next dev -p %d", port))
	}
	cmd.Dir = webRoot
	cmd.Stdout = logWriter{name: "web"}
	cmd.Stderr = logWriter{name: "web"}
	cmd.Env = append(os.Environ(), "NEXT_PUBLIC_API_BASE_URL="+apiURL)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动开发前端失败: %w", err)
	}

	manager.process = cmd
	manager.port = port
	manager.apiURL = apiURL
	manager.webRoot = webRoot

	go func() {
		err := cmd.Wait()
		manager.mu.Lock()
		defer manager.mu.Unlock()
		if manager.process == cmd {
			manager.process = nil
			if err != nil {
				log.Warnf("开发前端已退出: %v", err)
			}
		}
	}()

	log.Infof("开发前端已启动: http://127.0.0.1:%d", port)
	return nil
}

func Stop() error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.stopLocked()
}

func (m *Manager) stopLocked() error {
	if m.process == nil || m.process.Process == nil {
		m.process = nil
		return nil
	}

	process := m.process.Process
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/PID", fmt.Sprint(process.Pid), "/T", "/F").Run()
	} else {
		_ = process.Kill()
	}
	m.process = nil
	m.port = 0
	m.apiURL = ""
	m.webRoot = ""
	return nil
}

func findWebRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	candidates := []string{
		filepath.Join(wd, "web"),
		filepath.Join(filepath.Dir(wd), "web"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(candidate, "package.json")); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("未找到 web/package.json，无法启动开发前端")
}

func backendURL(port int) string {
	return fmt.Sprintf("http://127.0.0.1:%d", port)
}

type logWriter struct {
	name string
}

func (w logWriter) Write(p []byte) (int, error) {
	log.Infof("[%s] %s", w.name, string(p))
	return len(p), nil
}
