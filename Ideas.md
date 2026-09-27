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

## Working on

- 🔨 **Delete the tokenizer.** Remove `models && skills/tokenizer.js` and move everything that used it onto raw bytes, which is what the Zip Loop already speaks.

## To do

- ⏳ **Android app (and Apple).** An installable APK that can display over other apps, so you can talk to it like any phone assistant, with camera access (Meta-glasses style) to collect training data.
  - iOS does not allow apps to draw over other apps, so an iPhone version would have to be an ordinary app, a widget or a Siri shortcut.
  - Camera capture should stay on the device, be visibly on, and be opt-in, because it records other people too.
