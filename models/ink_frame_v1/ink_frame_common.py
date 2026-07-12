"""Parametric geometry for a 4.2-inch e-paper picture frame.

Coordinate convention:
- XY is the front face of the frame.
- The screen center is the assembly origin in XY.
- +Z points rearward, from the visible front face toward the rear shell.
"""

from __future__ import annotations

from dataclasses import dataclass

from build123d import Align, Box, Compound, Cylinder, Location, RectangleRounded, extrude, make_face


@dataclass(frozen=True)
class Design:
    # Main screen and visible-area dimensions from the user's sketch.
    screen_w: float = 90.8
    screen_h: float = 76.9
    screen_t: float = 1.1
    screen_clearance: float = 0.4
    active_w: float = 84.8
    active_h: float = 64.9
    active_y: float = 3.0
    fpc_w: float = 16.0
    fpc_x: float = 0.4

    # User-supplied component envelopes.
    driver_w: float = 31.0
    driver_h: float = 45.0
    driver_t: float = 5.1
    battery_w: float = 41.2
    battery_h: float = 30.0
    battery_t: float = 9.7
    esp_w: float = 23.8
    esp_h: float = 18.0
    esp_t: float = 5.0
    # Charger and ESP32 Type-C connectors are on their short edges. Keep each
    # board's long axis along X so the connector points through the right wall.
    charge_w: float = 17.3
    charge_h: float = 12.2
    charge_t: float = 4.4
    # The switch's 11.2 x 6 face sits against the side wall; its 10 mm depth
    # extends inward along X.
    switch_face_l: float = 11.2
    switch_face_h: float = 6.0
    switch_depth: float = 10.0
    type_c_opening_w: float = 10.5
    type_c_opening_h: float = 5.4
    switch_opening_w: float = 12.0
    switch_opening_h: float = 6.8

    # Front bezel and rear shell.
    front_w: float = 112.0
    front_h: float = 98.0
    front_radius: float = 4.0
    face_t: float = 2.4
    wall: float = 2.4
    skirt_h: float = 3.6
    rear_fit_clearance: float = 0.3
    rear_lead_inset: float = 0.2
    rear_lead_depth: float = 1.0
    rear_depth: float = 12.0
    rear_back_t: float = 2.4
    rear_mate_z: float = 4.8

    # Screw fastening: rear-access M2.5 screws into blind front bosses.
    # M3 bosses collide with the compact frame's corner walls.
    screw_d: float = 2.5
    screw_clearance_d: float = 2.9
    screw_head_d: float = 5.2
    screw_head_t: float = 1.8
    screw_thread_l: float = 8.5
    screw_pilot_d: float = 2.1
    # Front boss stays compact; the rear post is wider so the deep 5.2 mm
    # counterbore retains four 0.4 mm-class perimeter lines.
    screw_boss_d: float = 5.4
    rear_screw_post_d: float = 8.0
    screw_x: float = 48.0
    screw_y: float = 41.0
    front_boss_top_z: float = 6.8
    front_pilot_bottom_z: float = 2.8
    screw_tip_clearance: float = 0.5
    rear_post_front_z: float = 2.4

    # Component layout. The driver/FPC share the same X center.
    driver_x: float = 0.4
    driver_y: float = 15.6
    # Keep the battery horizontal in the lower-right bay. It only moves left
    # far enough to clear the reinforced lower-right screw post and the
    # battery positioning fence; its lower edge remains near the bottom wall.
    battery_x: float = 21.5
    battery_y: float = -28.0
    charge_x: float = 42.0
    charge_y: float = 1.5
    esp_x: float = -38.5
    esp_y: float = -22.0
    switch_y: float = 21.0

    @property
    def rear_w(self) -> float:
        return self.front_w - 2 * self.wall - 2 * self.rear_fit_clearance

    @property
    def rear_h(self) -> float:
        return self.front_h - 2 * self.wall - 2 * self.rear_fit_clearance

    @property
    def rear_inner_w(self) -> float:
        return self.rear_w - 2 * self.wall

    @property
    def rear_inner_h(self) -> float:
        return self.rear_h - 2 * self.wall

    @property
    def switch_x(self) -> float:
        return self.rear_inner_w / 2 - self.switch_depth / 2

    @property
    def switch_local_z0(self) -> float:
        return self.rear_inner_back_z - self.switch_face_h

    @property
    def side_opening_z0(self) -> float:
        """Keep side openings aligned to back-mounted Type-C connectors."""

        return self.rear_inner_back_z - self.type_c_opening_h + 0.2

    @property
    def screw_tip_z(self) -> float:
        """Global Z of the screw tip, above the blind-hole floor."""

        return self.front_pilot_bottom_z + self.screw_tip_clearance

    @property
    def screw_head_seat_local_z(self) -> float:
        """Rear-shell-local Z for the underside of an 8.5 mm threaded shaft."""

        return self.screw_tip_z + self.screw_thread_l - self.rear_mate_z

    @property
    def screw_engagement(self) -> float:
        return self.front_boss_top_z - self.screw_tip_z

    @property
    def screw_counterbore_depth(self) -> float:
        return self.rear_depth - self.screw_head_seat_local_z

    @property
    def screw_counterbore_wall_t(self) -> float:
        return (self.rear_screw_post_d - self.screw_head_d) / 2

    @property
    def rear_inner_back_z(self) -> float:
        return self.rear_depth - self.rear_back_t

    @property
    def assembly_back_z(self) -> float:
        return self.rear_mate_z + self.rear_depth


