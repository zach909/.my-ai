# JARVUS PRO: Complete Robot Generation Pipeline

## Overview

This pipeline creates synthetic humans through a complete workflow:

1. **Gender Selection** → Selects the correct Z-Bio anatomy template (male/female)
2. **Jarvus AI (Janus)** → Generates vivid description of the robot's appearance
3. **MakeHuman (TripoSR)** → Converts the image to a 3D mesh
4. **Z-Anatomy** → Maps 206 bones + 79 organs, distorting to fit the 3D shell
5. **Simulation Preview** → Creates a small Blender visualization
6. **STL Export** → Bundles all anatomical STL files for download

## Quick Start

```bash
# Run with gender selection (interactive)
./run_pipeline.sh

# Run with specific gender
./run_pipeline.sh --sex m    # Male robot
./run_pipeline.sh --sex f    # Female robot

# Add style direction for Jarvus AI
./run_pipeline.sh --sex f --hint "cyberpunk warrior"
```

## What Gets Generated

### Output Files

After running the pipeline, you get:

1. **Body Image** (`body.png`) - Visual representation of the robot
2. **3D Mesh** (`mesh.obj`) - TripoSR-generated 3D model (requires torch)
3. **STL Files** (5 files):
   - `skeleton_{gender}.stl` - 206 bones with distortion parameters
   - `organs_{gender}.stl` - 79 organs including gender-specific reproductive system
   - `muscles_{gender}.stl` - Muscle groups with magnetic anchor points
   - `glue_channels_{gender}.stl` - Self-healing glue distribution network
   - `assembly_{gender}.stl` - Complete combined assembly
4. **Simulation Preview** (`simulation_preview.png`) - Blender render (requires Blender)
5. **Download Bundle** (`robot_bundle_*.zip`) - All files bundled together

### Anatomy Templates

#### Male Template
- **Skeleton**: 206 bones with male pelvis proportions (narrower hips)
- **Reproductive Organs**: Testes, Epididymis, Vas Deferens, Seminal Vesicles, Prostate, Bulbourethral Glands, Penis, Scrotum
- **Shoulder-to-Hip Ratio**: ~1.4 (broader shoulders)

#### Female Template  
- **Skeleton**: 206 bones with female pelvis proportions (wider hips for childbirth)
- **Reproductive Organs**: Ovaries, Fallopian Tubes, Uterus, Cervix, Vagina, Vulva, Labia, Clitoris, Bartholin's Glands, Mammary Glands
- **Shoulder-to-Hip Ratio**: ~1.05 (more proportional)

## Z-Anatomy Distortion System

The pipeline includes an intelligent distortion system that:

1. **Analyzes the 3D mesh** to extract bounding box and proportions
2. **Computes a distortion matrix** with scaling factors for:
   - Global scale
   - Shoulder width
   - Hip width  
   - Height
   - Limb length
   - Torso length
   - Head size
3. **Applies gender-specific adjustments** based on biological differences
4. **Generates STL metadata** documenting all distortion parameters

### Example Distortion Matrix (Male)
```json
{
  "global_scale": 1.0,
  "shoulder_width": 1.0,
  "hip_width": 0.714,
  "height": 1.0,
  "limb_length": 0.95,
  "torso_length": 1.05,
  "head_size": 0.15
}
```

## Requirements

### Core (Always Used)
- Python 3.8+
- Pillow (for placeholder images)

### Optional Enhancements

**For AI-generated descriptions:**
```bash
pip install ollama
# Then run: ollama pull gguf/DeepSeek-Janus-Pro-7B
```

**For Stable Diffusion images:**
```bash
pip install diffusers torch torchvision
```

**For 3D mesh generation:**
```bash
pip install torch torchvision omegaconf einops transformers trimesh rembg xatlas moderngl imageio
# Plus: git+https://github.com/tatsy/torchmcubes.git
```

