# Ideas

Running list of requested changes to NeuroClaw, with status. Newest requests at the bottom.

Status: ✅ done · 🔨 in progress · ⏳ to do

## Done

- ✅ **One memory model (OneBrain).** The 14 separate `self_ext_N` models are merged into `models && skills/onebrain/`, and every new self-extension is folded into it automatically.
- ✅ **OneBrain on the mesh.** OneBrain's neurons are grafted into the live network as one "OneBrain" region, and its weights are real mesh connections.
- ✅ **Zip Loop send neuron (input and output).** One neuron for 1, one for 0, and one for *send*. Send alternates between off and fully on, and a bit only counts when send fires. That way "0", "00" and "000" are different messages: `0 → send → 0 → send`.
  - Input: each bit is one tick with only the data neuron driven, then one tick with data + send.
  - Output: a bit is read only when the send-out neuron turns on. If it stops firing, the message is over.
- ✅ **Replace the MoE with the net-skill system.** The Mixture-of-Experts router is deleted. Each skill/plugin is a region of the one mesh, and `NetSkillRouter` switches on the regions whose meaning matches the input. Hyperdimensional thinking, all-to-all connections, the Zip Loop and quantum interference are unchanged.
- ✅ **Prompt skills go into the Zip Loop.** Chat hands the prompting skills that apply to a message (up to 3) to generation, and each one is streamed through the neural Zip Loop with the prompt, as `prompting-skills/<name>/SKILL.txt`.
- ✅ **Extension Builder builds directly into the network.** Every edit in the builder (debounced) is synced into the skill's region of the live mesh: new neurons are grafted, edited ones re-placed, deleted ones detached, and connections rewritten. There's a toggle on the builder page. Grafted skills are also registered for net-skill routing, so they actually get switched on.
- ✅ **The AI has access to mods.** The terminal plugin has `list_mods`, `read_mod`, `apply_mod` and `revert_mod` tools. Looking is ordinary file reading. Applying or reverting needs the new `mods.apply` capability (level `system`, under the Workspace switch), which is **not granted by default**: turn it on in Access. The tools check it themselves, so a chat request can't skip it. Applying keeps a backup, and `revert_mod` restores it.
- ✅ **Yes/no questions with a probability.** `YesNoDoorway` (`models && skills/core/yes-no.ts`) and `/api/yes-no/teach` and `/api/yes-no/ask`: teach it examples, then give it a whole email plus "Is this spam?" and it answers yes or no with a calibrated probability. Each question is its own 3-neuron region of the mesh. See `wiki/Yes-No-Questions.md`.
- ✅ **Tools fire from their own neurons.** Every terminal and desktop tool has its own neuron in the mesh (`tool-neurons.ts`). That layer already existed, but its firings were only acted on from the manual Zip Loop endpoint. Now every chat turn calls the tools whose neurons fired: access-checked, with arguments from the Zip Loop's output, and results fed back into the mesh. The calls are listed in the turn's details (`toolCalls`).
- ✅ **Delete the tokenizer.** `tokenizer.js` is gone, and text is its UTF-8 bytes everywhere, the same as the Zip Loop:
  - the chat embedding, OneBrain's neuron labels (`memory_input_b<byte>`), recall, the RLM action space, and the trainer's alphabet;
  - OneBrain models saved with old tokenizer ids are converted to bytes when loaded. The bundled OneBrain was converted, which dropped 3 neurons and 71 connections that sat on the old start/end/unknown markers.
- ✅ **Android app (and iPhone).** See `mobile/README.md`.
  - **Android** (`mobile/android`, native Kotlin; the APK builds): a floating bubble over other apps (tap to talk, drag to move) and a full-screen chat. It talks to NeuroClaw on your PC over your Wi-Fi, and a photo is captured only when you tap **Photo**, sent to the PC as training data (`~/.neuroclaw/captures/`).
  - **Offline:** OneBrain on the phone answers from memory, and messages and photos are queued and sent when the PC is back.
  - **iPhone** (`mobile/ios`, SwiftUI): the same minus the bubble, which iOS does not allow. It needs a Mac to build, and it has not been compiled yet.
- ✅ **Full network on the phone, cross-platform.** The PC's own engine is bundled into one ~100 KB file (`npm run build:phone-brain`) that Android and iPhone both run in a hidden web view. It includes:
  - the mesh with the full equation and OneBrain grafted in (86 neurons);
  - the Zip Loop with send neurons, net-skill routing, and yes/no.

  Without the PC, the phone's own network answers; what it learns is saved between launches. One message takes about 4 to 5 s on a desktop CPU, more on a phone.
- ✅ **Offline on the phone, syncs with the PC.** The phone's own network always answers, even with no connection. Sync (automatic, plus **Sync now**) works both ways, over `POST /api/phone-sync`:
  - phone → PC: conversations (into the PC's learning log), photos, and yes/no examples;
  - PC → phone: the PC's newer OneBrain and its yes/no knowledge.
- ✅ **Zip Loop toggle neuron.** An optional neuron pair (`toggleIn` / `toggleOut`) that flips level on every bit, so the network can tell `0` from `00` even if it holds send on between bits. It restarts low each message. Opt-in by passing both ids to `ZipLoopInterface`; the live mesh still uses the default six neurons until two free neurons are assigned.
- ✅ **No waiting out the quiet ticks.** A send-clocked doorway (`ZipLoopInterface`) ends a run on the first byte the network doesn't send once it has spoken, instead of waiting `quietTicks` (32) more reads.
