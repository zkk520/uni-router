package helper

import "testing"

func TestAppendURLPath(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "base path without trailing slash",
			baseURL: "https://api.openai.com/v1",
			want:    "https://api.openai.com/v1/models",
		},
		{
			name:    "base path with trailing slash",
			baseURL: "https://generativelanguage.googleapis.com/v1beta/",
			want:    "https://generativelanguage.googleapis.com/v1beta/models",
		},
		{
			name:    "base url with query",
			baseURL: "https://example.com/api?version=1",
			want:    "https://example.com/api/models?version=1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := appendURLPath(tt.baseURL, "models")
			if err != nil {
				t.Fatalf("appendURLPath returned error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("appendURLPath() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAppendURLPathRejectsInvalidBaseURL(t *testing.T) {
	if _, err := appendURLPath("api.openai.com/v1", "models"); err == nil {
		t.Fatal("appendURLPath() error = nil, want error")
	}
}

func TestExtractErrorMessage(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "openai style error",
			body: `{"error":{"message":"invalid api key","type":"invalid_request_error"}}`,
			want: "invalid api key",
		},
		{
			name: "plain message error",
			body: `{"message":"permission denied"}`,
			want: "permission denied",
		},
		{
			name: "string error",
			body: `{"error":"not found"}`,
			want: "not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractErrorMessage([]byte(tt.body))
			if got != tt.want {
				t.Fatalf("extractErrorMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDecodeModelListJSON(t *testing.T) {
	type result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}

	t.Run("html body returns friendly error", func(t *testing.T) {
		var got result
		err := decodeModelListJSON([]byte("<html><body>ok</body></html>"), &got)
		if err == nil {
			t.Fatal("decodeModelListJSON() error = nil, want error")
		}
		if err.Error() != modelListHTMLMessage {
			t.Fatalf("decodeModelListJSON() = %q, want %q", err.Error(), modelListHTMLMessage)
		}
	})

	t.Run("plain invalid json returns friendly error", func(t *testing.T) {
		var got result
		err := decodeModelListJSON([]byte("not json"), &got)
		if err == nil {
			t.Fatal("decodeModelListJSON() error = nil, want error")
		}
		if err.Error() != modelListInvalidJSONMessage {
			t.Fatalf("decodeModelListJSON() = %q, want %q", err.Error(), modelListInvalidJSONMessage)
		}
	})

	t.Run("valid json succeeds", func(t *testing.T) {
		var got result
		err := decodeModelListJSON([]byte(`{"data":[{"id":"gpt-4o"}]}`), &got)
		if err != nil {
			t.Fatalf("decodeModelListJSON() error = %v, want nil", err)
		}
		if len(got.Data) != 1 || got.Data[0].ID != "gpt-4o" {
			t.Fatalf("decodeModelListJSON() = %#v, want parsed data", got)
		}
	})
}
