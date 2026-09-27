# NeuroClaw on your phone

Two native apps that talk to NeuroClaw running on your PC. When the PC can't be reached, they fall back to OneBrain on the phone.

| | Android (`android/`, Kotlin) | iPhone (`ios/`, SwiftUI) |
|---|---|---|
| Floating bubble over other apps | Yes (needs "Display over other apps") | No: iOS does not allow it, so open the app |
| Chat with NeuroClaw on your PC | Yes | Yes |
| Photo for training data | Only when you tap **Photo** | Only when you tap **Photo** |
| Offline | OneBrain recall on the phone; messages and photos are queued and sent when the PC is reachable | Same |

## 1. Set up the PC

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
2. Open NeuroClaw, enter the PC address and password, and tap **Save**.
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

## Limits

- **Offline answers are memory, not the full brain.** The phone runs OneBrain's recall (tens of neurons, bundled from `models && skills/onebrain/model.json`). The full network only runs on the PC; running it on the phone would mean porting the engine.
- **The camera captures only when you tap.** There is no background recording. If you point it at people, they are in your training data, so ask them first.
