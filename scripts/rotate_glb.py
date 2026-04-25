"""
Apply a fixed root rotation to a mesh GLB and write it back. Used for source
GLBs whose axis convention differs from Mixamo's (e.g. Blender Z-up native
exports lying flat in Y-up runtime).

Args via env vars:
  MESH_GLB     path to GLB (modified in-place)
  ROT_X_DEG    rotation around world X axis (degrees)
  AUTO_GROUND  if "1", translate so lowest vert Y = 0 after rotation (puts feet on ground)
"""
import bpy
import math
import os
import sys


GLB = os.environ.get('MESH_GLB')
ROT_X = float(os.environ.get('ROT_X_DEG', '0'))
AUTO_GROUND = os.environ.get('AUTO_GROUND') == '1'

if not GLB:
    print('ERROR: set MESH_GLB')
    sys.exit(1)

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
bpy.ops.import_scene.gltf(filepath=GLB)
cube = bpy.data.objects.get('Cube')
if cube:
    bpy.data.objects.remove(cube, do_unlink=True)

# Rotate every root-level object by ROT_X around world X axis.
# Apply transform afterward so rotation bakes into geometry/armature.
roots = [o for o in bpy.data.objects if o.parent is None]
for o in roots:
    if o.type in {'EMPTY', 'MESH', 'ARMATURE'}:
        o.rotation_euler = (math.radians(ROT_X), 0, 0)

# Select all and apply rotation.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = bpy.data.objects[0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

# Auto-ground: find lowest vert Y in world, translate roots so it sits at Y=0.
# In Blender Z-up world, "ground" is min Z of all mesh verts.
if AUTO_GROUND:
    min_z = float('inf')
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            wz = (mw @ v.co).z
            if wz < min_z:
                min_z = wz
    if min_z != float('inf'):
        print(f'auto-ground: lifting by {-min_z:.4f} (lowest vert at Z={min_z:.4f})')
        for o in bpy.data.objects:
            if o.parent is None:
                o.location.z -= min_z
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# Re-export.
arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
mesh = next((o for o in bpy.data.objects if o.type == 'MESH' and o.parent), None)

bpy.ops.object.select_all(action='DESELECT')
if arm:
    arm.select_set(True)
if mesh:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = arm or mesh

bpy.ops.export_scene.gltf(
    filepath=GLB,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_apply=False,
    export_yup=True,
    export_skins=True,
    export_morph=False,
    export_materials='EXPORT',
)
print(f'rotated {ROT_X}° X and wrote {GLB} ({os.path.getsize(GLB):,} bytes)')
