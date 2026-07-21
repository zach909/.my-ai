#!/usr/bin/env python3
"""
Body-generation chain:

    [1] ask m / f
        -> [2] Agno agent (local Ollama) writes an image prompt + anatomical spec
            -> [3] make an image of that body
                -> [4] TripoSR turns the image into a 3D mesh
                    -> [5] Z-Bio: load the mesh in Blender (Z-Biomechanics) and render a preview

Every stage writes its output into  pipeline/out/<run-id>/  and records its
status in  manifest.json , so the chain is resumable and each stage can be
upgraded independently (e.g. swap the placeholder image step for a real
diffusion model) without touching the others.

Run:
    ./run_chain.sh --sex m
    ./run_chain.sh                # interactive m/f prompt
    ./run_chain.sh --sex f --model qwen2.5-coder:latest
"""
from __future__ import annotations

import argparse
import datetime as _dt
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # /home/zach/robots
PIPELINE = ROOT / "pipeline"
OUT_ROOT = PIPELINE / "out"
VENV_PY = ROOT / ".venv" / "bin" / "python"


# ----------------------------------------------------------------------------- helpers
def _log(stage: str, msg: str) -> None:
    print(f"[{stage}] {msg}", flush=True)


def _have_module(name: str, python: str | None = None) -> bool:
    """Is <name> importable, optionally in another interpreter?"""
    if python and python != sys.executable:
        r = subprocess.run([python, "-c", f"import {name}"],
                           capture_output=True)
        return r.returncode == 0
    return importlib.util.find_spec(name) is not None


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2))


class Manifest:
    """Tiny per-run state file so the chain is inspectable / resumable."""

    def __init__(self, run_dir: Path):
        self.path = run_dir / "manifest.json"
        self.data = {"run_dir": str(run_dir), "created": _dt.datetime.now().isoformat(),
                     "stages": {}}

    def set(self, stage: str, status: str, **extra) -> None:
        self.data["stages"][stage] = {"status": status, "at": time.time(), **extra}
        _write_json(self.path, self.data)


# ----------------------------------------------------------------------------- stage 1
def stage_select_sex(arg_sex: str | None) -> str:
    if arg_sex:
        s = arg_sex.strip().lower()[:1]
    else:
        s = input("Male or female? [m/f]: ").strip().lower()[:1]
    if s not in ("m", "f"):
        raise SystemExit(f"sex must be 'm' or 'f', got {arg_sex!r}")
    sex = "male" if s == "m" else "female"
    _log("1/sex", f"selected: {sex}")
    return sex


# ----------------------------------------------------------------------------- stage 2
AGNO_INSTRUCTIONS = (
    "You are a 3D character art director feeding a single-image-to-3D model "
    "(TripoSR). For the requested human sex, return STRICT JSON only (no prose, "
    "no markdown fences) with these keys:\n"
    '  "image_prompt": a vivid one-paragraph prompt for a full-body human in '
    "anatomical reference position (standing, facing forward, arms slightly away "
    "from the body, palms forward, neutral expression, even studio lighting, "
    "plain white background, full body in frame head-to-toe);\n"
    '  "proportions": {"shoulder_to_hip": float, "height_heads": float};\n'
    '  "biomech_notes": short list of the main movable joints to rig later.\n'
    "Return ONLY the JSON object."
)


