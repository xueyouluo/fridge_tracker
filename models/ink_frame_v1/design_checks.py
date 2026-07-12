"""Fast parameter-level checks that complement STEP topology inspection."""

from build123d import Location

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


def rect_bounds(width, height, x, y):
    return (x - width / 2, x + width / 2, y - height / 2, y + height / 2)


def overlaps_xy(a, b, clearance=0.0):
    return not (
        a[1] + clearance <= b[0]
        or b[1] + clearance <= a[0]
        or a[3] + clearance <= b[2]
        or b[3] + clearance <= a[2]
    )


def overlap_volume(a, b):
    return (a & b).volume


def main():
    screen = rect_bounds(D.screen_w, D.screen_h, 0, 0)
    driver = rect_bounds(D.driver_w, D.driver_h, D.driver_x, D.driver_y)
    battery = rect_bounds(D.battery_w, D.battery_h, D.battery_x, D.battery_y)
    esp = rect_bounds(D.esp_w, D.esp_h, D.esp_x, D.esp_y)
    charge = rect_bounds(D.charge_w, D.charge_h, D.charge_x, D.charge_y)
    switch = rect_bounds(D.switch_depth, D.switch_face_l, D.switch_x, D.switch_y)
    switch_z = (
        D.rear_mate_z + D.switch_local_z0,
        D.rear_mate_z + D.switch_local_z0 + D.switch_face_h,
    )
    battery_charge_gap = charge[2] - battery[3]
    charge_switch_gap = switch[2] - charge[3]
    rear_half_w = D.rear_inner_w / 2
    rear_half_h = D.rear_inner_h / 2
    battery_c3_x_gap = battery[0] - esp[1]
    battery_bottom_clearance = battery[2] + rear_half_h
    battery_post_x_gap = D.screw_x - D.rear_screw_post_d / 2 - battery[1]

    assert driver[0] >= screen[0] and driver[1] <= screen[1]
    assert driver[2] >= screen[2] and driver[3] <= screen[3]
    assert abs(D.driver_x - D.fpc_x) < 1e-9
    assert not overlaps_xy(driver, battery)
    assert not overlaps_xy(driver, esp)
    assert not overlaps_xy(battery, esp)
    assert not overlaps_xy(esp, charge)
    assert not overlaps_xy(charge, switch)
    assert not overlaps_xy(esp, switch)
    for bounds in (driver, battery, esp, charge, switch):
        assert bounds[0] >= -rear_half_w and bounds[1] <= rear_half_w
        assert bounds[2] >= -rear_half_h and bounds[3] <= rear_half_h
    assert D.esp_w > D.esp_h
    assert D.charge_w > D.charge_h
    assert 0.0 <= esp[0] + rear_half_w <= 0.8
    assert 0.0 <= rear_half_w - charge[1] <= 0.8
    assert abs(rear_half_w - switch[1]) < 1e-9
    assert 0.8 <= battery_bottom_clearance <= 1.0
    assert battery_c3_x_gap >= 25.0
    assert 1.8 <= battery_post_x_gap <= 2.0
    assert battery_charge_gap >= 3.0
    assert charge_switch_gap >= 7.0
    assert abs((switch[3] - switch[2]) - D.switch_face_l) < 1e-9
    assert abs((switch_z[1] - switch_z[0]) - D.switch_face_h) < 1e-9
    assert abs((switch[1] - switch[0]) - D.switch_depth) < 1e-9
    assert D.battery_t + 1.0 <= D.rear_mate_z + D.rear_inner_back_z - (D.face_t + D.screen_t)
    assert abs(D.rear_w - (D.front_w - 2 * D.wall - 2 * D.rear_fit_clearance)) < 1e-9
    assert abs(D.assembly_back_z - 16.8) < 1e-9
    assert abs(D.screw_thread_l - 8.5) < 1e-9
    assert D.screw_engagement >= 3.5
    assert D.screw_tip_z - D.front_pilot_bottom_z >= 0.5
    assert D.screw_counterbore_depth >= 4.5
    assert D.screw_counterbore_wall_t >= 1.4
    assert D.screw_x + D.rear_screw_post_d / 2 <= D.rear_w / 2
    assert D.screw_y + D.rear_screw_post_d / 2 <= D.rear_h / 2

    # BREP interference checks on the generated source geometry.
    front_part = make_front_bezel()
    rear_part = make_rear_shell().moved(Location((0, 0, D.rear_mate_z)))
    screen_part = make_screen_module()
    component_back_z = D.rear_mate_z + D.rear_inner_back_z
    envelopes = {
        "driver": make_component_envelope(D.driver_w, D.driver_h, D.driver_t, D.driver_x, D.driver_y, component_back_z),
        "battery": make_component_envelope(D.battery_w, D.battery_h, D.battery_t, D.battery_x, D.battery_y, component_back_z),
        "esp": make_component_envelope(D.esp_w, D.esp_h, D.esp_t, D.esp_x, D.esp_y, component_back_z),
        "charge": make_component_envelope(D.charge_w, D.charge_h, D.charge_t, D.charge_x, D.charge_y, component_back_z),
        "switch": make_wall_switch_envelope(D.rear_mate_z),
    }
    fpc = make_fpc_route_clearance()
    tolerance = 1e-5
    assert overlap_volume(front_part, rear_part) < tolerance
    assert overlap_volume(front_part, screen_part) < tolerance
    assert overlap_volume(rear_part, screen_part) < tolerance
    assert overlap_volume(front_part, fpc) < tolerance
    assert overlap_volume(rear_part, fpc) < tolerance
    # The wall-mounted switch and C3 connector intentionally enter their side
    # openings. The remaining free-standing envelopes must not hit the shell.
    for name in ("driver", "battery", "charge"):
        assert overlap_volume(rear_part, envelopes[name]) < tolerance
    for envelope in envelopes.values():
        assert overlap_volume(screen_part, envelope) < tolerance
    for name in ("battery", "esp", "charge", "switch"):
        assert overlap_volume(fpc, envelopes[name]) < tolerance
    names = list(envelopes)
    for index, name_a in enumerate(names):
        for name_b in names[index + 1 :]:
            assert overlap_volume(envelopes[name_a], envelopes[name_b]) < tolerance
    for x, y in screw_positions():
        screw = make_screw_envelope().moved(Location((x, y, 0)))
        assert overlap_volume(rear_part, screw) < tolerance
        assert overlap_volume(front_part, screw) > tolerance

    print("parameter checks: passed")
    print(f"assembly envelope target: {D.front_w:.1f} x {D.front_h:.1f} x {D.assembly_back_z:.1f} mm")
    print(f"rear shell: {D.rear_w:.1f} x {D.rear_h:.1f} x {D.rear_depth:.1f} mm")
    print(f"rear fit clearance: {D.rear_fit_clearance:.2f} mm per side")
    print(f"rear lead-in extra inset: {D.rear_lead_inset:.2f} mm per side")
    print(f"screen pocket clearance: {D.screen_clearance:.2f} mm per side")
    print(f"screen-to-battery front gap: {D.rear_mate_z + D.rear_inner_back_z - D.battery_t - (D.face_t + D.screen_t):.2f} mm")
    print(f"8.5 mm screw engagement in front boss: {D.screw_engagement:.2f} mm")
    print(f"screw tip clearance above blind-hole floor: {D.screw_tip_z - D.front_pilot_bottom_z:.2f} mm")
    print(f"rear counterbore depth to head seat: {D.screw_counterbore_depth:.2f} mm")
    print(f"rear screw post OD: {D.rear_screw_post_d:.2f} mm")
    print(f"counterbore radial wall thickness: {D.screw_counterbore_wall_t:.2f} mm")
    print(f"FPC/driver X center delta: {abs(D.driver_x - D.fpc_x):.2f} mm")
    print(f"driver XY bounds: {driver}")
    print(f"battery bottom-wall clearance: {battery_bottom_clearance:.2f} mm")
    print(f"battery-to-C3 X gap: {battery_c3_x_gap:.2f} mm")
    print(f"battery-to-lower-right-post X gap: {battery_post_x_gap:.2f} mm")
    print(f"charger Type-C wall clearance: {rear_half_w - charge[1]:.2f} mm")
    print(f"ESP32-C3 Mini Type-C left-wall clearance: {esp[0] + rear_half_w:.2f} mm")
    print(f"switch wall clearance: {rear_half_w - switch[1]:.2f} mm")
    print(f"switch wall face: {D.switch_face_l:.1f} x {D.switch_face_h:.1f} mm; inward depth: {D.switch_depth:.1f} mm")
    print(f"battery-to-charger gap: {battery_charge_gap:.2f} mm")
    print(f"charger-to-switch gap: {charge_switch_gap:.2f} mm")
    print("lower bay: C3 Mini stays left; horizontal battery stays right and only shifts enough to clear the screw post")
    print("BREP interference checks: passed (front/rear/screen/FPC/components/screw access)")


if __name__ == "__main__":
    main()
