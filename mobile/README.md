# NeuroClaw on your phone

Two native apps that run NeuroClaw's **full network on the phone, offline**, and **sync with your PC** whenever they can reach it.

The network on the phone is not a port. It is the PC's own engine code, bundled into one file (`mobile/brain/bundle/neuroclaw-brain.js`, about 100 KB) that both apps run in a hidden web view. Android and iPhone therefore run exactly the same brain as the PC.

| | Android (`android/`, Kotlin) | iPhone (`ios/`, SwiftUI) |
|---|---|---|
| Floating bubble over other apps | Yes (needs "Display over other apps") | No: iOS does not allow it, so open the app |
| Who answers | Always the phone's own network: the mesh with OneBrain grafted in, the Zip Loop with send neurons, net-skill routing, and yes/no. Works with no connection at all | Same |
| Photo for training data | Only when you tap **Photo**; kept on the phone until it syncs | Same |
| Screen capture | **Screen** button, one screenshot per tap | Not built — iOS has no app-level screenshot API |
| Voice-to-text | 🎙 button in chat | Same (mic button) |
| Every permission in one place | **Grant all permissions** (main screen) | **Permissions** (Settings → PC → Permissions) |
| Sync with the PC | Automatic after each message or photo, plus **Sync now** | Same |

## Fastest route: install it from the browser (PWA)

No APK, no Xcode. The web app is installable and opens offline-capable from your home screen.

1. Run NeuroClaw on the PC and set a **Remote Access password** (see step 1 below).
2. On the phone, open `http://<PC address>:3000` in Chrome (Android) or Safari (iPhone).
3. Android: menu → **Install app**. iPhone: Share → **Add to Home Screen**.

Notes: browsers only offer install over HTTPS or `localhost`, so over plain LAN HTTP use Android's **Add to Home screen** shortcut, or put the PC behind an HTTPS tunnel. The service worker (`public/sw.js`) is registered in production builds only (`npm run build`). It never caches `/api/*`. The PWA does not run the on-phone brain or the floating bubble; use the native apps below for those.

## What sync does

When the PC is reachable (after each message or photo, or when you tap **Sync now**):

- **Phone → PC:**
  - your conversations, which go into the PC's conversation log (its learning agent trains on them) and memory;
  - your photos, which go to `~/.neuroclaw/captures/`;
  - any yes/no examples taught on the phone.
- **PC → phone:**
  - the PC's OneBrain, if it's newer than the phone's (the phone rebuilds its network around it and keeps it for the next launch);
  - the PC's yes/no knowledge, re-learned on the phone from the example texts because the phone's network is narrower.

Nothing waits on sync. Without the PC, everything stays on the phone until the next time it can reach it. The server side is `POST /api/phone-sync`.

## 1. Set up the PC (only for syncing)

1. Run NeuroClaw as usual (`npm run dev`). The phone connects to the web app's port, **3000**.
2. In NeuroClaw, set a **Remote Access password**. The phone uses it to sign in.
3. Find the PC's address on your Wi-Fi (for example `192.168.1.20`). On the phone you will enter `http://192.168.1.20:3000`.

Photos you send arrive on the PC in `~/.neuroclaw/captures/`: each one is a `.jpg` plus a `.json` file holding the note and the time it was taken. They are never put in the repo. `GET /api/captures` lists them.

## 2. Android

Build the APK:

