"""
Z-Bio stage — runs INSIDE Blender:

    blender --background --python zbio_stage.py -- <mesh.obj> <preview.png>

Imports the TripoSR mesh, adds anatomical reference markers (joints, bones,
biomechanics axes), and renders a simulation preview.
"""
import math
import sys
import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
mesh_path, preview_path = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)

# import mesh
if mesh_path.lower().endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=mesh_path)
else:
    bpy.ops.import_scene.gltf(filepath=mesh_path)

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    print("[zbio] no mesh imported", file=sys.stderr)
    sys.exit(1)

# bounding box
mins = mathutils.Vector((1e9, 1e9, 1e9))
maxs = mathutils.Vector((-1e9, -1e9, -1e9))
for o in objs:
    for corner in o.bound_box:
        wc = o.matrix_world @ mathutils.Vector(corner)
        mins = mathutils.Vector((min(mins[i], wc[i]) for i in range(3)))
        maxs = mathutils.Vector((max(maxs[i], wc[i]) for i in range(3)))
center = (mins + maxs) / 2.0
size = max((maxs - mins)) or 1.0

# ── Materials ────────────────────────────────────────────────────
def _mat(name, rgba, metallic=0.8, roughness=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m

# ── Anatomical reference markers ─────────────────────────────────
JOINTS = [
    ("head_top", (0, 0, 2.5), 0.06), ("neck", (0, 0, 2.1), 0.06),
    ("shoulder_L", (-0.45, 0, 1.9), 0.07), ("shoulder_R", (0.45, 0, 1.9), 0.07),
    ("elbow_L", (-0.55, 0, 1.3), 0.06), ("elbow_R", (0.55, 0, 1.3), 0.06),
    ("wrist_L", (-0.55, 0.05, 0.7), 0.05), ("wrist_R", (0.55, 0.05, 0.7), 0.05),
    ("hip_L", (-0.25, 0, 0.85), 0.07), ("hip_R", (0.25, 0, 0.85), 0.07),
    ("knee_L", (-0.25, 0, 0.4), 0.06), ("knee_R", (0.25, 0, 0.4), 0.06),
    ("ankle_L", (-0.25, 0, -0.1), 0.05), ("ankle_R", (0.25, 0, -0.1), 0.05),
]
BONES = [
    ("head_top", "neck"), ("neck", "shoulder_L"), ("neck", "shoulder_R"),
    ("neck", "hip_L"), ("neck", "hip_R"),
    ("shoulder_L", "elbow_L"), ("shoulder_R", "elbow_R"),
    ("elbow_L", "wrist_L"), ("elbow_R", "wrist_R"),
    ("hip_L", "knee_L"), ("hip_R", "knee_R"),
    ("knee_L", "ankle_L"), ("knee_R", "ankle_R"),
]

joint_mat = _mat("joint", (0.9, 0.2, 0.15, 1), metallic=0.3, roughness=0.4)
bone_mat = _mat("bone", (0.9, 0.7, 0.2, 1), metallic=0.0, roughness=0.6)

ref_scale = size / 2.5
positions = {}
for name, loc, r in JOINTS:
    pos = (center.x + loc[0] * ref_scale, center.y + loc[1] * ref_scale, center.z + loc[2] * ref_scale)
    positions[name] = pos
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r * ref_scale, location=pos)
    o = bpy.context.active_object
    o.name = f"joint_{name}"
    o.data.materials.append(joint_mat)
    bpy.ops.object.shade_smooth()

for start, end in BONES:
    if start not in positions or end not in positions:
        continue
    s, e = mathutils.Vector(positions[start]), mathutils.Vector(positions[end])
    vec, mid, dist = e - s, (s + e) / 2.0, (e - s).length
    if dist < 0.01:
        continue
    bpy.ops.mesh.primitive_cylinder_add(radius=0.015 * ref_scale, depth=dist, location=mid)
    o = bpy.context.active_object
    o.name = f"bone_{start}_{end}"
    o.rotation_euler = vec.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(bone_mat)

# ── Ground + grid ────────────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=size * 4, location=(center.x, center.y, center.z - size * 0.6))
g = bpy.context.active_object
g.name = "ground"
g.data.materials.append(_mat("ground", (0.06, 0.07, 0.09, 1), metallic=0.0, roughness=0.9))

bpy.ops.mesh.primitive_grid_add(x_subdivisions=20, y_subdivisions=20, size=size * 3,
                                location=(center.x, center.y, center.z - size * 0.58))
grid = bpy.context.active_object
grid.name = "sim_grid"
grid.data.materials.append(_mat("grid", (0.15, 0.18, 0.25, 1), metallic=0.0, roughness=0.5))

# ── Material for imported mesh ───────────────────────────────────
mesh_mat = _mat("body", (0.45, 0.5, 0.6, 1), metallic=0.6, roughness=0.25)
for o in objs:
    if o.type == "MESH" and not any(x in o.name for x in ("joint_", "bone_", "ground", "sim_grid")):
        if not o.data.materials:
            o.data.materials.append(mesh_mat)

# ── Lighting ────────────────────────────────────────────────────
for o in bpy.context.scene.objects:
    if o.type == "LIGHT":
        bpy.data.objects.remove(o, do_unlink=True)

for name, energy, rot in [("Key", 5.0, (0.7, 0.3, 0.4)),
                           ("Fill", 1.5, (-0.3, 0.1, -0.8)),
                           ("Rim", 1.0, (0.2, -0.5, 2.5))]:
    d = bpy.data.lights.new(name, type="SUN")
    d.energy = energy
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot

# ── Camera ──────────────────────────────────────────────────────
cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = center + mathutils.Vector((0, -size * 2.2, size * 0.15))
direction = center - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam

# ── Render ──────────────────────────────────────────────────────
scene = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
try:
    scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.04, 1)
except Exception:
    pass
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.filepath = preview_path
scene.render.image_settings.file_format = "PNG"

bpy.ops.render.render(write_still=True)
print(f"[zbio] rendered preview -> {preview_path}")
