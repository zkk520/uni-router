package portutil

import (
	"net"
	"testing"
)

func TestValidatePort(t *testing.T) {
	if err := ValidatePort(1); err != nil {
		t.Fatalf("expected port 1 valid: %v", err)
	}
	if err := ValidatePort(65535); err != nil {
		t.Fatalf("expected port 65535 valid: %v", err)
	}
	if err := ValidatePort(0); err == nil {
		t.Fatalf("expected port 0 invalid")
	}
	if err := ValidatePort(65536); err == nil {
		t.Fatalf("expected port 65536 invalid")
	}
}

func TestNextAvailableSkipsBusyPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen random port: %v", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	next, err := NextAvailable(port)
	if err != nil {
		t.Fatalf("next available: %v", err)
	}
	if next == port {
		t.Fatalf("expected next port to skip busy port %d", port)
	}
	if err := ValidatePort(next); err != nil {
		t.Fatalf("expected recommended port valid: %v", err)
	}
}
