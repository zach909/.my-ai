"""
Z-Bio render stage — runs INSIDE Blender:

    blender --background --python zbio_render.py -- mesh   <mesh.obj>   <out.png>
    blender --background --python zbio_render.py -- proxy  <brief.json> <out.png>

`mesh`  : import a TripoSR mesh, add anatomical reference overlays, and render.
`proxy` : no 3D mesh yet, so build a quick humanoid from primitives sized by the
          brief's proportions. This is the "small simulation" the robot is
          dropped into so you always get a visible preview, even before TripoSR
          is enabled. Drop-in: once TripoSR emits a real mesh, the app calls the
          `mesh` mode instead with no other changes.
"""
import json
import math
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
mode, src, out_png = argv[0], argv[1], argv[2]

bpy.ops.wm.read_factory_settings(use_empty=True)


def _mat(name, rgba, metallic=0.8, roughness=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m


def build_proxy(brief_path):
    """A blocky humanoid robot from primitives, sized from the brief."""
    try:
        brief = json.loads(open(brief_path).read())
    except Exception:
        brief = {}
    prop = brief.get("proportions", {})
    ratio = float(prop.get("shoulder_to_hip", 1.2))
    sw = 0.55 * (ratio if ratio > 1 else 1.0)   # shoulder half-width
    hw = sw / max(ratio, 0.6)                    # hip half-width

    body_mat = _mat("chassis", (0.55, 0.58, 0.62, 1))
    joint_mat = _mat("joint", (0.15, 0.16, 0.18, 1))

    def cube(name, loc, scale, mat):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.active_object
        o.name = name
        o.scale = scale
        o.data.materials.append(mat)
        bpy.ops.object.shade_smooth()
        return o

    def ball(name, loc, r, mat):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc)
        o = bpy.context.active_object
        o.name = name
        o.data.materials.append(mat)
        bpy.ops.object.shade_smooth()
        return o

    # pelvis -> torso -> head along +Z
    cube("pelvis", (0, 0, 1.0), (hw * 2, 0.35, 0.4), body_mat)
    cube("torso", (0, 0, 1.7), (sw * 2, 0.4, 0.9), body_mat)
    ball("neck", (0, 0, 2.25), 0.12, joint_mat)
    ball("head", (0, 0, 2.55), 0.28, body_mat)

    # arms (slightly away from body, palms forward)
    for sx in (-1, 1):
        ball(f"shoulder{sx}", (sx * sw, 0, 2.0), 0.16, joint_mat)
        cube(f"uarm{sx}", (sx * (sw + 0.25), 0, 1.6), (0.18, 0.18, 0.7), body_mat)
        ball(f"elbow{sx}", (sx * (sw + 0.25), 0, 1.2), 0.12, joint_mat)
        cube(f"larm{sx}", (sx * (sw + 0.25), 0.05, 0.85), (0.16, 0.16, 0.6), body_mat)

    # legs
    for sx in (-1, 1):
        ball(f"hip{sx}", (sx * hw * 0.6, 0, 0.85), 0.16, joint_mat)
        cube(f"thigh{sx}", (sx * hw * 0.6, 0, 0.45), (0.22, 0.22, 0.8), body_mat)
        ball(f"knee{sx}", (sx * hw * 0.6, 0, 0.05), 0.12, joint_mat)
        cube(f"shin{sx}", (sx * hw * 0.6, 0, -0.4), (0.2, 0.2, 0.8), body_mat)
        cube(f"foot{sx}", (sx * hw * 0.6, -0.15, -0.85), (0.22, 0.5, 0.15), body_mat)

    # ground plane for the "simulation"
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.92))
    g = bpy.context.active_object
    g.data.materials.append(_mat("ground", (0.08, 0.09, 0.1, 1)))


def import_mesh(mesh_path):
    if mesh_path.lower().endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=mesh_path)
    else:
        bpy.ops.import_scene.gltf(filepath=mesh_path)


