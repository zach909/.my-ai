"""
Bridge script - called by Node.js server to run the robot pipeline.

Usage:
    python bridge.py --sex female --hint "sleek silver" --out-dir /tmp/robot-out

Outputs JSON to stdout with paths to generated files.
"""
import argparse, json, sys, os, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PIPELINE = ROOT / "pipeline"
OUT_ROOT = PIPELINE / "out"
VENV_PY = ROOT / ".venv" / "bin" / "python"
BLENDER = ROOT / "Z-Anatomy"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sex", default="female", choices=["male", "female"])
    ap.add_argument("--hint", default="", help="Style hint")
    ap.add_argument("--description", default=None, help="Pre-generated description (skip Janus stage 1)")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--image-only", action="store_true", help="Only generate placeholder image (skip TripoSR/Z-Bio)")
    args = ap.parse_args()

    sex = args.sex
    run_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{sex}"
    run_dir = Path(args.out_dir) if args.out_dir else (OUT_ROOT / run_id)
    run_dir.mkdir(parents=True, exist_ok=True)

    result = {"run_dir": str(run_dir), "sex": sex, "stages": {}}

    # Redirect stdout -> stderr so chain.py logging doesn't corrupt JSON output
    _old_stdout = sys.stdout
    sys.stdout = sys.stderr

    # ── Stage 1: Janus description ──────────────────────────────
    from pipeline import janus
    if args.description:
        description = args.description
        result["stages"]["1_janus"] = {"status": "ok", "cached": True}
    else:
        print("[bridge] Janus-Pro describing robot...", file=sys.stderr)
        description = janus.describe(sex, args.hint)
        result["stages"]["1_janus"] = {"status": "ok"}
    (run_dir / "description.txt").write_text(description)
    result["description"] = description

    # ── Stage 2: Character bio (skip in image-only mode) ────────
    if args.image_only:
        character = {"name": "Unit", "model_designation": "ZB-7", "_source": "bridge"}
        result["stages"]["2_character"] = {"status": "ok", "skipped": True}
    else:
        print("[bridge] Janus-Pro writing character...", file=sys.stderr)
        character = janus.write_character(sex, description, args.hint)
        result["stages"]["2_character"] = {"status": "ok"}
    (run_dir / "bio.json").write_text(json.dumps(character, indent=2))
    result["character"] = character

    # ── Stage 3: Body image ─────────────────────────────────────
    print("[bridge] generating body image...", file=sys.stderr)
    from pipeline.chain import stage_make_image, stage_triposr
    from pipeline.chain import Manifest
    brief = {
        "image_prompt": description,
        "proportions": {"shoulder_to_hip": 1.4 if sex == "male" else 1.05, "height_heads": 7.5},
        "biomech_notes": ["neck", "shoulders", "elbows", "wrists",
                          "hips", "knees", "ankles", "spine"],
        "_source": "janus",
    }
    (run_dir / "brief.json").write_text(json.dumps(brief, indent=2))
    (run_dir / "prompt.txt").write_text(description)

    img = stage_make_image(sex, brief, run_dir)
    result["stages"]["3_image"] = {"status": "ok", "image": str(img)}
    result["image"] = str(img)

    # ── Stage 4: TripoSR 3D ────────────────────────────────────
    if args.image_only:
        print("[bridge] image-only mode, skipping TripoSR/Z-Bio", file=sys.stderr)
    else:
        print("[bridge] TripoSR 3D...", file=sys.stderr)
        manifest = Manifest(run_dir)
        mesh = stage_triposr(img, run_dir, manifest)
        if mesh:
            result["stages"]["4_triposr"] = {"status": "ok", "mesh": str(mesh)}
            result["mesh"] = str(mesh)
        else:
            result["stages"]["4_triposr"] = {"status": "pending", "reason": "torch not installed"}

    # ── Stage 5: Z-Bio / Z-Anatomy simulation ──────────────────
    if args.image_only:
        pass  # skip
    elif mesh and mesh.exists():
        print("[bridge] running Z-Bio simulation (Blender)...", file=sys.stderr)
        zbio_script = PIPELINE / "zbio_render.py"
        preview = run_dir / "zbio_preview.png"
        if zbio_script.exists():
            import subprocess
            cmd = ["blender", "--background", "--python", str(zbio_script), "--",
                   "mesh", str(mesh), str(preview)]
            try:
                subprocess.run(cmd, timeout=240, capture_output=True)
                if preview.exists():
                    result["stages"]["5_zbio"] = {"status": "ok", "preview": str(preview)}
                    result["preview"] = str(preview)
                else:
                    result["stages"]["5_zbio"] = {"status": "error", "reason": "render failed"}
            except Exception as e:
                result["stages"]["5_zbio"] = {"status": "error", "reason": str(e)}
    else:
        # Build a proxy from Blender for preview
        print("[bridge] building proxy in Blender...", file=sys.stderr)
        zbio_script = PIPELINE / "zbio_render.py"
        preview = run_dir / "zbio_preview.png"
        if zbio_script.exists():
            import subprocess
            cmd = ["blender", "--background", "--python", str(zbio_script), "--",
                   "proxy", str(run_dir / "brief.json"), str(preview)]
            try:
                subprocess.run(cmd, timeout=240, capture_output=True)
                if preview.exists():
                    result["stages"]["5_zbio"] = {"status": "proxy", "preview": str(preview)}
                    result["preview"] = str(preview)
            except Exception as e:
                result["stages"]["5_zbio"] = {"status": "error", "reason": str(e)}

    # Restore stdout and output clean JSON
    sys.stdout = _old_stdout
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")

if __name__ == "__main__":
    main()
