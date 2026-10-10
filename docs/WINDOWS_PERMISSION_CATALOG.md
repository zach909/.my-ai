# Windows Permission and Capability Catalog

## Purpose

This catalog defines the full Windows capability surface that .my-ai may support. It is not a claim that every capability is currently implemented or that Windows offers a single master permission. The app must check each capability at runtime, request consent where applicable, and report one of: granted, denied, unavailable, unsupported, or not tested.

## Privacy, sensors, and voice

- Camera and webcam capture
- Microphone capture and audio input-device selection
- Speaker/audio output-device selection
- Location services and location estimates
- Speech recognition and voice commands
- Voice activation / wake-word listening (explicit opt-in, visible status, mute control)
- Notifications and notification actions
- Screen capture and system-audio capture
- Screen observation and OCR
- Accessibility tree access and assistive-technology integration
- Input monitoring and global hotkeys, only with explicit user enablement
- Pointer/keyboard automation, only for user-authorized workflows

## Files and storage

- User-selected files and folders
- Documents, Desktop, Downloads, Pictures, Videos, Music
- Removable drives and USB storage
- Network shares and mapped drives
- OneDrive and other synced folders, subject to normal account/file permissions
- Broad filesystem access where the chosen app packaging model supports it
- File create, read, update, move, rename, and delete operations
- File type associations and drag-and-drop
- Automatic downloads, with destination and file-type controls
- Archive creation and extraction
- File metadata and search/indexing
- App-owned configuration, logs, cache, and encrypted local memory

## Personal information and communications

These require a supported local API, provider integration, or explicit user-selected export; do not assume Windows exposes a universal API.

- Account/profile information
- Contacts and address books
- Calendars and events
- Tasks and reminders
- Email accounts, messages, folders, and attachments
- Messaging services and message history
- Phone/VoIP calling, call control, and call history
- Browser profiles, bookmarks, history, and downloads, only through supported interfaces and with consent
- Password/passkey managers only through supported OS/provider flows; never extract secrets from protected stores
- Media libraries and playback metadata

## Connectivity and peripherals

- Wi-Fi state and supported network configuration
- Ethernet and other wired network interfaces
- Bluetooth radio, paired devices, and supported discovery of nearby/unpaired devices
- USB and serial devices
- Printers, print queues, and print-to-file
- NFC/proximity hardware where present
- Cameras, microphones, audio devices, displays, scanners, and other peripherals
- Network discovery and local-network communication, subject to firewall and network policy

## System and application capabilities

- Operating-system and hardware information
- Installed applications and supported application metadata
- Running-process metadata and app diagnostics
- Start, stop, and manage .my-ai-owned processes
- Read application logs and diagnostics
- Open URLs, files, folders, and approved applications
- Startup launch and background operation, with a user-visible setting and off switch
- Scheduled tasks and Windows services only when explicitly installed/configured and appropriately authorized
- Power state and battery information
- Display, audio, and supported device settings
- Registry read/write only for documented keys and with clear purpose
- Environment variables and PATH inspection
- Developer tools, compilers, Git, terminals, and repository access
- Firewall/network configuration inspection; changes require appropriate authorization
- Windows Update/security status inspection where supported
- Windows Security and antivirus status inspection where supported
- Event logs and crash diagnostics where permissions allow
- Accessibility and UI automation for user-directed tasks
- Clipboard read/write with explicit feature controls and clear user feedback
- Printing and document export
- File and process monitoring for configured paths/processes

## Administrative and security-sensitive capabilities

- Standard user access under the current account
- UAC elevation for individual operations that genuinely require administrator privileges
- Install/uninstall, drivers, services, protected system folders, machine-wide registry changes, and firewall changes only through an explicit elevated installer/action
- Credential Manager access only through supported authentication APIs
- Device management and policy inspection only where supported and authorized
- No silent privilege escalation, UAC bypass, security-control bypass, credential dumping, or concealment

## Implementation requirements

1. Keep a capability registry with an identifier, description, required API, sensitivity level, availability check, consent state, and runtime verification.
2. Separate capability declaration from actual functionality. A permission being declared does not mean access works.
3. Ask at the point of use for consent where possible; explain why the feature needs access.
4. Provide per-capability enable/disable controls, activity indicators for camera/microphone/screen observation, and an audit log.
5. Use least privilege by default. For broad filesystem access, prefer user-selected folders where sufficient; if broad access is enabled, explain its scope.
6. Do not collect personal data in the background unless the user explicitly enabled that feature.
7. Do not read secrets from browsers or credential stores. Use documented sign-in/provider APIs.
8. Treat email, contacts, calendar, tasks, messages, and calls as provider integrations rather than assuming a universal Windows API exists.
9. Handle permission denial, missing hardware, unavailable APIs, disconnected devices, and revoked access without crashing.
10. Display accurate runtime states: granted, denied, unavailable, unsupported, or not tested.
11. Record sensitive actions in a local audit log without storing secret content unnecessarily.
12. Keep destructive or irreversible actions behind a separate confirmation. Require human approval for elevated, destructive, financial, account-security, or externally visible actions.
13. Test on supported Windows versions and test both allowed and denied access paths.
14. Do not claim that this catalog means the app already implements every capability.

