## 2025-05-15 - Path Traversal Vulnerability in FileSystemPlugin
**Vulnerability:** The `FileSystemPlugin` was vulnerable to path traversal because its `resolvePath` method did not validate that the resolved path remained within the intended root directory. It also allowed absolute paths to bypass the root directory entirely.
**Learning:** Using `path.resolve(rootDir, relativePath)` is insufficient for sandboxing file access. Even with a root directory, attackers can use `..` sequences or absolute paths to access files outside the sandbox.
**Prevention:** Always validate that the resolved path is contained within the root directory. This can be done by calculating the relative path from the root to the resolved path and ensuring it doesn't start with `..`. Additionally, check if the relative path is absolute (which can happen on Windows if paths are on different drives).

## 2025-05-22 - Insecure Web Server Configuration (Over-exposure)
**Vulnerability:** The `WebServer` was binding to all network interfaces (`0.0.0.0`) by default and used a wildcard CORS policy (`Access-Control-Allow-Origin: *`).
**Learning:** For local AI systems that expose powerful system capabilities (like terminal or filesystem access), binding to all interfaces exposes the system to the local network. Combined with permissive CORS, any website visited by the user could potentially interact with the local AI server.
**Prevention:** Always bind local-only services to `127.0.0.1` and use restrictive CORS policies. Avoid wildcard origins unless absolutely necessary for public-facing APIs.
## 2025-05-22 - SSRF and DNS Rebinding in BrowserPlugin
**Vulnerability:** The `BrowserPlugin.fetchUrl` method allowed fetching from any URL, including `localhost` and other private IP ranges. This could be used to access internal services or cloud metadata endpoints.
**Learning:** Checking only the hostname string in a URL is insufficient to prevent SSRF because of DNS Rebinding. An attacker-controlled domain can resolve to a local IP address after the initial string check.
**Prevention:** Perform a dual check: 1) Validate the hostname string to catch immediate local/private references. 2) Resolve the hostname using `dns.lookup` and validate the resulting IP address against private/local ranges before initiating the network request.

## 2026-07-06 - Insecure Web Server Configuration (Python wrapper)
**Vulnerability:** The Python-based `server.py` wrapper was binding to `0.0.0.0` and using `Access-Control-Allow-Origin: *`.
**Learning:** Hardening only the core TS service is insufficient if a proxy/wrapper server exists that re-exposes the endpoints insecurely.
**Prevention:** Apply the same local-only binding and restrictive CORS policies to all entry points (wrappers, proxies, or main servers).

## 2026-07-28 - Incomplete Command Filtering and Background Bypass in TerminalPlugin
**Vulnerability:** The `TerminalPlugin` had a broken command blacklist: 1) The regex used `\b` after non-word characters (like `/` in `rm -rf /`), causing it to fail on exact matches at the end of strings. 2) Background execution (`_run_bg`) completely bypassed the security check. 3) Shell-specific patterns like fork bombs were unescaped in the regex.
**Learning:** Blacklists are fragile. When using them, word boundaries must be handled carefully, especially with non-alphanumeric characters. Additionally, every entry point for execution must enforce the same security policy.
**Prevention:** Use more robust boundaries like `(?:\s|$|;)` instead of `\b` for patterns ending in non-word characters. Ensure all execution methods (sync, async, background) call a central validation helper. Always escape special regex characters when matching literal shell syntax.

## 2025-05-30 - Remote Code Execution via NeuriLang @code attribute
**Vulnerability:** The NeuriLang interpreter in `interface/cli.ts` used `new Function()` to execute the string contents of the `@code` attribute without any validation. This allowed arbitrary JavaScript execution (RCE) if a user-controlled NeuriLang snippet was processed.
**Learning:** Even internal-use DSLs can become vectors for RCE if they allow evaluation of arbitrary code. "Code-to-net" features are powerful but must be strictly sandboxed or restricted to safe primitives.
**Prevention:** Use a strict character whitelist regex (e.g., `/^[0-9a-fx+\-*/().\s]*$/i`) to ensure only safe mathematical or hexadecimal literals are executed if using `new Function()` or `eval()`. For more complex needs, use a dedicated expression parser with no access to the global scope or Node.js APIs.

## 2026-08-15 - Inconsistent FileSystemPlugin Security Controls (Python Implementation)
**Vulnerability:** While the TypeScript `FileSystemPlugin` sandboxed path access to the repository directory using a root-path resolution check, the parallel Python-based `FileSystemPlugin` in `plugins/plugin_filesystem.py` allowed arbitrary read, write, delete, search, and other filesystem operations globally via path traversal.
**Learning:** Dual language/parallel implementation of identical components (e.g., TS and Python plugins) often leads to inconsistent security controls, where a security fix is applied to one platform but missed on the other.
**Prevention:** Synchronize security patterns and resolution helpers across all language implementations. Every language version must validate resolved target paths relative to the designated sandbox directory (e.g., current working directory) before performing file system or external IO.

