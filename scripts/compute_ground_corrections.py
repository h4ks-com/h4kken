"""
Compute ground corrections for all animations in character GLBs.
For each animation, finds how far the character floats above the floor
at the designated "ground contact" frame, and outputs the Hips Y delta needed.

Run this against the UNCORRECTED built GLBs (i.e. after `bun run build:character`
with groundCorrections cleared from characters.ts) to recompute correction values:

  blender -b --factory-startup -P scripts/compute_ground_corrections.py

Then paste the JSON output into scripts/characters.ts → CharacterSource.groundCorrections
and rebuild. Only clips where abs(correction) > 5mm are included.

When to recompute:
  - A new character is added
  - The UAL animation packs are updated (new UAL1/UAL2 blend files)
  - A character's source mesh is re-exported with different proportions
"""
import bpy, json, sys, os

CHARS = [
    os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'models', 'beano.glb'),
    os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'models', 'mita.glb'),
    os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'models', 'handyc.glb'),
]

# Strategy: 'last' = use last frame, 'min' = use minimum across all frames
# These are the animations that need ground correction
GROUND_ANIMS = {
    "Death01": "last",
    "Death02": "last",
    "LiftAir_Fall_Impact": "last",
    "GroundSit_Enter": "last",
    "GroundSit_Idle_Loop": "min",
    "GroundSit_Exit": "first",
    "Crouch_Idle_Loop": "min",
    "Crouch_Enter": "last",
    "Crouch_Exit": "first",
    "Crouch_Fwd_Loop": "min",
    "Crouch_Bwd_Loop": "min",
    "Fixing_Kneeling": "min",
    "Slide_Start": "min",
}

all_results = {}

for glb_path in CHARS:
    char_id = os.path.basename(glb_path).replace(".glb", "")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    arm_obj = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    
    # Reference floor from Idle_Loop
    idle_action = bpy.data.actions.get("Idle_Loop")
    arm_obj.animation_data.action = idle_action
    bpy.context.scene.frame_set(int(idle_action.frame_range[1]))
    bpy.context.view_layer.update()
    FLOOR_REF = min((arm_obj.matrix_world @ pb.matrix).translation.z for pb in arm_obj.pose.bones)
    
    corrections = {}
    for anim_name, strategy in GROUND_ANIMS.items():
        action = bpy.data.actions.get(anim_name)
        if not action:
            continue
        arm_obj.animation_data.action = action
        frame_start = int(action.frame_range[0])
        frame_end = int(action.frame_range[1])
        
        if strategy == "last":
            bpy.context.scene.frame_set(frame_end)
            bpy.context.view_layer.update()
            contact_z = min((arm_obj.matrix_world @ pb.matrix).translation.z for pb in arm_obj.pose.bones)
        elif strategy == "first":
            bpy.context.scene.frame_set(frame_start)
            bpy.context.view_layer.update()
            contact_z = min((arm_obj.matrix_world @ pb.matrix).translation.z for pb in arm_obj.pose.bones)
        else:  # min
            contact_z = float("inf")
            for f in range(frame_start, frame_end + 1):
                bpy.context.scene.frame_set(f)
                bpy.context.view_layer.update()
                z = min((arm_obj.matrix_world @ pb.matrix).translation.z for pb in arm_obj.pose.bones)
                if z < contact_z:
                    contact_z = z
        
        correction = contact_z - FLOOR_REF
        if abs(correction) > 0.005:  # Skip tiny corrections < 5mm
            corrections[anim_name] = round(correction, 4)
    
    all_results[char_id] = corrections
    print(f"\n{char_id} (floor_ref={FLOOR_REF:.4f}):")
    for anim, corr in sorted(corrections.items(), key=lambda x: -abs(x[1])):
        print(f"  {anim:<30} {corr:+.4f}  (hip needs to shift {'down' if corr > 0 else 'up'} by {abs(corr):.4f}m)")

print("\n\n=== JSON OUTPUT ===")
print(json.dumps(all_results, indent=2))
