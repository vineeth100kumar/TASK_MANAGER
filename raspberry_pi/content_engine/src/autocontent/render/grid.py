"""Architectural grid and vector element generators for grid_pill style."""

import base64
from typing import Optional


def make_grid_svg(
    size: int = 135,
    line_color: str = "#E8E8E8",
    stroke_width: float = 2.2
) -> str:
    """Generate minimal repeating SVG tile for architectural grid."""
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <path d="M {size} 0 L 0 0 0 {size}" fill="none" stroke="{line_color}" stroke-width="{stroke_width}" />
</svg>"""
    return svg


def make_grid_data_url(
    width: int = 1080,
    height: int = 1350,
    grid_size: int = 135,
    line_color: str = "#E8E8E8",
    bg_color: str = "#FFFFFF",
    line_width: float = 2.2
) -> str:
    """Generate base64 data URL for repeating grid background tile."""
    svg_str = make_grid_svg(size=grid_size, line_color=line_color, stroke_width=line_width)
    b64 = base64.b64encode(svg_str.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


def grid_dashed_loop(
    color: str = "#EE4425",
    stroke_width: float = 7.0,
    dash_array: str = "16 16",
    seed: int = 42,
    width: int = 1080,
    height: int = 1350
) -> str:
    """Generate signature red dashed loop doodle positioned beside the accent pill (ref_03).

    Coordinates in 1080x1350 (portrait) or 1080x1080 (square) canvas:
    Positioned strictly to the right side (x >= 730), clear of headline text and accent pill.
    """
    if height == 1080:
        d = (
            "M 740 824 C 800 828, 860 828, 930 804 "
            "C 985 784, 1025 736, 1020 664 C 1015 592, 970 552, 920 555 "
            "C 865 560, 830 608, 835 672 C 840 728, 875 748, 915 752 "
            "C 960 756, 1000 772, 1080 776"
        )
    else:
        d = (
            "M 740 1020 C 800 1025, 860 1025, 930 995 "
            "C 995 970, 1040 910, 1030 830 C 1020 750, 975 710, 920 720 "
            "C 865 730, 825 790, 830 860 C 835 920, 875 945, 920 950 "
            "C 965 955, 1010 970, 1080 975"
        )

    svg = f"""<svg class="grid-dashed-loop" xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {width} {height}"
     style="position:absolute;top:0;left:0;width:{width}px;height:{height}px;pointer-events:none;z-index:4;">
  <path d="{d}"
        fill="none"
        stroke="{color}"
        stroke-width="{stroke_width}"
        stroke-linecap="round"
        stroke-dasharray="{dash_array}" />
</svg>"""
    return svg


def arrow_button_svg(
    width: int = 124,
    height: int = 68,
    stroke: str = "#000000",
    stroke_width: float = 3.5,
    arrow_color: str = "#000000"
) -> str:
    """Generate footer outline pill button containing an arrow pointing right (ref_03)."""
    rx = height / 2.0
    ax_start = 40
    ax_end = 84
    ay = height / 2.0
    head_len = 13

    svg = f"""<svg class="arrow-pill-button" xmlns="http://www.w3.org/2000/svg"
     width="{width}" height="{height}" viewBox="0 0 {width} {height}"
     style="display:inline-block;vertical-align:middle;">
  <rect x="{stroke_width/2}" y="{stroke_width/2}"
        width="{width - stroke_width}" height="{height - stroke_width}"
        rx="{rx}" ry="{rx}"
        fill="none" stroke="{stroke}" stroke-width="{stroke_width}" />
  <line x1="{ax_start}" y1="{ay}" x2="{ax_end}" y2="{ay}"
        stroke="{arrow_color}" stroke-width="{stroke_width}" stroke-linecap="round" />
  <polyline points="{ax_end - head_len},{ay - head_len/1.3} {ax_end},{ay} {ax_end - head_len},{ay + head_len/1.3}"
            fill="none" stroke="{arrow_color}" stroke-width="{stroke_width}"
            stroke-linecap="round" stroke-linejoin="round" />
</svg>"""
    return svg
