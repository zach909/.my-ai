## 2025-05-15 - Path Traversal Vulnerability in FileSystemPlugin
**Vulnerability:** The `FileSystemPlugin` was vulnerable to path traversal because its `resolvePath` method did not validate that the resolved path remained within the intended root directory. It also allowed absolute paths to bypass the root directory entirely.
**Learning:** Using `path.resolve(rootDir, relativePath)` is insufficient for sandboxing file access. Even with a root directory, attackers can use `..` sequences or absolute paths to access files outside the sandbox.
**Prevention:** Always validate that the resolved path is contained within the root directory. This can be done by calculating the relative path from the root to the resolved path and ensuring it doesn't start with `..`. Additionally, check if the relative path is absolute (which can happen on Windows if paths are on different drives).

## 2025-05-22 - Insecure Web Server Configuration (Over-exposure)
**Vulnerability:** The `WebServer` was binding to all network interfaces (`0.0.0.0`) by default and used a wildcard CORS policy (`Access-Control-Allow-Origin: *`).
**Learning:** For local AI systems that expose powerful system capabilities (like terminal or filesystem access), binding to all interfaces exposes the system to the local network. Combined with permissive CORS, any website visited by the user could potentially interact with the local AI server.
**Prevention:** Always bind local-only services to `127.0.0.1` and use restrictive CORS policies. Avoid wildcard origins unless absolutely necessary for public-facing APIs.
