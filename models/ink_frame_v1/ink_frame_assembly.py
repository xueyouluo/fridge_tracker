"""Labeled assembly for fit and routing review."""

from build123d import Color, Location
from cadpy.assembly import AssemblyHelper

from ink_frame_common import (
    D,
    make_component_envelope,
    make_fpc_route_clearance,
    make_front_bezel,
    make_rear_shell,
    make_screen_module,
    make_screw_envelope,
    make_wall_switch_envelope,
    screw_positions,
)


def gen_step():
    asm = AssemblyHelper("4_2_inch_epaper_picture_frame")

    front = asm.add(make_front_bezel(), "front_bezel", color=Color(0.12, 0.12, 0.14))
    rear = asm.add(make_rear_shell(), "rear_shell", color=Color(0.18, 0.18, 0.21))

    front_seat = asm.rigid_frame(front, "rear_shell_seat", Location((0, 0, D.rear_mate_z)))
    rear_rim = asm.rigid_frame(rear, "front_rim", Location((0, 0, 0)))
    asm.face_to_face(front_seat, rear_rim, label="rear_shell_to_front_bezel")

    asm.add(make_screen_module(), "epaper_screen", color=Color(0.82, 0.83, 0.78))

    component_back_z = D.rear_mate_z + D.rear_inner_back_z
    asm.add(
        make_component_envelope(D.driver_w, D.driver_h, D.driver_t, D.driver_x, D.driver_y, component_back_z),
        "epaper_driver_envelope",
        color=Color(0.18, 0.48, 0.24),
    )
    asm.add(
        make_component_envelope(D.battery_w, D.battery_h, D.battery_t, D.battery_x, D.battery_y, component_back_z),
        "battery_41_2x30x9_7_envelope",
        color=Color(0.26, 0.32, 0.52),
    )
    asm.add(
        make_component_envelope(D.esp_w, D.esp_h, D.esp_t, D.esp_x, D.esp_y, component_back_z),
        "esp32_c3_mini_type_c_left_envelope",
        color=Color(0.10, 0.36, 0.42),
    )
    asm.add(
        make_component_envelope(D.charge_w, D.charge_h, D.charge_t, D.charge_x, D.charge_y, component_back_z),
        "charge_discharge_17_3x12_2_type_c_right_envelope",
        color=Color(0.54, 0.22, 0.12),
    )
    asm.add(
        make_wall_switch_envelope(D.rear_mate_z),
        "power_switch_11_2x6_wall_face_10_depth_envelope",
        color=Color(0.36, 0.36, 0.38),
    )
    asm.add(make_fpc_route_clearance(), "fpc_route_straight_back", color=Color(0.86, 0.45, 0.12))

    for index, (x, y) in enumerate(screw_positions(), start=1):
        screw = make_screw_envelope().moved(Location((x, y, 0)))
        asm.add(screw, "m2_5x8_5_thread_screw_envelope", f"corner_{index}", color=Color(0.48, 0.49, 0.52))

    return asm.build()
