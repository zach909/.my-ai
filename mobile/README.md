# NeuroClaw on your phone

Two native apps that run NeuroClaw's **full network on the phone** and use the bigger one on your PC when they can reach it.

The network on the phone is not a port. It is the PC's own engine code, bundled into one file (`mobile/brain/bundle/neuroclaw-brain.js`, about 100 KB) that both apps run in a hidden web view. Android and iPhone therefore run exactly the same brain as the PC.

| | Android (`android/`, Kotlin) | iPhone (`ios/`, SwiftUI) |
|---|---|---|
| Floating bubble over other apps | Yes (needs "Display over other apps") | No: iOS does not allow it, so open the app |
| Chat with NeuroClaw on your PC | Yes | Yes |
| Photo for training data | Only when you tap **Photo** | Only when you tap **Photo** |
| Without the PC | The full network runs on the phone: the mesh with OneBrain grafted in, the Zip Loop with send neurons, net-skill routing, and yes/no. Messages and photos are also queued for the PC | Same |

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