# ── Anatomical simulation stage ──────────────────────────────────
ANATOMY_JOINTS = [
    ("head_top", (0, 0, 2.5), 0.06),
    ("neck", (0, 0, 2.1), 0.06),
    ("shoulder_L", (-0.45, 0, 1.9), 0.07),
    ("shoulder_R", (0.45, 0, 1.9), 0.07),
    ("elbow_L", (-0.55, 0, 1.3), 0.06),
    ("elbow_R", (0.55, 0, 1.3), 0.06),
    ("wrist_L", (-0.55, 0.05, 0.7), 0.05),
    ("wrist_R", (0.55, 0.05, 0.7), 0.05),
    ("hip_L", (-0.25, 0, 0.85), 0.07),
    ("hip_R", (0.25, 0, 0.85), 0.07),
    ("knee_L", (-0.25, 0, 0.4), 0.06),
    ("knee_R", (0.25, 0, 0.4), 0.06),
    ("ankle_L", (-0.25, 0, -0.1), 0.05),
    ("ankle_R", (0.25, 0, -0.1), 0.05),
]

ANATOMY_BONES = [
    ("head_top", "neck"),
    ("neck", "shoulder_L"), ("neck", "shoulder_R"),
    ("neck", "hip_L"), ("neck", "hip_R"),
    ("shoulder_L", "elbow_L"), ("shoulder_R", "elbow_R"),
    ("elbow_L", "wrist_L"), ("elbow_R", "wrist_R"),
    ("hip_L", "knee_L"), ("hip_R", "knee_R"),
    ("knee_L", "ankle_L"), ("knee_R", "ankle_R"),
]

JOINT_MAT = _mat("joint_marker", (0.9, 0.2, 0.15, 1), metallic=0.3, roughness=0.4)
BONE_MAT = _mat("bone_line", (0.9, 0.7, 0.2, 1), metallic=0.0, roughness=0.6)
AXIS_MAT = _mat("axis_marker", (0.0, 0.8, 1.0, 1), metallic=0.5, roughness=0.2)


def add_joint_marker(name, loc, radius):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc)
    o = bpy.context.active_object
    o.name = f"joint_{name}"
    o.data.materials.append(JOINT_MAT)
    bpy.ops.object.shade_smooth()
    return o


def add_bone_line(start, end):
    vec = mathutils.Vector(end) - mathutils.Vector(start)
    mid = (mathutils.Vector(start) + mathutils.Vector(end)) / 2.0
    dist = vec.length
    if dist < 0.01:
        return
    bpy.ops.mesh.primitive_cylinder_add(radius=0.015, depth=dist, location=mid)
    o = bpy.context.active_object
    o.name = f"bone_{start}_{end}"
    o.rotation_euler = vec.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(BONE_MAT)
    return o


def add_biomech_axis(loc, label, direction, length=0.4):
    """Add a coordinate axis arrow at the given location."""
    colors = {"X": (1, 0.2, 0.2, 1), "Y": (0.2, 1, 0.2, 1), "Z": (0.2, 0.3, 1, 1)}
    color = colors.get(direction, (1, 1, 1, 1))
    mat = _mat(f"axis_{label}", color, metallic=0.3, roughness=0.3)

    # Cylinder for shaft
    bpy.ops.mesh.primitive_cylinder_add(radius=0.02, depth=length * 0.7, location=loc)
    shaft = bpy.context.active_object
    shaft.name = f"axis_{label}"
    if direction == "X":
        shaft.rotation_euler = (0, 0, math.pi / 2)
    elif direction == "Z":
        shaft.rotation_euler = (math.pi / 2, 0, 0)
    shaft.data.materials.append(mat)

    # Cone for tip
    tip_loc = list(loc)
    if direction == "X":
        tip_loc[0] += length * 0.5
    elif direction == "Y":
        tip_loc[1] += length * 0.5
    else:
        tip_loc[2] += length * 0.5
    bpy.ops.mesh.primitive_cone_add(radius1=0.03, radius2=0.0, depth=length * 0.3, location=tip_loc)
    tip = bpy.context.active_object
    tip.name = f"axis_{label}_tip"
    if direction == "X":
        tip.rotation_euler = (0, 0, -math.pi / 2)
    elif direction == "Z":
        tip.rotation_euler = (math.pi / 2, 0, 0)
    tip.data.materials.append(mat)


