"""Chart slides drawn as inline SVG in Python (no JS chart library, no network).

One accent colour marks the highlighted bar/slice/point (the largest value); the rest use a
muted tint of the style's ink. Values are printed exactly as written in the source
(value_raw); bars and lines start at zero; there are no gridlines.
"""

import html
import math
from typing import Any, Dict, List, Sequence

LABEL_PX = 38
VALUE_PX = 52


def _hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _mix(fg: str, bg: str, t: float) -> str:
    """fg blended over bg at opacity t, as hex."""
    f, b = _hex_to_rgb(fg), _hex_to_rgb(bg)
    return "#" + "".join(f"{round(b[i] + (f[i] - b[i]) * t):02x}" for i in range(3))


def _text_w(text: str, px: float, factor: float = 0.56) -> float:
    return len(text) * px * factor


def _esc(s: Any) -> str:
    return html.escape(str(s), quote=True)


def _values(series: Sequence[Dict[str, Any]]) -> List[float]:
    return [float(s.get("value") or 0.0) for s in series]


def _highlight_index(values: List[float]) -> int:
    return max(range(len(values)), key=lambda i: values[i]) if values else 0


def bar_chart_svg(series: Sequence[Dict[str, Any]], colors: Dict[str, str], width: int = 860, max_height: int = 700) -> str:
    """Horizontal bars in source order: label above each bar, the exact value after it."""
    values = _values(series)
    n = len(series)
    hi = _highlight_index(values)
    vmax = max(values) if values and max(values) > 0 else 1.0
    # Compact rows (label, bar, gap) so the chart is rarely scaled down below readable size
    bar_h = 64 if n <= 3 else 52 if n == 4 else 40
    label_gap = 12
    row_h = LABEL_PX + label_gap + bar_h + (34 if n <= 4 else 20)
    value_w = max(_text_w(str(s.get("value_raw", "")), VALUE_PX, 0.66) for s in series) + 40
    bar_max = max(120.0, width - value_w)
    muted = _mix(colors["ink"], colors["bg"], 0.32)
    height = row_h * n

    parts = [f'<svg class="chart-svg" overflow="visible" xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
             f'viewBox="0 0 {width} {height}" role="img">']
    for i, s in enumerate(series):
        y0 = i * row_h
        label_y = y0 + LABEL_PX
        bar_y = label_y + label_gap
        w = max(6.0, bar_max * values[i] / vmax) if values[i] > 0 else 6.0
        fill = colors["accent"] if i == hi else muted
        parts.append(f'<text x="0" y="{label_y}" font-family="Inter, sans-serif" font-weight="600" '
                     f'font-size="{LABEL_PX}" fill="{colors["text"]}">{_esc(s.get("label", ""))}</text>')
        parts.append(f'<rect x="0" y="{bar_y}" width="{w:.1f}" height="{bar_h}" rx="{bar_h // 5}" fill="{fill}"/>')
        parts.append(f'<text x="{w + 18:.1f}" y="{bar_y + bar_h * 0.5 + VALUE_PX * 0.36:.1f}" '
                     f'font-family="League Spartan, sans-serif" font-weight="800" font-size="{VALUE_PX}" '
                     f'fill="{colors["ink"]}">{_esc(s.get("value_raw", ""))}</text>')
    parts.append("</svg>")
    return "".join(parts)