D = Design()


def _rounded_prism(width: float, height: float, radius: float, depth: float, z0: float = 0.0):
    profile = make_face(RectangleRounded(width, height, radius))
    return extrude(profile, depth).moved(Location((0, 0, z0)))


def _rounded_ring(
    width: float,
    height: float,
    radius: float,
    wall: float,
    depth: float,
    z0: float = 0.0,
):
    outer = _rounded_prism(width, height, radius, depth, z0)
    inner_radius = max(0.6, radius - wall)
    inner = _rounded_prism(
        width - 2 * wall,
        height - 2 * wall,
        inner_radius,
        depth + 1.0,
        z0 - 0.5,
    )
    return outer - inner


def _box(
    width: float,
    height: float,
    depth: float,
    x: float = 0.0,
    y: float = 0.0,
    z0: float = 0.0,
):
    return Box(
        width,
        height,
        depth,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).moved(Location((x, y, z0)))


def _component_fence(
    width: float,
    height: float,
    x: float,
    y: float,
    *,
    gate_width: float | None = None,
    gate_side: str = "bottom",
):
    """Low back-connected fence for VHB-mounted component envelopes."""

    fence_wall = 1.0
    envelope_gap = 0.5
    fence_h = 1.6
    z0 = D.rear_inner_back_z - fence_h + 0.1
    outer_w = width + 2 * (envelope_gap + fence_wall)
    outer_h = height + 2 * (envelope_gap + fence_wall)
    inner_w = width + 2 * envelope_gap
    inner_h = height + 2 * envelope_gap
    fence = _box(outer_w, outer_h, fence_h, x, y, z0) - _box(
        inner_w,
        inner_h,
        fence_h + 1.0,
        x,
        y,
        z0 - 0.5,
    )
    if gate_width is not None:
        gate_y = y - outer_h / 2 if gate_side == "bottom" else y + outer_h / 2
        gate = _box(gate_width, 3.0, fence_h + 1.0, x, gate_y, z0 - 0.5)
        fence = fence - gate
    return fence