```sh
cd mobile/android
echo "sdk.dir=/path/to/Android/sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

Then on the phone:

1. Install the APK (allow "install unknown apps" for your file manager or browser).
2. Open NeuroClaw. It works right away with no setup. To sync, enter the PC address and password and tap **Save**.
3. Tap **Allow over other apps**, turn it on for NeuroClaw, and come back.
4. Tap **Start bubble**. The bubble floats over every app: tap it to talk, drag it to move it.
5. To turn it off, use **Stop** in the notification or **Stop bubble** in the app. A notification is always shown while the bubble is on.

## 3. iPhone

This needs a Mac with Xcode. The code could not be compiled where it was written, so expect to fix small build errors the first time.

```sh
cd mobile/ios
brew install xcodegen
xcodegen            # creates NeuroClaw.xcodeproj
open NeuroClaw.xcodeproj
```

Pick your Apple ID team under **Signing & Capabilities**, then run it on your phone. Tap **PC** to enter the address and password.

## Permissions, voice and screen (Android)

- **Grant all permissions** (main screen): asks for every dangerous permission the app declares (mic, camera, contacts, calendar, call log, phone, SMS, location, sensors, Bluetooth, nearby Wi-Fi, media) in one batch, instead of one at a time as each feature happens to be tapped. Declaring a permission never uses it by itself — each button below only does something once its own permission is actually granted.
- **🎙 (mic button, in chat):** voice-to-text. Tap to start listening, tap again to stop; the words land in the message box. Needs `RECORD_AUDIO`, granted by **Grant all permissions** or the system prompt.
- **Screen button (in chat):** a one-shot screenshot, uploaded to the PC the same way a tapped **Photo** is (`~/.neuroclaw/captures/`, tagged "Screenshot"). Android requires a fresh consent dialog *every* capture — there is no way to make this silent or "always on" without leaving the OS's own screen-recording indicator up continuously, which this app does not do. Each tap is its own grant, taken and released immediately.

System-level and signature-only permissions (`REBOOT`, `WRITE_SECURE_SETTINGS`, `INSTALL_PACKAGES`, and the like) are left out on purpose: a normal, sideloaded app can declare them, but Android silently refuses the grant regardless, so asking only produces dialogs that do nothing.

## Permissions (iPhone)

Settings → **PC** → **Permissions**, in the app. **Grant all permissions** at the top asks, one dialog after another, for every category iOS recognizes: Location (When In Use, then Always), Contacts, Calendars, Reminders, Photos, Microphone, Camera, Speech Recognition, Health & Fitness/Motion, Media & Apple Music, Notifications (incl. Critical Alerts), App Tracking Transparency, Bluetooth, HealthKit, HomeKit, Siri & Search, and Face ID/Touch ID (a real biometric challenge — there is no separate "ask" for that one, evaluating the policy *is* the request). Each is also listed individually below it, to (re)request just one.

Three items have no request dialog at all — this is an iOS limitation, not something an app can route around:

- **Background App Refresh** and **Cellular Data** are set by the person, in Settings, full stop; an app can only read the current state (`Permissions.swift`'s `backgroundRefreshStatus()` / `cellularStatus()`). The app declares `UIBackgroundModes: [fetch]` and runs a real sync (`AppDelegate.swift`) whenever iOS wakes it for one.
- **Files and Folders** (`NSDocumentsFolderUsageDescription`/`NSDownloadsFolderUsageDescription`) are Mac Catalyst keys for folder-level sandbox access; a plain iOS app reaches files through the system document picker instead, which has its own, separate authorization.

Two more need a step in Xcode this repo cannot do for you:

- **HealthKit** and **HomeKit** each need their capability turned on for the app ID (Signing & Capabilities → **+ Capability** → HealthKit / HomeKit). **HomeKit also needs a paid Apple Developer Program membership** — Xcode will say so if you try it on a free personal-team account. `NeuroClaw.entitlements` already lists both; until the capability is added, those two rows report that plainly instead of a grant.

Siri here is authorization only (`INPreferences.requestSiriAuthorization`); donating specific shortcuts/intents needs a separate Intents Extension target, which is its own Xcode project surface and out of scope for a repo nobody can compile here.

## The network on the phone

`mobile/brain/src/index.ts` builds the phone's network from the engine in `models && skills/core`: the full equation (network weight and bias, waves, connection biases) on a 32-neuron, 32-dimension mesh. OneBrain's 54 neurons are grafted in, for 86 in total. What it learns is saved when the app goes to the background and restored on the next launch.

After changing the engine, rebuild the bundle before building the apps:

```sh
npm run build:phone-brain     # -> mobile/brain/bundle/neuroclaw-brain.js
```

`test/core/phone-brain.test.ts` runs the bundle in a bare JavaScript context, with no Node and no browser features, the way a phone might.

## Limits

- **Speed.** One message takes about 4 to 5 s on a desktop CPU in a browser, so expect roughly 10 to 20 s on a phone. Most of that is the Zip Loop streaming the prompt in bit by bit.
- **Size.** The phone's mesh is smaller than the PC's (86 neurons against the PC's 64-neuron base plus everything grafted into it), and a reply the phone's network writes is limited to a few bytes per message. The PC gives more room.
- **Not trained yet.** Until the network is trained to write replies, the phone answers "one brain has nothing trained to say here yet." plus what OneBrain recalls, the same as the PC does.
- **Saved state is about 4 MB.** It is saved when the app goes to the background, not after every message.
- **The camera captures only when you tap.** There is no background recording. If you point it at people, they are in your training data, so ask them first.