def pie_chart_svg(series: Sequence[Dict[str, Any]], colors: Dict[str, str], width: int = 860, max_height: int = 700) -> str:
    """Donut on the left, legend with exact values on the right. Slices only for the given
    shares; any gap to 100% is left empty, never labelled as 'Others'."""
    values = _values(series)
    n = len(series)
    hi = _highlight_index(values)
    # The legend gets the room its longest label needs; the donut shrinks for it (not below 150)
    legend_px = 36
    legend_w = max(max(_text_w(str(s.get("label", "")), legend_px), _text_w(str(s.get("value_raw", "")), VALUE_PX, 0.66))
                   for s in series)
    r = int(max(150, min(215, (width - 56 - 44 - legend_w - 12) / 2)))
    inner = int(r * 0.56)
    cx, cy = r + 6, r + 6
    shades = [_mix(colors["ink"], colors["bg"], t) for t in (0.55, 0.38, 0.26, 0.17, 0.11)]
    fills = []
    k = 0
    for i in range(n):
        if i == hi:
            fills.append(colors["accent"])
        else:
            fills.append(shades[min(k, len(shades) - 1)])
            k += 1

    legend_x = 2 * r + 56
    row_h = min(120, max(92, (max_height - 20) // max(n, 1)))
    height = max(2 * r + 12, row_h * n)
    parts = [f'<svg class="chart-svg" overflow="visible" xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
             f'viewBox="0 0 {width} {height}" role="img">']
    total = 100.0
    start = -math.pi / 2
    for i, v in enumerate(values):
        sweep = 2 * math.pi * (v / total)
        end = start + sweep
        large = 1 if sweep > math.pi else 0
        x0, y0 = cx + r * math.cos(start), cy + r * math.sin(start)
        x1, y1 = cx + r * math.cos(end), cy + r * math.sin(end)
        xi1, yi1 = cx + inner * math.cos(end), cy + inner * math.sin(end)
        xi0, yi0 = cx + inner * math.cos(start), cy + inner * math.sin(start)
        d = (f"M {x0:.2f} {y0:.2f} A {r} {r} 0 {large} 1 {x1:.2f} {y1:.2f} "
             f"L {xi1:.2f} {yi1:.2f} A {inner} {inner} 0 {large} 0 {xi0:.2f} {yi0:.2f} Z")
        parts.append(f'<path d="{d}" fill="{fills[i]}" stroke="{colors["bg"]}" stroke-width="6" stroke-linejoin="round"/>')
        start = end

    for i, s in enumerate(series):
        y = i * row_h
        parts.append(f'<rect x="{legend_x}" y="{y + 8}" width="28" height="28" rx="6" fill="{fills[i]}"/>')
        parts.append(f'<text x="{legend_x + 44}" y="{y + 34}" font-family="Inter, sans-serif" font-weight="600" '
                     f'font-size="{legend_px}" fill="{colors["text"]}">{_esc(s.get("label", ""))}</text>')
        parts.append(f'<text x="{legend_x + 44}" y="{y + 34 + 54}" font-family="League Spartan, sans-serif" '
                     f'font-weight="800" font-size="{VALUE_PX}" fill="{colors["ink"]}">{_esc(s.get("value_raw", ""))}</text>')
    parts.append("</svg>")
    return "".join(parts)


def line_chart_svg(series: Sequence[Dict[str, Any]], colors: Dict[str, str], width: int = 860, max_height: int = 620) -> str:
    """Same metric over time: zero-based, a value label above each point, period labels below."""
    values = _values(series)
    n = len(series)
    vmax = max(values) if values and max(values) > 0 else 1.0
    top_pad, bottom_pad = VALUE_PX + 30, LABEL_PX + 34
    height = max_height
    plot_h = height - top_pad - bottom_pad
    # room at both ends for the widest value label and period label (centred on the first/last point)
    side = max(max(_text_w(str(s.get("value_raw", "")), VALUE_PX, 0.66) for s in series),
               max(_text_w(str(s.get("label", "")), LABEL_PX) for s in series)) / 2 + 10
    xs = [side + (width - 2 * side) * (i / (n - 1) if n > 1 else 0.5) for i in range(n)]
    ys = [top_pad + plot_h * (1 - v / vmax) for v in values]
    base_y = top_pad + plot_h
    muted = _mix(colors["ink"], colors["bg"], 0.25)

    parts = [f'<svg class="chart-svg" overflow="visible" xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
             f'viewBox="0 0 {width} {height}" role="img">']
    parts.append(f'<line x1="0" y1="{base_y:.1f}" x2="{width}" y2="{base_y:.1f}" stroke="{muted}" stroke-width="3"/>')
    area = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    parts.append(f'<polygon points="{xs[0]:.1f},{base_y:.1f} {area} {xs[-1]:.1f},{base_y:.1f}" '
                 f'fill="{_mix(colors["accent"], colors["bg"], 0.07)}"/>')

    def line_top(x_lo: float, x_hi: float) -> float:
        """Highest point (smallest y) of the line between x_lo and x_hi."""
        top = min(y for x, y in zip(xs, ys) if x_lo <= x <= x_hi) if any(x_lo <= x <= x_hi for x in xs) else base_y
        for k in range(n - 1):
            for x in (x_lo, x_hi):
                if xs[k] <= x <= xs[k + 1] and xs[k + 1] > xs[k]:
                    top = min(top, ys[k] + (ys[k + 1] - ys[k]) * (x - xs[k]) / (xs[k + 1] - xs[k]))
        return top
    parts.append(f'<polyline points="{area}" fill="none" stroke="{colors["ink"]}" stroke-width="6" '
                 f'stroke-linejoin="round" stroke-linecap="round"/>')
    for i, (x, y) in enumerate(zip(xs, ys)):
        last = i == n - 1
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{14 if last else 11}" '
                     f'fill="{colors["accent"] if last else colors["ink"]}" stroke="{colors["bg"]}" stroke-width="4"/>')
        half = _text_w(str(series[i].get("value_raw", "")), VALUE_PX, 0.52) / 2
        label_y = max(VALUE_PX * 0.8, line_top(x - half, x + half) - 30)
        parts.append(f'<text x="{x:.1f}" y="{label_y:.1f}" text-anchor="middle" font-family="League Spartan, sans-serif" '
                     f'font-weight="800" font-size="{VALUE_PX}" fill="{colors["ink"]}">{_esc(series[i].get("value_raw", ""))}</text>')
        parts.append(f'<text x="{x:.1f}" y="{base_y + LABEL_PX + 18:.1f}" text-anchor="middle" font-family="Inter, sans-serif" '
                     f'font-weight="600" font-size="{LABEL_PX}" fill="{colors["text"]}">{_esc(series[i].get("label", ""))}</text>')
    parts.append("</svg>")
    return "".join(parts)


def chart_svg(slide: Dict[str, Any], colors: Dict[str, str], width: int = 860, max_height: int = 700) -> str:
    series = [s for s in (slide.get("series") or []) if isinstance(s, dict)]
    if len(series) < 2:
        return ""
    kind = slide.get("chart_kind", "bar")
    if kind == "pie":
        return pie_chart_svg(series, colors, width, max_height)
    if kind == "line":
        return line_chart_svg(series, colors, width, min(max_height, 620))
    return bar_chart_svg(series, colors, width, max_height)
