"""Style configuration schema and loader for style packs."""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from ..settings import STYLES_DIR


class CanvasConfig(BaseModel):
    width: int = 1080
    height: int = 1350


class StyleColors(BaseModel):
    background: str = "#FFFFFF"
    ink_black: str = "#000000"
    body_ink: str = "#1A1A1A"
    accent: str = "#F86036"
    accent_text: str = "#FFFFFF"
    grid_line: Optional[str] = None
    paper_base: Optional[str] = None
    pill_dark: Optional[str] = "#000000"
    extra: Dict[str, str] = Field(default_factory=dict)


class StyleFonts(BaseModel):
    headline: str = "League Spartan"
    headline_weight: int = 800
    accent_style: str = "normal"
    body: str = "Inter"
    body_weight: int = 500
    header_footer: str = "Inter"


class StyleLayout(BaseModel):
    margin_left: int = 112
    margin_right: int = 112
    content_width: int = 856
    header_y: int = 128
    footer_y: int = 1221
    content_top: int = 260
    cover_top: int = 310
    cta_handle_y: int = 960


CANVAS_FORMATS = {
    "portrait": {
        "width": 1080,
        "height": 1350,
        "header_y": {"beige_grain": 128, "grid_pill": 114},
        "footer_y": {"beige_grain": 1221, "grid_pill": 1215},
        "content_top": {"beige_grain": 260, "grid_pill": 240},
        "cover_top": {"beige_grain": 394, "grid_pill": 310},
        "cover_anchor_y": {"beige_grain": 932, "grid_pill": 1120},
        "cta_anchor_y": {"beige_grain": 870, "grid_pill": 870},
        "cta_handle_y": {"beige_grain": 960, "grid_pill": 960},
        "max_headline_h": 690,
        "max_point_h": 500,
        "max_list_bottom_y": 1130,
        "max_stat_h": 400,
        "max_quote_h": 600,
        "max_cta_h": 450,
    },
    # Instagram Reels / Stories: 9:16. Instagram covers the top ~220 px (profile bar) and the bottom
    # ~420 px (caption, buttons) of a reel, so everything that matters sits between y=240 and y=1480;
    # the lower band is left for the reel's spoken captions.
    "reel": {
        "width": 1080,
        "height": 1920,
        "header_y": {"beige_grain": 250, "grid_pill": 240},
        "footer_y": {"beige_grain": 1480, "grid_pill": 1474},
        "content_top": {"beige_grain": 380, "grid_pill": 360},
        "cover_top": {"beige_grain": 520, "grid_pill": 440},
        "cover_anchor_y": {"beige_grain": 1260, "grid_pill": 1330},
        "cta_anchor_y": {"beige_grain": 1000, "grid_pill": 1000},
        "cta_handle_y": {"beige_grain": 1120, "grid_pill": 1120},
        "type_scale": 1.2,
        "table_fs": 54,
        "compare_fs": 50,
        # a full-screen video reads best with the block in the middle of the safe area, not hung from the top
        "default_align": {k: "center" for k in ("point", "list", "stat", "quote", "table", "chart", "image", "statement", "compare")},
        "cover_fill": (300, 1420, 290),
        "statement_h": (800, 1060),
        "statement_body_h": 300,
        "max_headline_h": 900,
        "max_point_h": 760,
        "max_list_bottom_y": 1380,
        "max_stat_h": 560,
        "max_quote_h": 820,
        "max_cta_h": 640,
    },
    "square": {
        "width": 1080,
        "height": 1080,
        "header_y": {"beige_grain": 100, "grid_pill": 90},
        "footer_y": {"beige_grain": 970, "grid_pill": 965},
        "content_top": {"beige_grain": 190, "grid_pill": 180},
        "cover_top": {"beige_grain": 260, "grid_pill": 220},
        "cover_anchor_y": {"beige_grain": 760, "grid_pill": 890},
        "cta_anchor_y": {"beige_grain": 700, "grid_pill": 700},
        "cta_handle_y": {"beige_grain": 760, "grid_pill": 760},
        "max_headline_h": 520,
        "max_point_h": 380,
        "max_list_bottom_y": 890,
        "max_stat_h": 320,
        "max_quote_h": 460,
        "max_cta_h": 360,
    }
}


