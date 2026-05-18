package runtime

import (
	"os"
	"os/exec"
	goruntime "runtime"
	"syscall"
	"time"

	"github.com/zkk520/uni-router/internal/utils/log"
	"github.com/zkk520/uni-router/internal/utils/shutdown"
)

func RestartAfter(delay time.Duration, env map[string]string) {
	go func() {
		time.Sleep(delay)
		Restart(env)
	}()
}

func Restart(env map[string]string) {
	for key, value := range env {
		_ = os.Setenv(key, value)
	}

	shutdown.Shutdown()

	execPath, err := os.Executable()
	if err != nil {
		log.Errorf("get executable path failed: %v", err)
		os.Exit(1)
	}

	log.Infof("restarting: %q %q", execPath, os.Args[1:])

	if goruntime.GOOS == "windows" {
		cmd := exec.Command(execPath, os.Args[1:]...)
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Env = os.Environ()
		if err := cmd.Start(); err != nil {
			log.Errorf("restarting failed: %v", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	if err := syscall.Exec(execPath, os.Args, os.Environ()); err != nil {
		log.Errorf("restarting failed: %v", err)
		os.Exit(1)
	}
}
