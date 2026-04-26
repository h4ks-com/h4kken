"""Export a .blend's Armature + Mesh as Mixamo-compatible FBX.

Usage (headless):
    blender -b --factory-startup <input.blend> -P scripts/export_fbx.py -- <output.fbx>

Selects all ARMATURE + MESH objects in the file, exports with the params our
build pipeline expects (Y-up internal, axis_forward=-Z, no leaf bones, no
bake_space_transform — see scripts/build-character.ts).
"""
import bpy
import sys
import os


def main() -> None:
    argv = sys.argv
    if '--' not in argv:
        print('ERROR: missing -- <output.fbx>')
        sys.exit(1)
    out = argv[argv.index('--') + 1]
    out = os.path.abspath(out)

    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')

    for o in bpy.data.objects:
        o.select_set(False)

    arm = None
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            o.hide_set(False)
            o.select_set(True)
            if arm is None:
                arm = o
        elif o.type == 'MESH':
            o.hide_set(False)
            o.select_set(True)

    if arm is None:
        print('ERROR: no ARMATURE in scene')
        sys.exit(1)

    bpy.context.view_layer.objects.active = arm

    bpy.ops.export_scene.fbx(
        filepath=out,
        use_selection=True,
        use_active_collection=False,
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options='FBX_SCALE_ALL',
        use_space_transform=True,
        bake_space_transform=False,
        object_types={'ARMATURE', 'MESH'},
        use_mesh_modifiers=False,
        mesh_smooth_type='FACE',
        use_subsurf=False,
        use_mesh_edges=False,
        use_tspace=False,
        use_custom_props=False,
        add_leaf_bones=False,
        primary_bone_axis='Y',
        secondary_bone_axis='X',
        use_armature_deform_only=False,
        armature_nodetype='NULL',
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=True,
        bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
        bake_anim_simplify_factor=1.0,
        path_mode='COPY',
        embed_textures=True,
        batch_mode='OFF',
        axis_forward='-Z',
        axis_up='Y',
    )

    print(f'[export_fbx] wrote {out} ({os.path.getsize(out)} bytes)')


main()
