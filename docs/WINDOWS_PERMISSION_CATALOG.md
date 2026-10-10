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
