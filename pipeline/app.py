#!/usr/bin/env python3
"""
Robot builder — browser interface.

Flow (matches the requested chain):

    pick male / female robot
      -> Janus-Pro describes what it looks like        (gguf/DeepSeek-Janus-Pro-7B)
        -> make a body image                            (parametric figure today)
          -> TripoSR lifts it to 3D                     (gated: needs torch)
            -> Z-Bio drops it into a small simulation    (Blender preview / proxy)
              -> Janus writes the bio / character
                -> everything is bundled into a .zip
                   ...and you can keep talking to the AI to edit it.

Launch:  ./run_app.sh        (or  .venv/bin/python -m pipeline.app)
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import subprocess
import zipfile
from pathlib import Path

import gradio as gr

from pipeline import janus
from pipeline.chain import (
    Manifest,
    ROOT,
    OUT_ROOT,
    stage_make_image,
    stage_triposr,
)

PIPELINE = ROOT / "pipeline"
ZBIO_SCRIPT = PIPELINE / "zbio_render.py"


# --------------------------------------------------------------------------- helpers
def _proportions(sex: str) -> dict:
    return {"shoulder_to_hip": 1.4 if sex == "male" else 1.05, "height_heads": 7.5}


def _bio_markdown(c: dict) -> str:
    if not c:
        return ""
    quirks = c.get("quirks") or []
    if isinstance(quirks, str):
        quirks = [quirks]
    lines = [
        f"### 🤖 {c.get('name', 'Unnamed')}  ·  `{c.get('model_designation', '—')}`",
        f"**Personality** — {c.get('personality', '')}",
        f"**Backstory** — {c.get('backstory', '')}",
        f"**Voice** — {c.get('voice', '')}",
    ]
    if quirks:
        lines.append("**Quirks** — " + "; ".join(str(q) for q in quirks))
    lines.append(f"\n*(bio source: {c.get('_source', 'janus')})*")
    return "\n\n".join(lines)


def _run_zbio(run_dir: Path, brief_path: Path, mesh: Path | None) -> Path | None:
    preview = run_dir / "zbio_preview.png"
    if not ZBIO_SCRIPT.exists():
        return None
    if mesh and mesh.exists():
        mode, src = "mesh", str(mesh)
    else:
        mode, src = "proxy", str(brief_path)
    cmd = ["blender", "--background", "--python", str(ZBIO_SCRIPT), "--",
           mode, src, str(preview)]
    try:
        subprocess.run(cmd, timeout=240, capture_output=True)
    except Exception as e:
        print("[zbio] error:", e)
        return None
    return preview if preview.exists() else None


def _make_zip(run_dir: Path) -> str | None:
    if not run_dir or not Path(run_dir).exists():
        return None
    run_dir = Path(run_dir)
    zpath = run_dir.with_suffix(".zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(run_dir.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(run_dir.parent))
    return str(zpath)


def _context_text(state: dict) -> str:
    return (f"Sex: {state.get('sex')}\n"
            f"Appearance: {state.get('description', '')}\n"
            f"Bio: {json.dumps(state.get('character', {}), ensure_ascii=False)}")


# --------------------------------------------------------------------------- build
def build_robot(sex_label: str, hint: str):
    """Generator: streams status + previews as each stage completes."""
    sex = "male" if sex_label.lower().startswith("m") else "female"
    run_id = _dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{sex}"
    run_dir = OUT_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(run_dir)
    manifest.set("1_sex", "ok", sex=sex)
    state = {"run_dir": str(run_dir), "sex": sex, "description": "", "character": {}}

    none = gr.update()

    def emit(status, body=none, sim=none, desc=none, bio=none, zip_=none):
        return status, body, sim, desc, bio, state, zip_

    yield emit(f"**1/6** Selected: **{sex} robot** · run `{run_id}`")

    # 2 — Janus describes the look
    yield emit("**2/6** Janus-Pro is describing what it looks like… (CPU, ~30s)")
    desc = janus.describe(sex, hint)
    state["description"] = desc
    (run_dir / "description.txt").write_text(desc)
    manifest.set("2_janus_describe", "ok")
    yield emit("**3/6** Rendering the body image…", desc=f"**Appearance**\n\n{desc}")

    # 3 — body image
    brief = {"image_prompt": desc, "proportions": _proportions(sex),
             "biomech_notes": ["neck", "shoulders", "elbows", "wrists",
                               "hips", "knees", "ankles", "spine"],
             "_source": "janus"}
    (run_dir / "brief.json").write_text(json.dumps(brief, indent=2))
    (run_dir / "prompt.txt").write_text(desc)
    img = stage_make_image(sex, brief, run_dir)
    manifest.set("3_image", "ok", image=str(img))
    yield emit("**4/6** TripoSR → 3D mesh…", body=str(img),
               desc=f"**Appearance**\n\n{desc}")

    # 4 — TripoSR (gated on torch)
    mesh = stage_triposr(img, run_dir, manifest)
    note = ("TripoSR mesh ready." if mesh else
            "TripoSR is gated (needs `torch`) — showing the simulation with a "
            "proxy body for now.")
    yield emit(f"**5/6** Z-Bio: dropping it into a small simulation…\n\n_{note}_",
               body=str(img), desc=f"**Appearance**\n\n{desc}")

    # 5 — Z-Bio small simulation (Blender)
    sim = _run_zbio(run_dir, run_dir / "brief.json", mesh)
    manifest.set("5_zbio", "ok" if sim else "pending",
                 preview=str(sim) if sim else None)
    yield emit("**6/6** Janus-Pro is writing the bio / character…",
               body=str(img), sim=str(sim) if sim else none,
               desc=f"**Appearance**\n\n{desc}")

    # 6 — character / bio
    character = janus.write_character(sex, desc, hint)
    state["character"] = character
    (run_dir / "bio.json").write_text(json.dumps(character, indent=2))
    manifest.set("6_bio", "ok", source=character.get("_source"))

    zpath = _make_zip(run_dir)
    yield emit(
        f"✅ **Done.** Saved to `{run_dir.name}.zip`. Talk to the AI below to edit.",
        body=str(img), sim=str(sim) if sim else none,
        desc=f"**Appearance**\n\n{desc}", bio=_bio_markdown(character), zip_=zpath)


# --------------------------------------------------------------------------- chat
def chat_fn(message: str, history: list, state: dict):
    if not state or not state.get("run_dir"):
        return history + [
            {"role": "user", "content": message},
            {"role": "assistant", "content": "Build a robot first, then we can edit it."},
        ]
    hist = [m for m in history if m.get("role") in ("user", "assistant")]
    reply = janus.edit_chat(hist, message, _context_text(state))
    return history + [{"role": "user", "content": message},
                      {"role": "assistant", "content": reply}]


def save_bio_from_chat(history: list, state: dict):
    """Regenerate the bio incorporating the whole conversation, re-zip."""
    if not state or not state.get("run_dir"):
        return gr.update(), gr.update(), state, "Build a robot first."
    convo = "\n".join(f"{m['role']}: {m['content']}" for m in history
                      if m.get("role") in ("user", "assistant"))
    character = janus.write_character(state["sex"], state.get("description", ""),
                                      hint="Honour this conversation:\n" + convo)
    state["character"] = character
    run_dir = Path(state["run_dir"])
    (run_dir / "bio.json").write_text(json.dumps(character, indent=2))
    zpath = _make_zip(run_dir)
    return _bio_markdown(character), zpath, state, "Bio updated and re-zipped. ✅"


# --------------------------------------------------------------------------- UI
def build_ui() -> gr.Blocks:
    with gr.Blocks(title="Robot Builder", theme=gr.themes.Soft()) as demo:
        gr.Markdown("# 🤖 Robot Builder\n"
                    "male/female → Janus-Pro describes it → body image → TripoSR 3D → "
                    "Z-Bio simulation → bio → **.zip**. Then edit by chatting.")
        state = gr.State({})

        with gr.Row():
            sex = gr.Radio(["Male robot", "Female robot"], value="Female robot",
                           label="What do you want to build?")
            hint = gr.Textbox(label="Optional style direction",
                              placeholder="e.g. battle-worn scout, brass and glass…")
            go = gr.Button("Build robot 🤖", variant="primary")

        status = gr.Markdown("Pick male or female and press **Build robot**.")
        with gr.Row():
            body_img = gr.Image(label="Body image", type="filepath", height=360)
            sim_img = gr.Image(label="Z-Bio simulation preview", type="filepath",
                               height=360)
        desc_md = gr.Markdown()
        bio_md = gr.Markdown()
        zip_out = gr.File(label="Download bundle (.zip)")

        go.click(build_robot, [sex, hint],
                 [status, body_img, sim_img, desc_md, bio_md, state, zip_out])

        gr.Markdown("---\n### 💬 Talk to the AI to edit")
        chatbot = gr.Chatbot(type="messages", height=320)
        with gr.Row():
            msg = gr.Textbox(placeholder="Ask Janus to change the look, name, "
                             "personality…", scale=4, show_label=False)
            send = gr.Button("Send", scale=1)
        save_bio = gr.Button("💾 Save bio from this chat")
        save_note = gr.Markdown()

        send.click(chat_fn, [msg, chatbot, state], [chatbot]).then(
            lambda: "", None, [msg])
        msg.submit(chat_fn, [msg, chatbot, state], [chatbot]).then(
            lambda: "", None, [msg])
        save_bio.click(save_bio_from_chat, [chatbot, state],
                       [bio_md, zip_out, state, save_note])
    return demo


def main():
    demo = build_ui()
    demo.queue().launch(
        server_name=os.environ.get("ROBOT_HOST", "127.0.0.1"),
        server_port=int(os.environ.get("ROBOT_PORT", "7860")),
        share=os.environ.get("ROBOT_SHARE", "0") == "1",
    )


if __name__ == "__main__":
    main()
