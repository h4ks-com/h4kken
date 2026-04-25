"""
Inject extra bones (e.g. secondary/jiggle bones) into an existing mesh GLB.
Bones can optionally claim skin weights from nearby verts (spherical falloff)
so they actually deform the mesh — required for jiggle to be visible.

Args via env vars:
  MESH_GLB   path to the mesh GLB to modify (written back in-place)
  BONES_JSON JSON array of bone descriptors:
             [{
               "name": str,
               "parent": str,
               "head": [x,y,z],
               "tail": [x,y,z],
               "weightRadius": float (optional, metres) — verts within this
                 radius of the bone HEAD get weight (smoothstep falloff).
                 All other bone weights on those verts scale by (1-w) so the
                 jiggle bone dominates at center (partition of unity).
             }, ...]
"""
import bpy
import json
import math
import os
import sys


MESH_GLB = os.environ.get('MESH_GLB')
BONES_JSON = os.environ.get('BONES_JSON')

if not MESH_GLB or not BONES_JSON:
    print('ERROR: set MESH_GLB and BONES_JSON env vars')
    sys.exit(1)

bones_to_add = json.loads(BONES_JSON)

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
bpy.ops.import_scene.gltf(filepath=MESH_GLB)
cube = bpy.data.objects.get('Cube')
if cube:
    bpy.data.objects.remove(cube, do_unlink=True)

# Strip GLB re-import artifacts: unparented meshes (Icosphere from prior runs),
# stray EMPTY nodes that Blender creates during gltf import.
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.parent is None:
        print(f'  cleaning unparented mesh: {o.name}')
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == 'EMPTY':
        print(f'  cleaning EMPTY node: {o.name}')
        bpy.data.objects.remove(o, do_unlink=True)

armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
mesh_obj = next((o for o in bpy.data.objects if o.type == 'MESH' and o.parent is not None), None)

if not armature or not mesh_obj:
    print('ERROR: could not find armature or skinned mesh')
    sys.exit(1)

# 1. Add bones in EDIT mode.
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode='EDIT')

added = []
for spec in bones_to_add:
    name = spec['name']
    parent_name = spec['parent']
    head = spec['head']
    tail = spec['tail']

    if armature.data.edit_bones.get(name):
        print(f'  bone already exists, skipping: {name}')
        continue

    parent_eb = armature.data.edit_bones.get(parent_name)
    if not parent_eb:
        print(f'  WARNING: parent bone not found: {parent_name} (skipping {name})')
        continue

    eb = armature.data.edit_bones.new(name)
    eb.head = head
    eb.tail = tail
    eb.parent = parent_eb
    eb.use_deform = True
    print(f'  added bone: {name} (parent={parent_name})')
    added.append(spec)

bpy.ops.object.mode_set(mode='OBJECT')


# 2. Paint weights for bones with weightRadius set.
def smoothstep(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def paint_bone_weights(spec):
    name = spec['name']
    radius = spec.get('weightRadius')
    if radius is None or radius <= 0:
        return
    head = spec['head']
    # Inner plateau where weight is exactly 1.0 (no contest). Between inner and
    # outer, smoothstep falloff. Beyond outer, 0.
    plateau = spec.get('weightPlateau', radius * 0.4)

    vg = mesh_obj.vertex_groups.get(name) or mesh_obj.vertex_groups.new(name=name)
    vg_index = vg.index

    painted = 0
    plateau_count = 0
    for v in mesh_obj.data.vertices:
        dx = v.co.x - head[0]
        dy = v.co.y - head[1]
        dz = v.co.z - head[2]
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist >= radius:
            continue

        if dist <= plateau:
            w = 1.0
            plateau_count += 1
        else:
            w = smoothstep((radius - dist) / (radius - plateau))
        if w <= 0.0001:
            continue

        # Partition of unity: scale other bone weights by (1-w). At center (w=1),
        # vert is 100% controlled by jiggle bone. Removes zero-scaled groups
        # completely so GLB 4-influence cap doesn't dilute jiggle.
        scale = 1.0 - w
        to_remove = []
        for g in v.groups:
            if g.group == vg_index:
                continue
            other_vg = mesh_obj.vertex_groups[g.group]
            new_weight = g.weight * scale
            if new_weight < 0.0001:
                to_remove.append(other_vg)
            else:
                other_vg.add([v.index], new_weight, 'REPLACE')
        for other_vg in to_remove:
            other_vg.remove([v.index])
        vg.add([v.index], w, 'REPLACE')
        painted += 1

    print(f'  painted weights: {name} ({painted} verts, plateau={plateau_count} @w=1.0, radius={radius})')


for spec in added:
    paint_bone_weights(spec)

# 3. Export.
for o in bpy.data.objects:
    try:
        o.select_set(False)
    except RuntimeError:
        pass
mesh_obj.select_set(True)
armature.select_set(True)
bpy.context.view_layer.objects.active = armature

bpy.ops.export_scene.gltf(
    filepath=MESH_GLB,
    export_format='GLB',
    use_selection=True,
    export_animations=False,
    export_apply=False,
    export_yup=True,
    export_skins=True,
    export_morph=False,
    export_materials='EXPORT',
)
print(f'wrote {MESH_GLB} ({os.path.getsize(MESH_GLB):,} bytes)')
