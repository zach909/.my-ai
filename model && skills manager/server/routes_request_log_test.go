package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestInferenceRequestLoggerMiddlewareWritesReplayArtifacts(t *testing.T) {
	gin.SetMode(gin.TestMode)

	logDir := t.TempDir()
	requestLogger := &inferenceRequestLogger{dir: logDir}

	const route = "/v1/chat/completions"
	const requestBody = `{"model":"test-model","messages":[{"role":"user","content":"hello"}]}`

	var bodySeenByHandler string

	r := gin.New()
	r.POST(route, requestLogger.middleware(route), func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			t.Fatalf("failed to read body in handler: %v", err)
		}

		bodySeenByHandler = string(body)
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, route, strings.NewReader(requestBody))
	req.Host = "127.0.0.1:11434"
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	if bodySeenByHandler != requestBody {
		t.Fatalf("handler body mismatch:\nexpected: %s\ngot: %s", requestBody, bodySeenByHandler)
	}

	bodyFiles, err := filepath.Glob(filepath.Join(logDir, "*_v1_chat_completions_body.json"))
	if err != nil {
		t.Fatalf("failed to glob body logs: %v", err)
	}
	if len(bodyFiles) != 1 {
		t.Fatalf("expected 1 body log, got %d (%v)", len(bodyFiles), bodyFiles)
	}

	curlFiles, err := filepath.Glob(filepath.Join(logDir, "*_v1_chat_completions_request.sh"))
	if err != nil {
		t.Fatalf("failed to glob curl logs: %v", err)
	}
	if len(curlFiles) != 1 {
		t.Fatalf("expected 1 curl log, got %d (%v)", len(curlFiles), curlFiles)
	}

	bodyData, err := os.ReadFile(bodyFiles[0])
	if err != nil {
		t.Fatalf("failed to read body log: %v", err)
	}
	if string(bodyData) != requestBody {
		t.Fatalf("body log mismatch:\nexpected: %s\ngot: %s", requestBody, string(bodyData))
	}

	curlData, err := os.ReadFile(curlFiles[0])
	if err != nil {
		t.Fatalf("failed to read curl log: %v", err)
	}

	curlString := string(curlData)
	if !strings.Contains(curlString, "http://127.0.0.1:11434"+route) {
		t.Fatalf("curl log does not contain expected route URL: %s", curlString)
	}

	bodyFileName := filepath.Base(bodyFiles[0])
	if !strings.Contains(curlString, "@\"${SCRIPT_DIR}/"+bodyFileName+"\"") {
		t.Fatalf("curl log does not reference sibling body file: %s", curlString)
	}
}

// TestInferenceRequestLoggerCurlReplayScriptIsShellSafe proves method, host,
// and Content-Type -- all attacker-controlled -- can't smuggle shell commands
// into the generated replay script. It doesn't just check the script's text;
// it actually runs it with `sh`, the exact way the logger's own message
// tells an operator to ("replay using curl with `sh %s`"), and confirms none
// of the injected commands executed. curl itself is expected to fail (the
// hostnames are garbage) -- that's fine, the injection would happen during
// the shell's own argument evaluation, before curl is ever invoked.
func TestInferenceRequestLoggerCurlReplayScriptIsShellSafe(t *testing.T) {
	logDir := t.TempDir()
	l := &inferenceRequestLogger{dir: logDir}

	markerDir := t.TempDir()
	methodMarker := filepath.Join(markerDir, "method_pwned")
	hostMarker := filepath.Join(markerDir, "host_pwned")
	ctMarker := filepath.Join(markerDir, "contenttype_pwned")

	maliciousMethod := fmt.Sprintf("GET$(touch %s)", methodMarker)
	maliciousHost := fmt.Sprintf("evil.example$(touch %s)", hostMarker)
	maliciousContentType := fmt.Sprintf("application/json`touch %s`", ctMarker)

	l.log("/api/generate", maliciousMethod, "http", maliciousHost, maliciousContentType, []byte("{}"))

	scriptFiles, err := filepath.Glob(filepath.Join(logDir, "*_request.sh"))
	if err != nil {
		t.Fatalf("failed to glob replay scripts: %v", err)
	}
	if len(scriptFiles) != 1 {
		t.Fatalf("expected exactly one replay script, got %d (%v)", len(scriptFiles), scriptFiles)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", scriptFiles[0])
	_ = cmd.Run() // curl failing against a garbage hostname is expected and fine

	for name, marker := range map[string]string{
		"method":       methodMarker,
		"host":         hostMarker,
		"content-type": ctMarker,
	} {
		if _, err := os.Stat(marker); err == nil {
			t.Fatalf("%s injection executed: marker file %s was created by running the replay script", name, marker)
		}
	}
}

func TestNewInferenceRequestLoggerCreatesDirectory(t *testing.T) {
	requestLogger, err := newInferenceRequestLogger()
	if err != nil {
		t.Fatalf("expected no error creating request logger: %v", err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(requestLogger.dir)
	})

	if requestLogger == nil || requestLogger.dir == "" {
		t.Fatalf("expected request logger directory to be set")
	}

	info, err := os.Stat(requestLogger.dir)
	if err != nil {
		t.Fatalf("expected directory to exist: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("expected %q to be a directory", requestLogger.dir)
	}
}

func TestSanitizeRouteForFilename(t *testing.T) {
	tests := []struct {
		route string
		want  string
	}{
		{route: "/api/generate", want: "api_generate"},
		{route: "/v1/chat/completions", want: "v1_chat_completions"},
		{route: "/v1/messages", want: "v1_messages"},
	}

	for _, tt := range tests {
		if got := sanitizeRouteForFilename(tt.route); got != tt.want {
			t.Fatalf("sanitizeRouteForFilename(%q) = %q, want %q", tt.route, got, tt.want)
		}
	}
}