def _parse_json_blob(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


def stage_agno_brief(sex: str, model_id: str, run_dir: Path) -> dict:
    """Use an Agno agent backed by local Ollama to author the image brief."""
    from agno.agent import Agent
    from agno.models.ollama import Ollama

    agent = Agent(
        model=Ollama(id=model_id, host=os.environ.get("OLLAMA_HOST",
                                                       "http://127.0.0.1:11434")),
        instructions=AGNO_INSTRUCTIONS,
        markdown=False,
    )
    _log("2/agno", f"asking {model_id} for a {sex} body brief...")
    resp = agent.run(f"Sex: {sex}. Produce the JSON brief.")
    raw = (resp.content or "").strip()
    (run_dir / "agno_raw.txt").write_text(raw)

    brief = _parse_json_blob(raw)
    if not brief or "image_prompt" not in brief:
        # Deterministic fallback so the chain never stalls on a chatty model.
        _log("2/agno", "model output wasn't clean JSON; using structured fallback")
        ratio = 1.4 if sex == "male" else 1.05
        brief = {
            "image_prompt": (
                f"A full-body {sex} human standing in anatomical reference "
                "position, facing forward, arms slightly away from the torso, "
                "palms forward, neutral expression, plain white background, even "
                "studio lighting, entire body visible head to toe, photorealistic."
            ),
            "proportions": {"shoulder_to_hip": ratio, "height_heads": 7.5},
            "biomech_notes": ["neck", "shoulders", "elbows", "wrists",
                              "hips", "knees", "ankles", "spine"],
            "_source": "fallback",
        }
    else:
        brief["_source"] = "agno"
    _write_json(run_dir / "brief.json", brief)
    (run_dir / "prompt.txt").write_text(brief["image_prompt"])
    _log("2/agno", f"brief ready (source={brief.get('_source')})")
    return brief


# ----------------------------------------------------------------------------- stage 3
def _placeholder_figure(sex: str, brief: dict, out_png: Path) -> None:
    """
    Synthesize a front-view robot PNG based on the description and sex.
    Colors are extracted from the text prompt so the figure loosely matches
    what Janus-Pro described. The output is a 768×768 PNG with a dark
    tech-style background, suitable for TripoSR.
    """
    from PIL import Image, ImageDraw
    import re

    W = H = 768
    img = Image.new("RGB", (W, H), (10, 10, 18))
    d = ImageDraw.Draw(img)

    prompt = brief.get("image_prompt", "")
    desc_lower = prompt.lower()

    # ── Parse colors from the description text ──────────────────────
    palette = {
        "silver":    (180, 186, 196),
        "gold":      (210, 175, 60),
        "black":     (30,  30,  38),
        "white":     (220, 225, 230),
        "red":       (200, 40,  50),
        "blue":      (50,  130, 220),
        "green":     (60,  180, 90),
        "copper":    (190, 120, 70),
        "bronze":    (160, 110, 50),
        "steel":     (150, 160, 175),
        "titanium":  (140, 150, 165),
        "gray":      (120, 120, 130),
        "grey":      (120, 120, 130),
        "chrome":    (175, 185, 200),
        "orange":    (220, 130, 40),
        "yellow":    (225, 200, 50),
        "purple":    (140, 70,  200),
    }
    found_colors = [(name, rgb) for name, rgb in palette.items() if name in desc_lower]
    main_color = found_colors[0][1] if found_colors else (160, 170, 185)
    accent_color = found_colors[1 % len(found_colors)][1] if len(found_colors) > 1 else (60, 160, 240)
    joint_color = (40, 45, 60)
    glint = (240, 248, 255)

    cx = W // 2

    # ── Proportions ─────────────────────────────────────────────────
    ratio  = float(brief.get("proportions", {}).get("shoulder_to_hip", 1.2))
    sh     = int(155 * (ratio if ratio > 1 else 1.0))           # shoulder width
    hip    = int(sh / max(ratio, 0.6))                           # hip width
    head_r = 50
    head_y = 105                                                 # head centre y
    neck_y = head_y + head_r + 10
    sh_y   = neck_y + 18                                         # shoulder y
    wa_y   = sh_y + 190                                          # waist y
    hi_y   = wa_y + 60                                           # hip y
    waist  = int(min(sh, hip) * (0.72 if sex == "female" else 0.88))

    # darken toward edges
    def _shade(base: tuple[int, int, int], amt: int) -> tuple[int, int, int]:
        return tuple(max(0, min(255, c - amt)) for c in base)

    # ── Helper: rounded rect ────────────────────────────────────────
    def _rrect(xy, r, fill, outline=None):
        x1, y1, x2, y2 = xy
        d.pieslice([x1, y1, x1 + 2*r, y1 + 2*r], 180, 270, fill=fill)
        d.pieslice([x2 - 2*r, y1, x2, y1 + 2*r], 270, 360, fill=fill)
        d.pieslice([x1, y2 - 2*r, x1 + 2*r, y2], 90, 180, fill=fill)
        d.pieslice([x2 - 2*r, y2 - 2*r, x2, y2], 0, 90, fill=fill)
        d.rectangle([x1 + r, y1, x2 - r, y2], fill=fill)
        d.rectangle([x1, y1 + r, x2, y2 - r], fill=fill)

    # ── Background grid lines (subtle) ──────────────────────────────
    grid_col = (25, 25, 40)
    for y in range(0, H, 48):
        d.line([(0, y), (W, y)], fill=grid_col, width=1)
    for x in range(0, W, 48):
        d.line([(x, 0), (x, H)], fill=grid_col, width=1)

    # ── Legs ─────────────────────────────────────────────────────────
    leg_w = 44
    foot_w = 52
    for sgn in (-1, 1):
        lx = cx + sgn * (hip // 2 - 4)
        # upper leg
        d.rectangle([lx - leg_w//2, hi_y, lx + leg_w//2, hi_y + 100], fill=_shade(main_color, 20))
        # knee joint
        d.ellipse([lx - 16, hi_y + 95, lx + 16, hi_y + 115], fill=joint_color)
        # lower leg
        d.rectangle([lx - leg_w//2 + 2, hi_y + 110, lx + leg_w//2 - 2, hi_y + 200], fill=_shade(main_color, 30))
        # ankle
        d.ellipse([lx - 14, hi_y + 195, lx + 14, hi_y + 210], fill=joint_color)
        # foot
        d.rounded_rectangle([lx - foot_w//2, hi_y + 205, lx + foot_w//2, hi_y + 230], radius=6, fill=_shade(main_color, 10))

    # ── Torso ────────────────────────────────────────────────────────
    torso_pts = [(cx - sh, sh_y), (cx + sh, sh_y),
                 (cx + waist, wa_y), (cx + hip, hi_y),
                 (cx - hip, hi_y), (cx - waist, wa_y)]
    d.polygon(torso_pts, fill=_shade(main_color, 10))
    # chest plate (lighter center)
    cp_w = int(sh * 0.55)
    cp_x1 = cx - cp_w
    cp_x2 = cx + cp_w
    cp_y1 = sh_y + 20
    cp_y2 = sh_y + 90
    _rrect([cp_x1, cp_y1, cp_x2, cp_y2], 10, fill=_shade(main_color, -20))
    # chest accent stripe
    d.rectangle([cx - 4, cp_y1 + 8, cx + 4, cp_y2 - 8], fill=accent_color)
    # waist line
    d.line([(cx - waist + 10, wa_y), (cx + waist - 10, wa_y)], fill=_shade(main_color, 40), width=3)

    # ── Arms ─────────────────────────────────────────────────────────
    arm_w = 28
    for sgn in (-1, 1):
        ax = cx + sgn * (sh - 10)
        # upper arm
        d.rectangle([ax - arm_w//2, sh_y + 12, ax + arm_w//2, sh_y + 80], fill=_shade(main_color, 15))
        # elbow joint
        d.ellipse([ax - 14, sh_y + 76, ax + 14, sh_y + 96], fill=joint_color)
        # forearm
        fwx = ax + sgn * 30
        d.rectangle([fwx - arm_w//2 + 4, sh_y + 90, fwx + arm_w//2 - 4, sh_y + 150], fill=_shade(main_color, 25))
        # hand (simple block)
        d.rounded_rectangle([fwx - 14, sh_y + 148, fwx + 14, sh_y + 170], radius=6, fill=_shade(main_color, 10))

    # ── Neck ─────────────────────────────────────────────────────────
    d.rectangle([cx - 16, head_y + head_r - 6, cx + 16, head_y + head_r + 22], fill=_shade(main_color, 20))

    # ── Head ─────────────────────────────────────────────────────────
    d.ellipse([cx - head_r, head_y - head_r, cx + head_r, head_y + head_r], fill=_shade(main_color, 5))
    # visor
    visor_w = 42
    visor_y = head_y + 4
    _rrect([cx - visor_w, visor_y - 6, cx + visor_w, visor_y + 10], 4, fill=accent_color)
    d.rectangle([cx - visor_w + 2, visor_y - 4, cx + visor_w - 2, visor_y + 8], fill=(180, 220, 255, 80))
    # visor glow line
    d.line([(cx - visor_w + 6, visor_y + 2), (cx + visor_w - 6, visor_y + 2)], fill=glint, width=1)
    # jaw line
    d.arc([cx - 30, head_y + 8, cx + 30, head_y + 40], 0, 180, fill=_shade(main_color, 30), width=2)
    # ear nodes
    for sgn in (-1, 1):
        d.ellipse([cx + sgn * (head_r + 4) - 6, head_y - 14, cx + sgn * (head_r + 4) + 6, head_y + 2], fill=accent_color)

    # ── Shoulder pauldrons ──────────────────────────────────────────
    for sgn in (-1, 1):
        ps_x = cx + sgn * (sh + 8)
        _rrect([ps_x - 16, sh_y - 4, ps_x + 16, sh_y + 20], 6, fill=_shade(main_color, -10))
        d.ellipse([ps_x - 6, sh_y + 2, ps_x + 6, sh_y + 14], fill=accent_color)

    # ── Hip armor / belt ────────────────────────────────────────────
    belt_w = int(hip * 0.8)
    d.rectangle([cx - belt_w//2, hi_y - 6, cx + belt_w//2, hi_y + 4], fill=_shade(main_color, 30))

    # ── Sex-specific details ────────────────────────────────────────
    if sex == "female":
        # narrower waist accent
        d.rectangle([cx - int(waist * 0.3), wa_y - 2, cx + int(waist * 0.3), wa_y + 2], fill=accent_color)
    else:
        # broader chest plate
        _rrect([cx - int(sh * 0.35), sh_y + 28, cx + int(sh * 0.35), sh_y + 50], 6, fill=_shade(main_color, -15))

    img.save(out_png)


def stage_make_image(sex: str, brief: dict, run_dir: Path) -> Path:
    out_png = run_dir / "body.png"
    prompt = brief["image_prompt"]

    # Backend resolution order: real diffusion -> hosted API -> placeholder.
    if _have_module("diffusers") and _have_module("torch"):
        _log("3/image", "using local diffusers (Stable Diffusion)")
        from diffusers import StableDiffusionPipeline  # type: ignore
        import torch  # type: ignore
        pipe = StableDiffusionPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        )
        pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
        pipe(prompt, height=768, width=768).images[0].save(out_png)
    elif os.environ.get("OPENAI_API_KEY"):
        _log("3/image", "using OpenAI image API")
        from openai import OpenAI  # type: ignore
        import base64
        client = OpenAI()
        r = client.images.generate(model="gpt-image-1", prompt=prompt,
                                    size="1024x1024")
        out_png.write_bytes(base64.b64decode(r.data[0].b64_json))
    else:
        _log("3/image", "no image model available -> synthesizing placeholder figure")
        _placeholder_figure(sex, brief, out_png)
    _log("3/image", f"wrote {out_png.name}")
    return out_png


# ----------------------------------------------------------------------------- stage 4
def stage_triposr(image_png: Path, run_dir: Path, manifest: Manifest) -> Path | None:
    """Run TripoSR (run.py) if torch is available; otherwise gate cleanly."""
    tsr_out = run_dir / "tsr"
    # Pick an interpreter that has torch.
    py = None
    for cand in (str(VENV_PY), sys.executable, "python3"):
        if _have_module("torch", cand):
            py = cand
            break
    if py is None:
        cmd = (f"{VENV_PY} -m pip install torch torchvision omegaconf einops "
               f"transformers trimesh rembg xatlas moderngl imageio "
               f"'git+https://github.com/tatsy/torchmcubes.git'")
        _log("4/triposr", "SKIPPED — torch not installed.")
        _log("4/triposr", "To enable, install TripoSR deps into the venv:")
        _log("4/triposr", "  " + cmd)
        manifest.set("4_triposr", "pending", reason="torch not installed",
                     enable_cmd=cmd)
        return None

    tsr_out.mkdir(exist_ok=True)
    cmd = [py, str(ROOT / "run.py"), str(image_png),
           "--output-dir", str(tsr_out),
           "--model-save-format", "obj", "--device", "cpu"]
    _log("4/triposr", "running: " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=str(ROOT))
    mesh = tsr_out / "0" / "mesh.obj"
    if r.returncode == 0 and mesh.exists():
        _log("4/triposr", f"mesh -> {mesh}")
        manifest.set("4_triposr", "ok", mesh=str(mesh))
        return mesh
    manifest.set("4_triposr", "error", returncode=r.returncode)
    return None


# ----------------------------------------------------------------------------- stage 5
def stage_zbio(mesh: Path | None, run_dir: Path, manifest: Manifest) -> None:
    """Load the mesh in Blender (Z-Biomechanics workshop) and render a preview."""
    blender = subprocess.run(["which", "blender"], capture_output=True, text=True)
    script = PIPELINE / "zbio_stage.py"
    preview = run_dir / "zbio_preview.png"
    if not blender.stdout.strip():
        _log("5/zbio", "SKIPPED — Blender not found on PATH.")
        manifest.set("5_zbio", "pending", reason="blender not installed")
        return
    if mesh is None or not mesh.exists():
        _log("5/zbio", "SKIPPED — no mesh from stage 4 yet (enable TripoSR first).")
        manifest.set("5_zbio", "pending", reason="no mesh input")
        return
    cmd = ["blender", "--background", "--python", str(script), "--",
           str(mesh), str(preview)]
    _log("5/zbio", "running: " + " ".join(cmd))
    r = subprocess.run(cmd)
    if r.returncode == 0 and preview.exists():
        _log("5/zbio", f"preview -> {preview}")
        manifest.set("5_zbio", "ok", preview=str(preview))
    else:
        manifest.set("5_zbio", "error", returncode=r.returncode)


# ----------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description="m/f -> Agno -> image -> TripoSR -> Z-Bio")
    ap.add_argument("--sex", help="m or f (omit for interactive prompt)")
    ap.add_argument("--model", default="qwen2.5-coder:latest",
                    help="Ollama model id for the Agno brief step")
    args = ap.parse_args()

    sex = stage_select_sex(args.sex)
    run_id = _dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{sex}"
    run_dir = OUT_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(run_dir)
    manifest.set("1_sex", "ok", sex=sex)
    _log("chain", f"run dir: {run_dir}")

    brief = stage_agno_brief(sex, args.model, run_dir)
    manifest.set("2_agno", "ok", source=brief.get("_source"))

    image = stage_make_image(sex, brief, run_dir)
    manifest.set("3_image", "ok", image=str(image),
                 backend=("placeholder" if not (_have_module("diffusers")
                          or os.environ.get("OPENAI_API_KEY")) else "model"))

    mesh = stage_triposr(image, run_dir, manifest)
    stage_zbio(mesh, run_dir, manifest)

    _log("chain", "done. summary:")
    print(json.dumps(manifest.data["stages"], indent=2))


if __name__ == "__main__":
    main()
