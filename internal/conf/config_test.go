package conf

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

func TestSaveServerPortAndDevFrontendPort(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "config.json")
	t.Cleanup(viper.Reset)

	AppConfig = Config{
		Server:   Server{Host: "0.0.0.0", Port: 8080},
		Database: Database{Type: "sqlite", Path: "data/data.db"},
		Log:      Log{Level: "info"},
	}
	viper.SetConfigFile(configFile)

	if err := SaveServerPort(18080); err != nil {
		t.Fatalf("保存后端端口失败: %v", err)
	}
	if err := SaveDevFrontendPort(13000); err != nil {
		t.Fatalf("保存开发前端端口失败: %v", err)
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		t.Fatalf("读取配置失败: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("解析配置失败: %v", err)
	}
	server := cfg["server"].(map[string]any)
	dev := cfg["dev"].(map[string]any)
	if int(server["port"].(float64)) != 18080 {
		t.Fatalf("后端端口未写入配置: %#v", server["port"])
	}
	if int(dev["frontend_port"].(float64)) != 13000 {
		t.Fatalf("开发前端端口未写入配置: %#v", dev["frontend_port"])
	}
}
