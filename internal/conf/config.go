package conf

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
	"github.com/zkk520/uni-router/internal/utils/log"
)

type Server struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}

func SaveServerPort(port int) error {
	settings, _, err := readConfigSettings()
	if err != nil {
		return err
	}

	server, ok := settings["server"].(map[string]any)
	if !ok {
		server = map[string]any{}
		settings["server"] = server
	}
	server["port"] = port

	if _, ok := server["host"]; !ok {
		server["host"] = AppConfig.Server.Host
	}
	if _, ok := settings["database"]; !ok {
		settings["database"] = map[string]any{
			"type": AppConfig.Database.Type,
			"path": AppConfig.Database.Path,
		}
	}
	if _, ok := settings["log"]; !ok {
		settings["log"] = map[string]any{
			"level": AppConfig.Log.Level,
		}
	}

	if err := writeConfigSettings(settings); err != nil {
		return err
	}

	viper.Set("server.port", port)
	AppConfig.Server.Port = port
	return nil
}

func SaveDevFrontendPort(port int) error {
	settings, _, err := readConfigSettings()
	if err != nil {
		return err
	}

	dev, ok := settings["dev"].(map[string]any)
	if !ok {
		dev = map[string]any{}
		settings["dev"] = dev
	}
	dev["frontend_port"] = port

	return writeConfigSettings(settings)
}

func readConfigSettings() (map[string]any, string, error) {
	configFile := viper.ConfigFileUsed()
	if configFile == "" {
		configFile = filepath.Join("data", "config.json")
	}

	settings := map[string]any{}
	if data, err := os.ReadFile(configFile); err == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &settings); err != nil {
			return nil, "", fmt.Errorf("failed to parse config file: %w", err)
		}
	}
	return settings, configFile, nil
}

func writeConfigSettings(settings map[string]any) error {
	configFile := viper.ConfigFileUsed()
	if configFile == "" {
		configFile = filepath.Join("data", "config.json")
	}

	if _, ok := settings["server"]; !ok {
		settings["server"] = map[string]any{
			"host": AppConfig.Server.Host,
			"port": AppConfig.Server.Port,
		}
	}
	if _, ok := settings["database"]; !ok {
		settings["database"] = map[string]any{
			"type": AppConfig.Database.Type,
			"path": AppConfig.Database.Path,
		}
	}
	if _, ok := settings["log"]; !ok {
		settings["log"] = map[string]any{
			"level": AppConfig.Log.Level,
		}
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode config file: %w", err)
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(configFile), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}
	if err := os.WriteFile(configFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}
	return nil
}

type Log struct {
	Level string `mapstructure:"level"`
}

type Database struct {
	Type string `mapstructure:"type"`
	Path string `mapstructure:"path"`
}

type Config struct {
	Server   Server   `mapstructure:"server"`
	Log      Log      `mapstructure:"log"`
	Database Database `mapstructure:"database"`
}

var AppConfig Config

func Load(path string) error {
	if path != "" {
		viper.SetConfigFile(path)
	} else {
		viper.SetConfigName("config")
		viper.SetConfigType("json")
		viper.AddConfigPath("data")
	}

	viper.AutomaticEnv()
	viper.SetEnvPrefix(APP_ENV_PREFIX)
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	setDefaults()

	if err := viper.ReadInConfig(); err == nil {
		log.Infof("Using config file: %s", viper.ConfigFileUsed())
	} else {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			log.Infof("Config file not found, creating default config")
			if err := os.MkdirAll("data", 0755); err != nil {
				log.Errorf("Failed to create data directory: %v", err)
			}
			if err := viper.SafeWriteConfigAs("data/config.json"); err != nil {
				log.Errorf("Failed to create default config: %v", err)
			}
		} else {
			return fmt.Errorf("error reading config file: %w", err)
		}
	}

	if err := viper.Unmarshal(&AppConfig); err != nil {
		return fmt.Errorf("unable to decode config into struct: %w", err)
	}
	return nil
}

func setDefaults() {
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("database.type", "sqlite")
	viper.SetDefault("database.path", "data/data.db")
	viper.SetDefault("log.level", "info")
}