**For simulation preview:**
- Install Blender from https://www.blender.org

## File Structure

```
/workspace/
├── run_pipeline.sh              # Main runner script
├── pipeline/
│   └── jarvus_pro_pipeline.py   # Complete pipeline implementation
├── pipeline/out/                # Generated runs
│   ├── YYYYMMDD-HHMMSS-gender/  # Individual run folders
│   │   ├── body.png
│   │   ├── brief.json
│   │   ├── jarvus_description.txt
│   │   └── tsr/                 # TripoSR output (if enabled)
│   └── robot_bundle_*.zip       # Download bundles
└── print_jobs/                  # STL export folders
    ├── male_YYYYMMDD_HHMMSS/
    │   ├── skeleton_male.stl
    │   ├── organs_male.stl
    │   ├── muscles_male.stl
    │   ├── glue_channels_male.stl
    │   ├── assembly_male.stl
    │   └── anatomy_metadata.json
    └── female_YYYYMMDD_HHMMSS/
        └── ... (same files for female)
```

## Medical Accuracy (Z-Anatomy Integration)

The pipeline uses medical-grade anatomical data mirroring Z-Anatomy:

### Skeletal System (206 Bones)
- **Axial Skeleton** (80 bones): Skull, Ear ossicles, Hyoid, Spine, Chest
- **Appendicular Skeleton** (126 bones): Shoulders, Arms, Hips, Legs

### Organ Systems (79 Organs)
- **Nervous**: Brain, Spinal Cord, Eyes, Ears, Nose, Tongue
- **Cardiovascular**: Heart, Arteries, Veins, Lungs, Trachea, Bronchi
- **Digestive**: Mouth, Salivary Glands, Esophagus, Stomach, Intestines, Liver, Gallbladder, Pancreas
- **Urinary**: Kidneys, Ureters, Bladder, Urethra
- **Reproductive**: Gender-specific systems (see above)

### Muscular System
- **Head**: Temporalis, Masseter, Orbicularis Oculi/Oris, Sternocleidomastoid
- **Torso**: Pectoralis Major, Latissimus Dorsi, Trapezius, Erector Spinae, Rectus Abdominis, Obliques
- **Arms**: Deltoids, Rotator Cuff, Biceps/Triceps Brachii, Forearm Flexors
- **Legs**: Gluteus Maximus, Hip Flexors, Quadriceps, Hamstrings, Gastrocnemius, Soleus, Tibialis Anterior

## 3D Printing Workflow

The generated STL files are ready for multi-material 3D printing:

1. **Skeleton** → Carbon-fiber reinforced polymer (rigid)
2. **Organs** → Bio-compatible silicone gel (soft)
3. **Muscles** → Conductive TPU with embedded neodymium magnets
4. **Glue Channels** → Self-healing epoxy resin micro-lattice

### Assembly Instructions
1. Print skeleton in carbon-fiber reinforced polymer
2. Embed magnets in muscle prints during fabrication
3. Install organs in their designated cavities
4. Inject self-healing glue into channel network
5. Assemble using magnetic alignment system

## Troubleshooting

### "torch not installed"
Install PyTorch for 3D mesh generation:
```bash
pip install torch torchvision
```

### "Blender not found"
Install Blender for simulation previews:
```bash
sudo apt install blender  # Linux
# or download from https://www.blender.org
```

### "ollama not available"
The pipeline will use fallback descriptions. For AI-generated content:
```bash
# Install ollama, then:
ollama pull gguf/DeepSeek-Janus-Pro-7B
```

## API Usage

You can also import the pipeline programmatically:

```python
from pipeline.jarvus_pro_pipeline import run_full_pipeline

result = run_full_pipeline(arg_sex="f", hint="steampunk aesthetic")

print(f"Generated files: {result['stl_files']}")
print(f"Download bundle: {result['zip_bundle']}")
```

## License

Part of the JARVUS PRO synthetic human generation system.
