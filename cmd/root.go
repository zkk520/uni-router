package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/zkk520/uni-router/internal/conf"
)

var rootCmd = &cobra.Command{
	Use:   conf.APP_NAME,
	Short: conf.APP_DESC,
}

func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}