class StyleConfig(BaseModel):
    name: str
    display_name: str
    canvas_format: str = "portrait"
    canvas: CanvasConfig = Field(default_factory=CanvasConfig)
    colors: StyleColors = Field(default_factory=StyleColors)
    fonts: StyleFonts = Field(default_factory=StyleFonts)
    layout: StyleLayout = Field(default_factory=StyleLayout)
    supported_slide_types: List[str] = Field(
        default_factory=lambda: ["cover", "point", "list", "stat", "quote", "chart", "cta"]
    )

    def to_css_variables(self) -> str:
        """Generate CSS custom properties (:root variables) for this style."""
        vars_dict = {
            "--canvas-width": f"{self.canvas.width}px",
            "--canvas-height": f"{self.canvas.height}px",
            "--color-bg": self.colors.background,
            "--color-ink": self.colors.ink_black,
            "--color-body": self.colors.body_ink,
            "--color-accent": self.colors.accent,
            "--color-accent-text": self.colors.accent_text,
            "--color-pill-dark": self.colors.pill_dark or "#000000",
            "--font-headline": f"'{self.fonts.headline}', sans-serif",
            "--font-headline-weight": str(self.fonts.headline_weight),
            "--font-accent-style": self.fonts.accent_style,
            "--font-body": f"'{self.fonts.body}', sans-serif",
            "--font-body-weight": str(self.fonts.body_weight),
            "--font-meta": f"'{self.fonts.header_footer}', sans-serif",
            "--margin-left": f"{self.layout.margin_left}px",
            "--margin-right": f"{self.layout.margin_right}px",
            "--content-width": f"{self.layout.content_width}px",
            "--header-y": f"{self.layout.header_y}px",
            "--footer-y": f"{self.layout.footer_y}px",
            "--content-top": f"{self.layout.content_top}px",
            "--cover-top": f"{self.layout.cover_top}px",
            "--cta-handle-y": f"{self.layout.cta_handle_y}px",
        }
        if self.colors.grid_line:
            vars_dict["--color-grid-line"] = self.colors.grid_line
        if self.colors.paper_base:
            vars_dict["--color-paper-base"] = self.colors.paper_base

        lines = [f"  {k}: {v};" for k, v in vars_dict.items()]
        return ":root {\n" + "\n".join(lines) + "\n}"


def load_style_config(style_name: str, format_name: str = "portrait") -> StyleConfig:
    """Load style configuration from styles/<style_name>/style.json with optional canvas format."""
    style_dir = STYLES_DIR / style_name
    config_file = style_dir / "style.json"
    if not config_file.exists():
        raise FileNotFoundError(f"Style pack '{style_name}' not found at {style_dir}")

    with open(config_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Normalize colors for backwards compatibility
    colors_data = data.get("colors", {})
    if "paper_base" in colors_data and "background" not in colors_data:
        colors_data["background"] = colors_data["paper_base"]
    if "accent_orange" in colors_data and "accent" not in colors_data:
        colors_data["accent"] = colors_data["accent_orange"]

    canvas_dict = data.get("canvas", {"width": 1080, "height": 1350})
    layout_dict = data.get("layout", {})

    fmt = format_name.lower()
    if fmt in CANVAS_FORMATS:
        preset = CANVAS_FORMATS[fmt]
        canvas_dict["width"] = preset["width"]
        canvas_dict["height"] = preset["height"]
        if style_name in preset.get("header_y", {}):
            layout_dict["header_y"] = preset["header_y"][style_name]
        if style_name in preset.get("footer_y", {}):
            layout_dict["footer_y"] = preset["footer_y"][style_name]
        if style_name in preset.get("content_top", {}):
            layout_dict["content_top"] = preset["content_top"][style_name]
        if style_name in preset.get("cover_top", {}):
            layout_dict["cover_top"] = preset["cover_top"][style_name]
        if style_name in preset.get("cta_handle_y", {}):
            layout_dict["cta_handle_y"] = preset["cta_handle_y"][style_name]

    return StyleConfig(
        name=data.get("name", style_name),
        display_name=data.get("display_name", style_name.replace("_", " ").title()),
        canvas_format=fmt,
        canvas=CanvasConfig(**canvas_dict),
        colors=StyleColors(**colors_data),
        fonts=StyleFonts(**data.get("fonts", {})),
        layout=StyleLayout(**layout_dict),
        supported_slide_types=data.get(
            "supported_slide_types",
            ["cover", "point", "list", "stat", "quote", "chart", "cta"]
        )
    )


def list_available_styles() -> List[str]:
    """List all available style packs found in styles/ directory."""
    if not STYLES_DIR.exists():
        return []
    styles = []
    for d in STYLES_DIR.iterdir():
        if d.is_dir() and (d / "style.json").exists():
            styles.append(d.name)
    return sorted(styles)
