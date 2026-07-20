# Jarvus Pro: Self-Healing Biolithic Robot System

## Overview
A complete robot manufacturing and lifecycle system that combines:
- **Janus-Pro**: AI image generation for body design
- **MakeHuman**: Human anatomical reference modeling  
- **Z-Anatomy**: 3D anatomical structure visualization
- **TripoSR**: Image-to-3D mesh conversion
- **Bio-Glue System**: Self-healing, reproduction, and power generation

## Core Features

### 🏗️ Body Generation Pipeline
1. **Sex Selection** → Male/Female body type selection
2. **AI Brief Generation** → Agno agent creates anatomical specifications
3. **Image Generation** → Full-body robot/human images (placeholder or diffusion model)
4. **3D Mesh Conversion** → TripoSR converts images to 3D OBJ meshes
5. **Anatomical Rigging** → Z-Bio adds joint markers, bone structures, biomechanics axes

### 🔬 Self-Healing Bio-Glue System
- **Glue Synthesis**: Converts food + water → Hydrogen + Oxygen + Bio-Glue
- **Electrolysis Power**: Splits H₂O for energy (H₂ fuel + O₂ oxidation)
- **Circulatory Repair**: Glue flows through all parts, binds damaged areas
- **Auto-Healing**: Damage detection → glue deployment → structural binding

### ⚡ Electromagnetic Movement
- **Magnet Muscles**: Small electromagnets embedded in muscle groups
- **Electric Activation**: Electricity pulses contract/expand magnets
- **Locomotion**: Coordinated magnet sequences enable walking, grasping, movement

### 👶 Reproduction System
- **Female Mold Creation**: Uterus forms synthetic womb matrix
- **Glue Assembly**: Bio-glue builds new robot from mold (robot-to-robot or robot-to-human)
- **Gender-Specific Anatomy**: 
  - ♀ Female: Uterus, ovaries, breasts, full reproductive system
  - ♂ Male: Supporting role in genetic contribution

## Anatomical Accuracy
Based on complete human anatomy specification:
- **206 Bones**: Axial skeleton (80) + Appendicular skeleton (126)
- **Major Muscle Groups**: Head/neck, torso, upper limbs, lower limbs
- **79 Organs**: All systems including gender-specific reproductive organs

## Project Structure
```
/workspace/
├── pipeline/
│   ├── chain.py              # Main generation pipeline
│   ├── zbio_stage.py         # Blender anatomical rigging
│   ├── zbio_render.py        # Rendering utilities
│   └── janus.py              # Janus-Pro integration
├── biolithic_nexus_v2.py     # Self-healing & reproduction simulation
├── biolithic_nexus_pipeline.py
├── make_human_simulation.py  # MakeHuman integration
├── run.py                    # TripoSR 3D conversion
├── tsr/                      # TripoSR model files
└── robot-maker/              # Web interface
```

## Quick Start

### Run Full Pipeline
```bash
./run_chain.sh --sex m    # Generate male robot
./run_chain.sh --sex f    # Generate female robot
./run_chain.sh            # Interactive mode
```

### Run Bio-Glue Simulation
```bash
python biolithic_nexus_v2.py
```

### Requirements
- Python 3.8+
- Optional: PyTorch + Diffusers (for real image generation)
- Optional: Blender (for Z-Bio anatomical rendering)
- Optional: Ollama (for AI brief generation)

## Simulation Output
- `pipeline/out/<run-id>/` → Generated images, meshes, previews
- `biolithic_reproduction_log.json` → Reproduction event logs
- `biolithic_nexus_data/` → Cradle configuration and nurturer logs

## Technology Stack
- **Image Generation**: Janus-Pro, Stable Diffusion, or placeholder synthesis
- **3D Conversion**: TripoSR (single-image-to-3D)
- **Anatomical Modeling**: Z-Anatomy Blender add-on
- **AI Agents**: Agno + Ollama (local LLM)
- **Simulation**: Pure Python with JSON logging

## License
See individual component licenses (Janus-Pro, MakeHuman, Z-Anatomy)