def make_front_bezel():
    """Front cosmetic frame, screen pocket, alignment skirt, and blind bosses."""

    plate = _rounded_prism(D.front_w, D.front_h, D.front_radius, D.face_t)
    window = _rounded_prism(D.active_w, D.active_h, 1.5, D.face_t + 2.0, -1.0).moved(
        Location((0, D.active_y, 0))
    )
    plate = plate - window

    skirt = _rounded_ring(
        D.front_w,
        D.front_h,
        D.front_radius,
        D.wall,
        D.skirt_h,
        D.face_t,
    )

    pocket_inner_w = D.screen_w + 2 * D.screen_clearance
    pocket_inner_h = D.screen_h + 2 * D.screen_clearance
    pocket_wall = 2.4
    pocket_outer_w = pocket_inner_w + 2 * pocket_wall
    pocket_outer_h = pocket_inner_h + 2 * pocket_wall
    screen_ring = _rounded_ring(
        pocket_outer_w,
        pocket_outer_h,
        2.2,
        pocket_wall,
        1.7,
        D.face_t,
    )
    fpc_gate = _box(
        D.fpc_w + 4.0,
        5.5,
        2.7,
        D.fpc_x,
        -pocket_inner_h / 2 - pocket_wall / 2,
        D.face_t - 0.5,
    )
    screen_ring = screen_ring - fpc_gate

    body = plate + skirt + screen_ring
    for sx in (-D.screw_x, D.screw_x):
        for sy in (-D.screw_y, D.screw_y):
            boss = Cylinder(
                D.screw_boss_d / 2,
                D.front_boss_top_z - D.face_t,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            ).moved(Location((sx, sy, D.face_t)))
            body = body + boss
            blind_pilot = Cylinder(
                D.screw_pilot_d / 2,
                D.front_boss_top_z - D.front_pilot_bottom_z + 0.5,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            ).moved(Location((sx, sy, D.front_pilot_bottom_z)))
            body = body - blind_pilot

    body.label = "front_bezel"
    return body


def make_rear_shell():
    """Open-front rear shell with ports, screw columns, and component fences."""

    rear_radius = max(2.0, D.front_radius - D.wall - D.rear_fit_clearance)
    main_walls = _rounded_ring(
        D.rear_w,
        D.rear_h,
        rear_radius,
        D.wall,
        D.rear_depth - D.rear_lead_depth + 0.1,
        D.rear_lead_depth - 0.1,
    )
    lead_w = D.rear_w - 2 * D.rear_lead_inset
    lead_h = D.rear_h - 2 * D.rear_lead_inset
    lead_wall = (lead_w - D.rear_inner_w) / 2
    lead = _rounded_ring(
        lead_w,
        lead_h,
        max(1.5, rear_radius - D.rear_lead_inset),
        lead_wall,
        D.rear_lead_depth,
    )
    walls = main_walls + lead
    back = _rounded_prism(
        D.rear_w,
        D.rear_h,
        rear_radius,
        D.rear_back_t,
        D.rear_inner_back_z,
    )
    body = walls + back

    # Service openings. Charger Type-C points through the right wall; the
    # independently placed ESP32-C3 Mini Type-C points through the left wall.
    right_side_cut_x = D.rear_w / 2 - 0.4
    left_side_cut_x = -D.rear_w / 2 + 0.4
    charge_port = _box(
        5.5,
        D.type_c_opening_w,
        D.type_c_opening_h,
        right_side_cut_x,
        D.charge_y,
        D.side_opening_z0,
    )
    esp_type_c_port = _box(
        5.5,
        D.type_c_opening_w,
        D.type_c_opening_h,
        left_side_cut_x,
        D.esp_y,
        D.side_opening_z0,
    )
    switch_port = _box(
        5.5,
        D.switch_opening_w,
        D.switch_opening_h,
        right_side_cut_x,
        D.switch_y,
        D.switch_local_z0 - 0.4,
    )
    body = body - charge_port - esp_type_c_port - switch_port

    # Rear-access screw columns. The columns stop before the front bosses,
    # leaving a 0.4 mm assembly gap; the screw bridges that gap.
    screw_access_cuts = []
    for sx in (-D.screw_x, D.screw_x):
        for sy in (-D.screw_y, D.screw_y):
            post = Cylinder(
                D.rear_screw_post_d / 2,
                D.rear_inner_back_z - D.rear_post_front_z + 0.1,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            ).moved(Location((sx, sy, D.rear_post_front_z)))
            body = body + post
            clearance = Cylinder(
                D.screw_clearance_d / 2,
                D.rear_depth + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            ).moved(Location((sx, sy, 1.8)))
            head_recess = Cylinder(
                D.screw_head_d / 2,
                D.screw_counterbore_depth + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            ).moved(Location((sx, sy, D.screw_head_seat_local_z)))
            screw_access = clearance + head_recess
            screw_access_cuts.append(screw_access)
            body = body - screw_access

    # Low positioning fences. Components sit against the rear inner face and
    # are retained with thin VHB/foam adhesive rather than rigid compression.
    fences = [
        _component_fence(
            D.driver_w,
            D.driver_h,
            D.driver_x,
            D.driver_y,
            gate_width=D.driver_w + 4.0,
            gate_side="bottom",
        ),
        # Battery fence intentionally omitted: the battery is retained with
        # thin adhesive and may be positioned freely around the reference
        # envelope after checking the real cable and screw clearances.
        _component_fence(D.esp_w, D.esp_h, D.esp_x, D.esp_y),
        _component_fence(D.charge_w, D.charge_h, D.charge_x, D.charge_y),
    ]
    for fence in fences:
        body = body + fence

    # Re-open service and screw paths after fences are fused so no indexing
    # wall blocks a connector or fastener.
    body = body - charge_port - esp_type_c_port - switch_port
    for screw_access in screw_access_cuts:
        body = body - screw_access
    body.label = "rear_shell"
    return body


