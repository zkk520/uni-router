package portutil

import (
	"fmt"
	"net"
)

func ValidatePort(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("端口必须在 1 到 65535 之间")
	}
	return nil
}

func IsAvailable(port int) bool {
	if err := ValidatePort(port); err != nil {
		return false
	}

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

func NextAvailable(start int) (int, error) {
	if err := ValidatePort(start); err != nil {
		return 0, err
	}

	for port := start + 1; port <= 65535; port++ {
		if IsAvailable(port) {
			return port, nil
		}
	}
	for port := 1; port < start; port++ {
		if IsAvailable(port) {
			return port, nil
		}
	}
	return 0, fmt.Errorf("没有找到可用端口")
}
