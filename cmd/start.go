package cmd

import (
	"github.com/spf13/cobra"
	"github.com/zkk520/uni-router/internal/conf"
	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/devfrontend"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/server"
	"github.com/zkk520/uni-router/internal/task"
	"github.com/zkk520/uni-router/internal/utils/log"
	"github.com/zkk520/uni-router/internal/utils/shutdown"
)

var cfgFile string

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start " + conf.APP_NAME,
	PreRun: func(cmd *cobra.Command, args []string) {
		conf.PrintBanner()
		conf.Load(cfgFile)
		log.SetLevel(conf.AppConfig.Log.Level)
	},
	Run: func(cmd *cobra.Command, args []string) {
		shutdown.Init(log.Logger)
		defer shutdown.Listen()
		if err := db.InitDB(conf.AppConfig.Database.Type, conf.AppConfig.Database.Path, conf.IsDebug()); err != nil {
			log.Errorf("database init error: %v", err)
			return
		}
		shutdown.Register(db.Close)

		if err := op.InitCache(); err != nil {
			log.Errorf("cache init error: %v", err)
			return
		}
		shutdown.Register(op.SaveCache)

		if err := op.UserInit(); err != nil {
			log.Errorf("user init error: %v", err)
			return
		}

		if err := server.Start(); err != nil {
			log.Errorf("server start error: %v", err)
			return
		}
		shutdown.Register(server.Close)

		if err := devfrontend.StartFromSettings(); err != nil {
			log.Warnf("dev frontend start error: %v", err)
		}
		shutdown.Register(devfrontend.Stop)

		task.Init()
		go task.RUN()
	},
}

func init() {
	startCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is ./data/config.json)")
	rootCmd.AddCommand(startCmd)
}
