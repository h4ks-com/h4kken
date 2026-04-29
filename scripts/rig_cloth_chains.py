"""
Rig a character's cloth panel as spring-bone chains for runtime jiggle.

Workflow:
  1. In Blender, manually paint a vertex group (default `cloth_main`) covering
     ALL cloth verts you want to swing freely (front + back faces).
  2. Run this script (in Blender's Scripting tab OR headless).
  3. It expands the group to back-face counterparts (proximity), splits front/back
     by Y, generates 3 parallel bone chains per panel (L/C/R) parented to a body
     bone, and weights cloth verts to chains with X-blend across siblings + Z-blend
     along chain + top-blend with body bone for smooth waist transition.

Args via env vars (all optional except where noted):
  CLOTH_VG          name of the vertex group marking cloth verts. Default 'cloth_main'.
  PARENT_BONE       body bone the chain roots parent to. Default 'mixamorig:Hips'.
  CHAIN_PREFIX      prefix for generated bones. Default 'Cloth'.
                    Bones are named {prefix}_{Front|Back}_{L|C|R}_{1..N}.
  N_BONES           bones per chain. Default 10.
  TOP_SMOOTH_T      fraction of cloth Z-range at top that blends with PARENT_BONE
                    weight (0..1, smaller = sharper transition). Default 0.18.
  BACKFACE_R        proximity radius (m) for back-face vert expansion. Default 0.005.
  STRIP_BONES_JSON  JSON list of body bone names whose weights to strip from cloth
                    verts. Default = legs+spine+feet group.

Idempotent: existing bones with prefix `{CHAIN_PREFIX}_` are deleted and regenerated.

Re-run after re-painting cloth_main to redo the rig from scratch.
"""
import bpy
import json
import os
import sys
from mathutils import Vector, kdtree


CLOTH_VG = os.environ.get('CLOTH_VG', 'cloth_main')
PARENT_BONE = os.environ.get('PARENT_BONE', 'mixamorig:Hips')
CHAIN_PREFIX = os.environ.get('CHAIN_PREFIX', 'Cloth')
N_BONES = int(os.environ.get('N_BONES', '10'))
TOP_SMOOTH_T = float(os.environ.get('TOP_SMOOTH_T', '0.18'))
BACKFACE_R = float(os.environ.get('BACKFACE_R', '0.005'))
DEFAULT_STRIP = [
    'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
    'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg',
    'mixamorig:LeftLeg', 'mixamorig:RightLeg',
    'mixamorig:LeftFoot', 'mixamorig:RightFoot',
    'mixamorig:LeftToeBase', 'mixamorig:RightToeBase',
]
STRIP_BONES = json.loads(os.environ['STRIP_BONES_JSON']) if 'STRIP_BONES_JSON' in os.environ else DEFAULT_STRIP


def find_armature_and_mesh():
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not arm:
        raise RuntimeError('no Armature object in scene')
    mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is arm]
    if not mesh_objs:
        mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.find_armature() is arm]
    if not mesh_objs:
        raise RuntimeError('no skinned mesh found for armature')
    return arm, mesh_objs[0]


def expand_to_backfaces(mesh, mw, cloth_idx):
    """Add nearby unpainted verts (likely back-face counterparts) to cloth_main."""
    painted_set = set()
    painted_pos = []
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.group == cloth_idx and g.weight > 0.5:
                painted_set.add(v.index)
                painted_pos.append(mw @ v.co)
                break
    if not painted_pos:
        raise RuntimeError(f'vertex group "{CLOTH_VG}" has no painted verts')
    kd = kdtree.KDTree(len(painted_pos))
    for i, wp in enumerate(painted_pos):
        kd.insert(wp, i)
    kd.balance()
    added = []
    for v in mesh.data.vertices:
        if v.index in painted_set:
            continue
        _, _, dist = kd.find(mw @ v.co)
        if dist < BACKFACE_R:
            added.append(v.index)
    mesh.vertex_groups[CLOTH_VG].add(added, 1.0, 'REPLACE')
    return len(painted_set), len(added)


