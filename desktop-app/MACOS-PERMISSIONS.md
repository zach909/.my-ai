# macOS permissions for NeuroClaw

NeuroClaw's macOS desktop build declares privacy purpose strings for supported macOS-protected resources. These strings explain why access may be requested; they do **not** grant permission by themselves. macOS controls each permission through TCC and System Settings, and the user must approve it. NeuroClaw must request access only when the user invokes the corresponding feature.

## Permission inventory

| Permission / capability | How macOS grants it | Important limitation |
|---|---|---|
| Location Services | Location prompt when a location feature is implemented and invoked | Electron/Node does not automatically gain a reliable native location API just because a plist string exists. |
| Contacts, Calendars, Reminders | Per-category privacy prompts from a native API or supported helper | Purpose strings alone do not implement these integrations. |
| Photos | Photo-library prompt where applicable; file picker can grant access to selected items | Prefer the picker when the feature only needs a chosen file. |
| Bluetooth | Bluetooth privacy prompt when a supported API is used | A usage string does not add a Bluetooth implementation. |
| Local Network | Local-network prompt when the app browses or connects to LAN devices | Only connect to user-selected/trusted devices. |
| Microphone, Camera | Electron media permission flow plus macOS privacy approval | Ask at point of use; never activate covertly. |
| Speech Recognition | Speech-recognition authorization when the native speech API is used | Separate from microphone permission. |
| HomeKit, Media & Apple Music | Native framework authorization where supported | These require real integrations and may need additional capabilities or signing setup. |
| Desktop, Documents, Downloads, network and removable volumes | User-selected open/save dialogs and macOS privacy controls | The app cannot silently grant itself access to every folder or volume. |
| Screen & System Audio Recording | User enables Screen Recording / audio capture in System Settings; app may need to be relaunched | There is no legitimate plist key that silently grants screen/audio capture. |
| Accessibility | User enables NeuroClaw in Privacy & Security → Accessibility | Cannot be granted by the app. Use only for user-authorized assistive/automation features. |
| Input Monitoring | User enables NeuroClaw in Privacy & Security → Input Monitoring | Cannot be silently granted. |
| Automation / Apple Events | User approves each target-app automation request in macOS prompts/System Settings | Add a target-specific Apple Events usage description only when the target integration is known. |
| Full Disk Access | User explicitly enables NeuroClaw in Privacy & Security → Full Disk Access | No entitlement or plist key can grant this. It is broad and should not be required for ordinary file access. |
| Focus, Notifications, Shortcuts | User/system authorization or per-feature configuration, depending on API | There is no universal “Focus permission” that unlocks every Focus setting. Shortcuts access is API- and workflow-specific. |
| App Management, Developer Tools, System Configuration | Depends on the specific operation; some actions require admin approval or separate developer tools | Not a single blanket permission. Do not bypass system prompts or privilege boundaries. |
| Extensions, Remote Desktop | Per-extension approval, app-specific configuration, or managed system settings | System extensions and remote-control features can require signed/notarized builds, special entitlements, or user/admin approval. |
| HomeKit and other protected frameworks | Framework-specific authorization and capability configuration | Must be implemented and tested separately; declaration alone is insufficient. |

## Additional macOS controls to account for

Depending on features implemented, users may also see prompts or settings for Notifications, Apple Events automation, file-provider/document-picker access, removable volumes, network volumes, Bluetooth, Screen Recording, Accessibility, Input Monitoring, camera, microphone, speech recognition, location, Photos, Contacts, Calendars, Reminders, and protected developer/system extensions. Keychain access is controlled by signing identity and keychain ACLs rather than a universal privacy switch. Administrator privileges are not a privacy permission and should be requested only for a specific installation or system operation.

## Implementation rules

1. Request permission only immediately before the user starts the feature that needs it.
2. Explain the feature and data use in the UI before opening a system prompt or Settings page.
3. Treat denied, restricted, unavailable, and not-yet-requested as distinct states. Never loop prompts or imply that access was granted.
4. Provide a Settings-opening help action for permissions macOS does not let an app request programmatically.
5. Do not claim “all permissions granted” based on plist declarations. Show each permission as **Granted**, **Not granted**, **Needs Settings**, **Unsupported**, or **Feature not implemented** based on a real platform check.
6. Never attempt to bypass TCC, elevate silently, or obtain screen, audio, input, or filesystem access without user consent.

## Runtime helpers now exposed to the renderer

The Electron preload exposes three narrowly scoped helpers:

- `getMacOSPermissionsStatus()` reports the platform and the permission states Electron can query directly. For categories Electron cannot reliably inspect, it returns `settings-required`; that is not the same as granted.
- `requestMacOSMediaAccess('camera' | 'microphone')` invokes Electron's native consent flow for those two supported media categories and returns the actual result.
- `openMacOSPrivacySettings(category)` opens the relevant Privacy & Security pane for supported categories such as camera, microphone, location, Accessibility, Input Monitoring, Screen Recording, Full Disk Access, Bluetooth, and Automation.

These are renderer-facing APIs, not a completed permission dashboard. A UI must call them when the user enables a feature, display the returned state accurately, and handle OS-version differences. Do not use the status helper to imply access to Contacts, Calendar, files, or other categories that it cannot query directly.

The entitlement file configured for Electron's hardened runtime is not a permission grant. Distribution still requires macOS build testing and, for external distribution, appropriate code signing and notarization.
