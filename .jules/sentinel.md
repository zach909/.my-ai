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

## 2026-08-01 - Inconsistent Path Sandboxing in Python FileSystemPlugin
**Vulnerability:** While the TypeScript version of `FileSystemPlugin` implemented path sandboxing, the parallel Python implementation (`plugin_filesystem.py`) was completely unprotected, allowing full filesystem access via absolute paths or `..` traversal.
**Learning:** Security logic like path sandboxing is often inconsistent between parallel plugin implementations in multi-language projects. Attackers will target the least-protected entry point.
**Prevention:** Always verify that security fixes and patterns are synchronized across all language versions in the `plugins/` directory. Implement a standardized `_resolve` helper in the Python version that uses `os.path.realpath` and `os.path.relpath` to enforce the sandbox jail.