## 2026-08-20 - Missing Request Body Size Limit and Security Headers in Python Server
**Vulnerability:** The Python companion server (`interface/server.py`) did not enforce any limit on incoming request body size, leading to a potential DoS vulnerability via memory exhaustion if an attacker sent an overly large payload. It also lacked vital HTTP security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`), leaving dashboard clients exposed to clickjacking, MIME-sniffing, and potential XSS vectors.
**Learning:** Hardening security controls in the main TypeScript application is insufficient if parallel companion backends, proxies, or wrappers (such as `server.py`) are left without matching input-size boundaries and defense-in-depth header protections.
**Prevention:** Always implement explicit request body size limits at the HTTP entry points across all backend implementations (Python, TS, Go, etc.). Ensure that security headers are uniformly applied to all web servers serving UI files or JSON endpoints.

## 2026-08-25 - Secure DNS Rebinding Defense in BrowserPlugin (IP Pinning)
**Vulnerability:** Even with a pre-request DNS resolution check, performing HTTP/HTTPS requests using the original URL string leaves a Time of Check to Time of Use (TOCTOU) window. A malicious DNS server can return a safe public IP on the first lookup and a private IP on the connection lookup.
**Learning:** Checking the resolved IP is insufficient if the client library performs its own separate DNS lookup during connection. To fully neutralize DNS rebinding, the HTTP/HTTPS request must be pinned directly to the resolved IP address.
**Prevention:** Construct the request options using the resolved IP as the `hostname`. For correct HTTP routing and TLS validation, explicitly supply the original hostname in both the `Host` header and the TLS `servername` SNI option.

## 2026-08-26 - Argument Injection and Local Path Traversal in Python BrowserPlugin
**Vulnerability:** The `BrowserPlugin` in `plugins/plugin_browser.py` was vulnerable to both argument/flag injection and local path traversal because its `_open` and `_navigate` methods executed system browser commands using user-controlled URL inputs directly without validation. This allowed an attacker to pass command-line arguments to Chrome/Chromium binaries (by starting URLs with `-`) and read/traverse arbitrary local files (by using `file://` or relative/absolute local paths outside the repository sandbox).
**Learning:** Executing system commands or opening URLs using subprocesses without sanitizing the target strings introduces command argument injection vectors. In addition, when local browser operations are supported, validating protocol schemes and sandboxing file system access are critical to prevent unauthorized local file disclosure.
**Prevention:** Always sanitize input parameters passed to external binaries: ensure URLs do not start with a hyphen `-` to avoid flag/argument parsing. Restrict allowed URL protocol schemes, and for file-based URLs or local paths, enforce a directory jail by resolving path targets and ensuring they do not escape the current working directory.

## 2026-08-27 - Robust Testing for Immediate DoS Connection Closures
**Vulnerability:** Security tests checking payload limits on HTTP servers can become flaky or fail with socket/connection errors (`BrokenPipeError`, `ConnectionResetError`, `RemoteDisconnected`, `ResponseNotReady`) if the server aggressively closes the connection to protect against DoS attacks without fully reading the request body.
**Learning:** Aggressively drops/connection-closures are a correct and necessary defensive behavior to prevent memory exhaustion, but HTTP client libraries in tests can crash if they try to write the rest of a massive payload to a dead socket.
**Prevention:** In test harnesses verifying DoS protections, wrap both the connection request and response-gathering sequences to catch socket-level exceptions and count abrupt connection closures/TCP resets as successful payload rejections.

## 2026-08-28 - Secure Credential File Permissions in Python EmailPlugin
**Vulnerability:** The Python-based `EmailPlugin` stored plain-text email passwords on disk using default file creation APIs, making the credentials potentially world-readable depending on the host's system `umask`.
**Learning:** Standard Python `open` calls follow the default `umask` (often `0o022`), creating files with group/world-readable permissions (e.g., `0o644`). For sensitive files containing plain-text keys, tokens, or credentials, this introduces local privilege escalation and credential leakage risks.
**Prevention:** Always create sensitive credential files with highly restrictive permissions (`0o600` or owner-only read/write) by using `os.open` with a mode argument and calling `os.chmod` to ensure that any pre-existing wider permissions are corrected.

## 2026-08-29 - Argument Injection and Local Path Traversal in Python ScreenshotPlugin
**Vulnerability:** The `ScreenshotPlugin` in `plugins/plugin_screenshot.py` allowed passing user-controlled file path arguments directly to system commands like `scrot`, `gnome-screenshot`, `import`, and `ffmpeg` without sanitization. This introduced command-line argument injection risks (by passing paths starting with `-`) and arbitrary local file write/overwrite risks via path traversal.
**Learning:** External executables and subprocess calls that accept user-provided paths as arguments can parse those paths as options/flags if they start with a hyphen `-`. Furthermore, any path parameter must be explicitly sandboxed to prevent path traversal outside of designated secure directories.
**Prevention:** Sanitize target paths by ensuring they do not start with a hyphen `-` to block option injection, and validate using canonical path checks (e.g. `os.path.commonpath`) to restrict operations strictly within the current working directory or safe temporary folders (like `/tmp`).