def panel_specs(verts_world, panel_name):
    """3 chain XY positions for one panel (front or back). Chains placed at
    17/50/83 percentiles of the panel's X distribution so they cover the full
    cloth width — putting outermost chains close to the cloth edges instead of
    inside it (which leaves the side cloth poorly weighted)."""
    xs = sorted(w.x for w in verts_world)
    ys = [w.y for w in verts_world]
    zs = [w.z for w in verts_world]
    n = len(xs)
    pct = lambda p: xs[int(n * p)] if n else 0.0
    y_avg = sum(ys) / len(ys) if ys else 0
    return [
        (f'{CHAIN_PREFIX}_{panel_name}_L', pct(0.17), y_avg),
        (f'{CHAIN_PREFIX}_{panel_name}_C', pct(0.50), y_avg),
        (f'{CHAIN_PREFIX}_{panel_name}_R', pct(0.83), y_avg),
    ], max(zs), min(zs)


def main():
    bpy.ops.object.mode_set(mode='OBJECT')
    arm, mesh = find_armature_and_mesh()
    mw = mesh.matrix_world
    aw_inv = arm.matrix_world.inverted()

    cloth_vg = mesh.vertex_groups.get(CLOTH_VG)
    if not cloth_vg:
        raise RuntimeError(f'no vertex group "{CLOTH_VG}" — paint it first in Blender')
    cloth_idx = cloth_vg.index

    # 1. Wipe any existing cloth bones + groups (idempotent re-run).
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    bone_prefix = f'{CHAIN_PREFIX}_'
    wiped_bones = [b.name for b in eb if b.name.startswith(bone_prefix)]
    for n in wiped_bones:
        eb.remove(eb[n])
    bpy.ops.object.mode_set(mode='OBJECT')
    wiped_vgs = [vg.name for vg in mesh.vertex_groups if vg.name.startswith(bone_prefix)]
    for n in wiped_vgs:
        mesh.vertex_groups.remove(mesh.vertex_groups[n])
    print(f'wiped {len(wiped_bones)} bones + {len(wiped_vgs)} vgroups (prefix {bone_prefix!r})')

    # 2. Expand cloth_main to include back-face verts.
    n_painted, n_added = expand_to_backfaces(mesh, mw, cloth_idx)
    print(f'cloth verts: {n_painted} painted + {n_added} backface = {n_painted + n_added}')

    # 3. Gather all cloth verts; split front (Y<0) / back (Y>=0).
    all_cloth = []
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.group == cloth_idx and g.weight > 0.5:
                all_cloth.append(v)
                break
    front_verts = [v for v in all_cloth if (mw @ v.co).y < 0]
    back_verts = [v for v in all_cloth if (mw @ v.co).y >= 0]
    print(f'front={len(front_verts)} back={len(back_verts)}')

    # 4. Per-panel chain specs.
    front_specs, fz_top, fz_bot = panel_specs([mw @ v.co for v in front_verts], 'Front')
    back_specs, bz_top, bz_bot = panel_specs([mw @ v.co for v in back_verts], 'Back')
    print('chain XY positions:')
    for s in front_specs + back_specs:
        print(f'  {s[0]}: X={s[1]:+.3f} Y={s[2]:+.3f}')

    # 5. Generate bones (parented to PARENT_BONE).
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    parent_eb = eb.get(PARENT_BONE)
    if not parent_eb:
        raise RuntimeError(f'parent bone "{PARENT_BONE}" not found in armature')

    chain_specs = {}  # cname -> (z_top, z_bot, x)
    for specs, z_top, z_bot in [(front_specs, fz_top, fz_bot), (back_specs, bz_top, bz_bot)]:
        for cname, x, y in specs:
            prev = parent_eb
            for i in range(N_BONES):
                t0 = i / N_BONES
                t1 = (i + 1) / N_BONES
                head_w = Vector((x, y, z_top - t0 * (z_top - z_bot)))
                tail_w = Vector((x, y, z_top - t1 * (z_top - z_bot)))
                hl = aw_inv @ head_w
                tl = aw_inv @ tail_w
                bone = eb.new(f'{cname}_{i + 1}')
                bone.head = (hl.x, hl.y, hl.z)
                bone.tail = (tl.x, tl.y, tl.z)
                bone.parent = prev
                bone.use_connect = False
                bone.use_deform = True
                prev = bone
            chain_specs[cname] = (z_top, z_bot, x)
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f'created {len(chain_specs)} chains × {N_BONES} bones = {len(chain_specs) * N_BONES} bones')

    # 6. Create vertex groups for each new bone.
    chain_vgs = {
        cname: [mesh.vertex_groups.new(name=f'{cname}_{i + 1}') for i in range(N_BONES)]
        for cname in chain_specs
    }

    # 7. Weight verts: X-blend between siblings, Z-blend along chain, top-blend with parent.
    body_idx_strip = {mesh.vertex_groups[n].index for n in STRIP_BONES if n in mesh.vertex_groups}
    parent_idx = mesh.vertex_groups[PARENT_BONE].index
    front_chain_names = [s[0] for s in front_specs]
    back_chain_names = [s[0] for s in back_specs]
    z_global_top = max(fz_top, bz_top)
    z_global_bot = min(fz_bot, bz_bot)
    z_global_range = max(z_global_top - z_global_bot, 0.001)

    for v in all_cloth:
        wp = mw @ v.co
        chains_use = front_chain_names if wp.y < 0 else back_chain_names
        # Top-blend: cloth_factor = 0 at very top → 1 below smooth zone
        cloth_factor = min(1.0, ((z_global_top - wp.z) / z_global_range) / TOP_SMOOTH_T)

        # Strip listed body bone weights
        for g in list(v.groups):
            if g.group in body_idx_strip:
                mesh.vertex_groups[g.group].remove([v.index])

        # Parent bone gets remaining weight in top zone
        parent_w = 1.0 - cloth_factor
        if parent_w > 0.001:
            mesh.vertex_groups[parent_idx].add([v.index], parent_w, 'REPLACE')
        else:
            mesh.vertex_groups[parent_idx].remove([v.index])

        if cloth_factor < 0.001:
            continue

        # X-blend between 2 nearest sibling chains
        sorted_c = sorted(chains_use, key=lambda c: abs(wp.x - chain_specs[c][2]))
        c_a, c_b = sorted_c[0], sorted_c[1]
        x_a, x_b = chain_specs[c_a][2], chain_specs[c_b][2]
        if (x_a <= wp.x <= x_b) or (x_b <= wp.x <= x_a):
            denom = x_b - x_a
            w_b = 0.0 if abs(denom) < 1e-6 else max(0.0, min(1.0, (wp.x - x_a) / denom))
            w_a = 1.0 - w_b
        else:
            w_a, w_b = 1.0, 0.0

        # Distribute by Z within each contributing chain
        for cname, w_chain in [(c_a, w_a), (c_b, w_b)]:
            if w_chain < 0.001:
                continue
            vgs = chain_vgs[cname]
            z_top_c, z_bot_c, _ = chain_specs[cname]
            zr = max(z_top_c - z_bot_c, 0.001)
            t = max(0.0, min(1.0, (z_top_c - wp.z) / zr))
            f = t * (len(vgs) - 1)
            i0 = int(f)
            i1 = min(i0 + 1, len(vgs) - 1)
            frac = f - i0
            w0 = (1.0 - frac) * w_chain * cloth_factor
            w1 = frac * w_chain * cloth_factor
            if w0 > 0.001:
                vgs[i0].add([v.index], w0, 'REPLACE')
            if w1 > 0.001:
                vgs[i1].add([v.index], w1, 'REPLACE')

    print(f'weighted {len(all_cloth)} cloth verts')


if __name__ == '__main__':
    try:
        main()
        if bpy.data.filepath:
            bpy.ops.wm.save_mainfile()
            print(f'saved {bpy.data.filepath}')
        else:
            print('NOTE: file unsaved (no filepath); save manually')
    except Exception as exc:
        print(f'ERROR: {exc}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