## Windows desktop-app limitation

A conventional Electron/Win32 desktop app does not receive one universal Windows permission prompt and may not appear in the per-app lists for Store apps. Some settings apply primarily to packaged apps; ordinary file and process access is also bounded by the signed-in user's ACLs, app sandboxing, Windows security controls, and any elevation granted. Packaging choice affects which capability declarations and privacy controls are available.

## References

- Microsoft Support, App permissions: https://support.microsoft.com/en-us/windows/apps/app-permissions
- Microsoft Support, Windows privacy settings that apps use: https://support.microsoft.com/en-us/windows/privacy/windows-privacy-settings-that-apps-use
- Microsoft Learn, File access permissions: https://learn.microsoft.com/en-us/windows/apps/develop/files/file-access-permissions
- Microsoft Learn, App capability declarations: https://learn.microsoft.com/en-us/windows/apps/develop/app-capability-declarations


## Individual tool API

The desktop preload exposes individual tools under `window.electronAPI.windowsTools`. For example:

```js
const inventory = await window.electronAPI.windowsTools.list();
const system = await window.electronAPI.windowsTools.systemInfo();
const photo = await window.electronAPI.windowsTools.camera();
const location = await window.electronAPI.windowsTools.location();
const audio = await window.electronAPI.windowsTools.microphone({ seconds: 5 });
const selected = await window.electronAPI.windowsTools.selectFile();
```

The catalog includes a named tool for each capability. The first implemented tools include file/folder selection, bounded reads/writes through native dialogs, camera photo capture, microphone recording capped at 10 seconds, geolocation, clipboard read/write, notifications, network-interface information, system/environment information, Windows process listing, consent-gated program launch and stopping only app-owned processes, and opening URLs/paths.

All camera, microphone, location, clipboard-read, and external-program operations are permission/consent sensitive. Camera and microphone streams are stopped after capture; returned media is passed back as a photo data URL or base64 audio recording. The tools that need provider/native adapters return `adapter-required` rather than claiming to work. See `desktop-app/src/main/windows-capability-tools.js` for the live registry and runtime status.


## Expanded per-capability API inventory

The registry now contains 168 individually named capability tools. Every registry ID is exposed as a separate method on `window.electronAPI.windowsTools`; use `list()` and `status(id)` to discover each capability and its reported implementation state. The full registry is the authoritative list of tool IDs.

Examples of newly split capabilities include file create/update/move/rename/delete and monitoring; OneDrive/synced folders; audio/screen capture and OCR; camera/audio device enumeration; Ethernet, DNS, proxy, VPN and network metadata; app/window control; device/scanner/NFC metadata; Windows Update, Defender, encryption and Secure Boot status; startup entries, services, scheduled tasks, registry inspection/modification; credential/passkey provider flows; app permission state, consent history/revocation, audit logs, data export/deletion and backup/restore.

**Important status distinction:** all 168 are registered and callable by name, but most newly cataloged tools intentionally return `adapter-required` or `admin-or-adapter-required` until their real Windows/provider implementation is written and tested. Registration is not permission granted, and it is not proof of functional support. The implemented main-process handlers remain the subset listed above; capability tests verify registry/API coverage and honest status reporting, not hardware integration or all Windows permission paths.


## Expanded Windows manifest and security inventory

The registry additionally tracks Windows package-manifest capabilities and their applicability separately from ordinary desktop permissions. The list includes networking capabilities; broad filesystem access; appointments, contacts, account info, VoIP, chat and phone-call capabilities; media libraries; removable storage; Bluetooth, webcam, microphone, location, NFC/proximity, HID, serial, USB, GPIO, I²C, SPI, point-of-service and spatial-perception device capabilities; background media/tasks; package query/management; screen duplication; app diagnostics/capture settings; full-trust packaging; wallet, SMBIOS, enterprise authentication and certificate-related capabilities. These are not all available to an ordinary Electron desktop app. Actual applicability depends on package identity, trust level, Windows version, hardware, API availability and any restricted-capability approval.

