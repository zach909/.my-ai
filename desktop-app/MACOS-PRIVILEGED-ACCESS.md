# macOS privileged access

## What root access means

NeuroClaw cannot grant itself root access or bypass macOS authorization. Root is not a normal privacy permission. A user or administrator must explicitly authorize privileged operations, and macOS may require a correctly signed and installed privileged helper.

## Required design

Use a narrowly scoped privileged helper installed through Apple's supported Service Management mechanism. The Electron renderer and ordinary main process must remain unprivileged.

The helper must:

- Expose named, allowlisted operations only. Never expose a generic command, shell, script, arbitrary path write, or arbitrary executable interface to the renderer.
- Validate every request, argument, path, and target resource inside the helper; do not trust validation performed by the UI.
- Require explicit user intent for each privileged action and use macOS authorization/administrator approval during installation or when the OS requires it.
- Restrict file operations to the exact paths and operations needed by a feature.
- Return structured results and audit records without storing administrator passwords, authorization secrets, or authentication tokens.
- Fail closed if authorization is denied, the helper is missing, signatures are invalid, or a request is unsupported.
- Keep routine AI inference, networking, plugins, and user-interface work out of the privileged process.

## Implementation status

The `privilegedHelperAuthorization` entry in the permission catalog is a capability label, not a root grant or a working helper installation. Adding a catalog entry or an Info.plist purpose string cannot grant root privileges.

A production implementation requires native macOS helper code, a narrowly defined operation protocol, signing and packaging configuration, and an explicit install/authorization flow. Those pieces must be built and signed for the target macOS versions; they must not be represented as complete merely because the capability appears in the catalog.

## User-facing behavior

When a feature needs elevation, explain the exact operation and why it needs elevated privileges, then request authorization through the supported macOS flow. If the user declines, cancel that operation and continue running the rest of NeuroClaw without elevation.
