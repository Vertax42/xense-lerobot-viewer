# TacCap data-collection grippers

These local assets power the `3D Replay` view for datasets whose
`robot_type` is `bi_taccap_gripper`.

- `left/gripper.urdf` and `right/gripper.urdf` are sanitized, project-local
  copies of the supplied SolidWorks URDF exports.
- Mesh references are relative, so runtime loading never depends on a ROS
  package path or on files outside this repository.
- The recorded `left_tcp` / `right_tcp` streams share the canonical frame
  `+X forward, +Y left, +Z up`. The viewer applies the measured
  `base_link -> link4` translation before positioning each complete model,
  while intentionally excluding the left CAD marker's local `-90°` rotation.
  That URDF rotation orients the marker mesh; applying it again to the recorded
  TCP frame would turn the whole left gripper sideways.
- `joint2` is driven in `[-1, 0]`; the URDF mimic relation drives `joint1`
  with the opposite angle.