The new inventory also names Windows security mechanisms: current-token/elevation inspection, selected-path ACL inspection, best-effort current-process access checks, Windows privacy/settings shortcuts, network interface status, applicable policy inspection, and explicit UAC operation requests. Implemented read-only handlers report the current process context and do not elevate it or change permissions. The UAC request, policy inspection and most manifest capabilities still require dedicated adapters.

## Microsoft references

- App permissions and how desktop apps differ from Store apps: https://support.microsoft.com/en-us/windows/apps/app-permissions
- Windows privacy settings and desktop-app caveats: https://support.microsoft.com/en-us/windows/privacy/windows-privacy-settings-that-apps-use
- App capability declarations, including general, device, restricted and custom capabilities: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/app-capability-declarations
- File access permissions and broad filesystem access: https://learn.microsoft.com/en-us/windows/apps/develop/files/file-access-permissions

This is an inventory for the chosen .my-ai Windows desktop app, not a claim that every documented Windows capability applies to it. Windows also has security boundaries—ACLs, user tokens, UAC, group/enterprise policy, service permissions, device drivers and provider-level authorization—that are not one app permission switch. Each feature must expose its actual runtime state and fail safely if denied or unavailable.


## Read-only Windows security inspection tools

The registry now also contains read-only tools for the current process token's privilege list, Windows Firewall profile state, Microsoft Defender status, validated service status and service security descriptors, local account-policy summary, mapped/local network shares, and PowerShell execution-policy scopes. These use Windows-native command-line interfaces from the main process, validate service names, use fixed PowerShell commands, and do not change firewall, Defender, service, account, or execution policies.

The registry also includes manifest declarations that may be applicable to packaged AppContainer/MSIX applications. A manifest entry is a capability inventory item, not a grant. Microsoft's official documentation explains that most app capabilities apply to apps with package identity and that restricted capabilities can require approval; a normal full-trust desktop app does not automatically get AppContainer grants. See [Microsoft's capability declaration guide](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations) and [Microsoft's app-permissions guide](https://support.microsoft.com/en-us/windows/apps/app-permissions).


## Additional implemented read-only inventory tools

The catalog now marks these capabilities as implemented through Windows-native metadata interfaces: Wi-Fi interface status, visible Bluetooth and USB device metadata, audio endpoints, installed printers, display metadata, visible installed-app entries, common Run-key startup entries, scheduled-task metadata, battery telemetry, Firewall profile status, Microsoft Defender status, event-log metadata, Windows service metadata, and basic Windows system metadata. These handlers are read-only; they do not change firewall rules, service state, startup entries, scheduled tasks, registry ACLs, or system settings.

Coverage is intentionally scoped. Installed-app results come from common uninstall registry locations and are not a complete software inventory. Startup inspection covers common Run registry keys, not every startup mechanism. Event-log metadata does not imply access to every event record. Bluetooth/USB/audio listings depend on the device, driver, Windows version, and current account. A tool marked implemented means the handler exists; it does not mean the Windows resource is guaranteed to be present or accessible on every machine.


## User-consented filesystem operations and further native inspection

The branch now implements native picker-based access to Documents, Desktop, Downloads, Pictures, Videos, Music, a chosen general folder, and a chosen local synced folder. These are per-operation folder selections, not persistent grants or unrestricted filesystem access. New-file creation refuses to overwrite existing files; file updates and deletion require explicit confirmation; move/rename uses a selected source and destination and refuses overwrite. File-name search is limited to a user-selected folder, skips symbolic links, and has depth, visit, and result limits. Media inventory returns names and basic metadata only for matching media file types, without reading their contents.

Additional read-only Windows handlers cover removable-drive metadata, Ethernet adapters, DNS and proxy settings, local TCP/UDP endpoint metadata, visible Plug and Play devices, visible process-window titles, Windows Update service state, power/sleep configuration, volume-encryption status, and Secure Boot status where supported. These are bounded inspections, not grants of new OS privileges. Some commands or fields may be unavailable on a particular Windows edition, hardware configuration, or user account.


## Further native tools and security boundaries

Additional handlers report the current account and group metadata, visible camera/keyboard/mouse/HID device metadata, bounded process CPU/memory metadata, app-owned log file metadata, tracked child processes, and versions of a fixed set of developer tools. Git inspection is restricted to a folder selected by the user and read-only Git commands. Clipboard image reads and clipboard clearing each require a separate confirmation dialog. Registry inspection is restricted to predefined non-secret keys; arbitrary registry paths and credential stores are not accepted.

Settings shortcuts open the relevant Windows Settings page for app permissions, location, accessibility, default apps, sound, date/time, and general privacy controls. Opening a settings page does not change the setting or grant the app access. Generic UAC elevation remains marked as requiring a dedicated reviewed helper; the app does not expose a generic elevated command runner.
