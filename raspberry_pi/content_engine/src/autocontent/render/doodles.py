"""Hand-drawn SVG doodles: tapered brush underline and dashed loop curl."""

import math
import numpy as np
from typing import List, Tuple

REFERENCE_WAYPOINTS: List[Tuple[float, float]] = [
    (1280.0, 985.0),
    (1215.0, 1030.0),
    (1160.0, 1080.0),
    (1105.0, 1135.0),
    (1095.0, 1200.0),
    (1120.0, 1268.0),
    (1170.0, 1262.0),
    (1182.0, 1205.0),
    (1140.0, 1155.0),
    (1100.0, 1128.0),
    (1040.0, 1122.0),
    (985.0, 1140.0),
]


def brush_underline(
    x0: float = 115.0,
    x1: float = 697.0,
    y: float = 1007.0,
    t0: float = 8.0,
    t1: float = 17.0,
    rise: float = 26.0,
    wobble: float = 1.2,
    seed: int = 42,
    color: str = "#F86036",
    absolute: bool = True,
    canvas_width: int = 1080,
    canvas_height: int = 1350
) -> str:
    """Generate an SVG tapered hand-drawn brush underline polygon."""
    rng = np.random.default_rng(seed)
    num_steps = 25
    xs = np.linspace(x0, x1, num_steps)

    top_points = []
    bot_points = []

    for i, x in enumerate(xs):
        fraction = i / (num_steps - 1)
        cy = y - (rise * fraction)
        t = t0 + (t1 - t0) * (fraction ** 1.2)
        half_t = t / 2.0

        w_top = rng.uniform(-wobble, wobble)
        w_bot = rng.uniform(-wobble, wobble)

        top_points.append((x, cy - half_t + w_top))
        bot_points.append((x, cy + half_t + w_bot))

    # Build rounded right cap
    right_cap = []
    cap_center_x = x1
    cap_center_y = y - rise
    cap_radius = t1 / 2.0
    for ang in np.linspace(-math.pi / 2, math.pi / 2, 7):
        cx = cap_center_x + cap_radius * math.cos(ang)
        cy = cap_center_y + cap_radius * math.sin(ang)
        right_cap.append((cx, cy))

    # Build rounded left cap
    left_cap = []
    l_cap_center_x = x0
    l_cap_center_y = y
    l_cap_radius = t0 / 2.0
    for ang in np.linspace(math.pi / 2, 3 * math.pi / 2, 5):
        cx = l_cap_center_x + l_cap_radius * math.cos(ang)
        cy = l_cap_center_y + l_cap_radius * math.sin(ang)
        left_cap.append((cx, cy))

    all_pts = top_points + right_cap + list(reversed(bot_points)) + left_cap
    pts_str = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in all_pts)

    if absolute:
        svg = (
            f'<svg class="doodle-underline" style="position:absolute;left:0;top:0;width:{canvas_width}px;height:{canvas_height}px;'
            f'pointer-events:none;z-index:2;">'
            f'<polygon points="{pts_str}" fill="{color}" />'
            f'</svg>'
        )
    else:
        # Relative flow SVG
        w = max(100.0, x1 - x0 + 40.0)
        h = max(20.0, y - (y - rise) + t1 + 20.0)
        svg = (
            f'<svg class="doodle-underline" viewBox="{x0 - 10:.1f} {y - rise - t1 - 5:.1f} {w:.1f} {h:.1f}" '
            f'style="width:{w:.1f}px;height:{h:.1f}px;display:block;pointer-events:none;margin-top:24px;margin-bottom:44px;">'
            f'<polygon points="{pts_str}" fill="{color}" />'
            f'</svg>'
        )
    return svg


def catmull_rom_to_bezier(pts: List[Tuple[float, float]]) -> str:
    """Convert a sequence of 2D points to a smooth cubic SVG Bezier path."""
    if len(pts) < 2:
        return ""
    if len(pts) == 2:
        return f"M {pts[0][0]:.1f} {pts[0][1]:.1f} L {pts[1][0]:.1f} {pts[1][1]:.1f}"

    p = [pts[0]] + pts + [pts[-1]]
    d = [f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"]

    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        c1x = p1[0] + (p2[0] - p0[0]) / 6.0
        c1y = p1[1] + (p2[1] - p0[1]) / 6.0
        c2x = p2[0] - (p3[0] - p1[0]) / 6.0
        c2y = p2[1] - (p3[1] - p1[1]) / 6.0
        d.append(f"C {c1x:.1f} {c1y:.1f}, {c2x:.1f} {c2y:.1f}, {p2[0]:.1f} {p2[1]:.1f}")

    return " ".join(d)


def dashed_loop(
    waypoints: List[Tuple[float, float]] | None = None,
    scale: float = 1080.0 / 1280.0,
    dash: str = "22 18",
    width: float = 12.0,
    seed: int = 42,
    color: str = "#F86036",
    canvas_width: int = 1080,
    canvas_height: int = 1350
) -> str:
    """Generate an SVG dashed loop doodle matching ref_06 curl."""
    wps = waypoints or REFERENCE_WAYPOINTS
    rng = np.random.default_rng(seed)

    y_scale = canvas_height / 1350.0
    scaled_pts: List[Tuple[float, float]] = []
    for x, y in wps:
        wx = rng.uniform(-0.8, 0.8)
        wy = rng.uniform(-0.8, 0.8)
        scaled_pts.append(((x * scale) + wx, (y * scale * y_scale) + wy))

    path_data = catmull_rom_to_bezier(scaled_pts)

    svg = f'<svg class="doodle-loop" style="position:absolute;left:0;top:0;width:{canvas_width}px;height:{canvas_height}px;pointer-events:none;z-index:2;">'
    svg += (
        f'<path d="{path_data}" fill="none" stroke="{color}" stroke-width="{width}" '
        f'stroke-dasharray="{dash}" stroke-linecap="round" stroke-linejoin="round" />'
    )
    svg += '</svg>'
    return svg