def build_simulation(center, size):
    """Add simulation environment: ground, grid, biomech axes."""
    # Ground plane
    bpy.ops.mesh.primitive_plane_add(size=size * 4, location=(center.x, center.y, center.z - size * 0.6))
    g = bpy.context.active_object
    g.name = "ground"
    g.data.materials.append(_mat("ground", (0.06, 0.07, 0.09, 1), metallic=0.0, roughness=0.9))

    # Grid overlay
    bpy.ops.mesh.primitive_grid_add(
        x_subdivisions=20, y_subdivisions=20,
        size=size * 3, location=(center.x, center.y, center.z - size * 0.58)
    )
    grid = bpy.context.active_object
    grid.name = "sim_grid"
    grid.data.materials.append(_mat("grid", (0.15, 0.18, 0.25, 1), metallic=0.0, roughness=0.5))

    # Biomechanics axis indicator at center base
    base_loc = (center.x, center.y, center.z - size * 0.5)
    add_biomech_axis(base_loc, "X", "X")
    add_biomech_axis(base_loc, "Y", "Y")
    add_biomech_axis(base_loc, "Z", "Z")


# ── Execute stage ────────────────────────────────────────────────
if mode == "mesh":
    import_mesh(src)
else:
    build_proxy(src)

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    print("[zbio] nothing to render", file=sys.stderr)
    sys.exit(1)

# Compute bounding box
mins = mathutils.Vector((1e9, 1e9, 1e9))
maxs = mathutils.Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        wc = o.matrix_world @ mathutils.Vector(c)
        mins = mathutils.Vector((min(mins[i], wc[i]) for i in range(3)))
        maxs = mathutils.Vector((max(maxs[i], wc[i]) for i in range(3)))
center = (mins + maxs) / 2.0
size = max((maxs - mins)) or 1.0

# Add anatomical reference markers
ref_scale = size / 2.5
for name, loc, r in ANATOMY_JOINTS:
    scaled_loc = (center.x + loc[0] * ref_scale, center.y + loc[1] * ref_scale, center.z + loc[2] * ref_scale)
    add_joint_marker(name, scaled_loc, r * ref_scale)

joint_positions = {name: (center.x + loc[0] * ref_scale, center.y + loc[1] * ref_scale, center.z + loc[2] * ref_scale)
                   for name, loc, r in ANATOMY_JOINTS}
for start, end in ANATOMY_BONES:
    if start in joint_positions and end in joint_positions:
        add_bone_line(joint_positions[start], joint_positions[end])

# Build simulation environment
build_simulation(center, size)

# Apply material to imported mesh
if mode == "mesh":
    mesh_mat = _mat("robot_body", (0.45, 0.5, 0.6, 1), metallic=0.6, roughness=0.25)
    for o in objs:
        if o.name.startswith("joint_") or o.name.startswith("bone_") or o.name in ("ground", "sim_grid"):
            continue
        if o.type == "MESH" and not o.data.materials:
            o.data.materials.append(mesh_mat)

# ── Lighting ────────────────────────────────────────────────────
# Remove default lights
for o in bpy.context.scene.objects:
    if o.type == "LIGHT":
        bpy.data.objects.remove(o, do_unlink=True)

key = bpy.data.lights.new("Key", type="SUN")
key.energy = 5.0
ko = bpy.data.objects.new("Key", key)
bpy.context.collection.objects.link(ko)
ko.rotation_euler = (0.7, 0.3, 0.4)

fill = bpy.data.lights.new("Fill", type="SUN")
fill.energy = 1.5
fo = bpy.data.objects.new("Fill", fill)
bpy.context.collection.objects.link(fo)
fo.rotation_euler = (-0.3, 0.1, -0.8)

rim = bpy.data.lights.new("Rim", type="SUN")
rim.energy = 1.0
ro = bpy.data.objects.new("Rim", rim)
bpy.context.collection.objects.link(ro)
ro.rotation_euler = (0.2, -0.5, 2.5)

# ── Camera ──────────────────────────────────────────────────────
cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = center + mathutils.Vector((size * 1.4, -size * 1.9, size * 0.4))
direction = center - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam

# ── Render ──────────────────────────────────────────────────────
scene = bpy.context.scene
engines = [e.identifier for e in
           bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines \
    else ("BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0])
try:
    scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.04, 1)
except Exception:
    pass
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.filepath = out_png
scene.render.image_settings.file_format = "PNG"

bpy.ops.render.render(write_still=True)
print(f"[zbio] rendered -> {out_png}")
