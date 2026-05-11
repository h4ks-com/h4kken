"""
Export an arena .blend as a single GLB consumed by the runtime arena loader
(see src/arenas/index.ts → ARENAS[*].scenery.glb).

Args via env vars:
  ARENA_BLEND   absolute path to the input .blend (e.g. assets/source/default_arena.blend)
  ARENA_OUT     absolute path to the GLB to write (e.g. public/assets/arenas/default.glb)

No Blender addons needed — only stock bpy.ops.

Run headlessly:
  ARENA_BLEND=assets/source/default_arena.blend \
  ARENA_OUT=public/assets/arenas/default.glb \
    blender -b -P scripts/export_arena.py

Or use the wrapper:
  bun run build:arena default
"""
import bpy
import os
import sys


ARENA_BLEND = os.environ.get('ARENA_BLEND')
ARENA_OUT = os.environ.get('ARENA_OUT')


def main():
    if not ARENA_BLEND or not ARENA_OUT:
        print('ERROR: set ARENA_BLEND and ARENA_OUT env vars')
        sys.exit(1)

    if not os.path.isfile(ARENA_BLEND):
        print(f'ERROR: ARENA_BLEND not found: {ARENA_BLEND}')
        sys.exit(1)

    os.makedirs(os.path.dirname(ARENA_OUT), exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=ARENA_BLEND)

    bpy.ops.object.select_all(action='DESELECT')

    # use_visible=True respects viewport visibility so hidden helpers/refs are skipped.
    # export_apply bakes modifiers (decimate, array, mirror) into the final mesh.
    # export_yup matches Babylon's left-handed Y-up convention.
    # Cameras/lights/animations are off — arenas are static scenery, lighting comes
    # from Stage.ts (sun + ambient + per-arena indoorLights).
    bpy.ops.export_scene.gltf(
        filepath=ARENA_OUT,
        export_format='GLB',
        use_selection=False,
        use_visible=True,
        use_renderable=False,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )

    size_mb = os.path.getsize(ARENA_OUT) / 1024 / 1024
    print(f'OK wrote {ARENA_OUT} ({size_mb:.2f} MB)')


if __name__ == '__main__':
    main()