def make_screen_module():
    glass = _box(D.screen_w, D.screen_h, D.screen_t, 0, 0, D.face_t)
    glass.label = "screen_glass_envelope"
    active = _rounded_prism(
        D.active_w - 0.2,
        D.active_h - 0.2,
        1.4,
        0.15,
        D.face_t - 0.05,
    ).moved(Location((0, D.active_y, 0)))
    active.label = "active_display_area"
    return Compound(label="4_2_inch_epaper_module", children=[glass, active])


def make_component_envelope(width: float, height: float, depth: float, x: float, y: float, back_z: float):
    return _box(width, height, depth, x, y, back_z - depth)


def make_wall_switch_envelope(rear_origin_z: float):
    """Switch envelope with its 11.2 x 6 face against the right side wall."""

    return _box(
        D.switch_depth,
        D.switch_face_l,
        D.switch_face_h,
        D.switch_x,
        D.switch_y,
        rear_origin_z + D.switch_local_z0,
    )


def make_fpc_route_clearance():
    """Three straight clearance segments; all keep the same X center."""

    screen_back = D.face_t + D.screen_t
    driver_front = D.rear_mate_z + D.rear_inner_back_z - D.driver_t
    driver_bottom_y = D.driver_y - D.driver_h / 2
    screen_bottom_y = -D.screen_h / 2
    # The lower-right battery crosses the FPC's XY projection. Keep the FPC
    # straight in X, but run it in front of the battery before turning backward
    # at the driver edge. This respects the no-sideways-bend constraint.
    first_depth = 0.7
    first = _box(D.fpc_w, 2.0, first_depth, D.fpc_x, screen_bottom_y + 0.9, screen_back)
    run_z = screen_back + first_depth
    run_h = driver_bottom_y - screen_bottom_y
    run = _box(D.fpc_w, run_h, 0.3, D.fpc_x, (screen_bottom_y + driver_bottom_y) / 2, run_z)
    final = _box(
        D.fpc_w,
        2.0,
        max(0.3, driver_front - run_z),
        D.fpc_x,
        driver_bottom_y,
        run_z,
    )
    first.label = "fpc_rearward_bend_clearance"
    run.label = "fpc_straight_run_clearance"
    final.label = "fpc_connector_bend_clearance"
    return Compound(label="fpc_route_no_lateral_bend", children=[first, run, final])


def screw_positions():
    return [(sx, sy) for sx in (-D.screw_x, D.screw_x) for sy in (-D.screw_y, D.screw_y)]


def make_screw_envelope():
    shaft_start_z = D.screw_tip_z
    shaft = Cylinder(
        D.screw_d / 2,
        D.screw_thread_l,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).moved(Location((0, 0, shaft_start_z)))
    head = Cylinder(
        D.screw_head_d / 2,
        D.screw_head_t,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).moved(Location((0, 0, D.rear_mate_z + D.screw_head_seat_local_z)))
    return shaft + head
