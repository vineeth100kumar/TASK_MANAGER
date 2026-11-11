"""Project configuration and path settings."""

from pathlib import Path
import json
import os
from typing import Any, Dict, List
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
BRAND_CONFIG_PATH = CONFIG_DIR / "brand.json"
OUTPUT_DIR = PROJECT_ROOT / "output"
ASSETS_DIR = PROJECT_ROOT / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"
GENERATED_DIR = ASSETS_DIR / "generated"
STYLES_DIR = PROJECT_ROOT / "styles"
# Shared pictures for post specs: a spec can name any file here by its bare name (farm.jpg)
IMAGES_DIR = PROJECT_ROOT / "images"


class CanvasConfig(BaseModel):
    width: int = 1080
    height: int = 1350


class BrandConfig(BaseModel):
    page_name: str = "MIND DEEDS"
    handle: str = "@minddeeds"
    default_tag: str = "#business"
    # Fixed niche hashtag set for every post (topic keywords, NOT grounded in the source)
    hashtags: List[str] = Field(default_factory=lambda: [
        "#business", "#entrepreneurship", "#indianbusiness",
        "#startupindia", "#businessgrowth",
    ])
    cta_headline: str = "Follow for more"
    cta_subtext: str = ""
    # grid_pill CTA pill and the line beside it ("Save this for later", "Share with a founder")
    cta_pill: str = "JOIN US"
    cta_pill_subtext: str = "FOR DAILY STRATEGY"
    canvas: CanvasConfig = Field(default_factory=CanvasConfig)
    # Look of every picture slide that does not set its own, written like the spec fields
    # (filter, dot_size, dot_angle, fit, focus, rounded, border, text_position above|below ...).
    # The default is the black-and-white dotted (halftone) filter with the text below the picture.
    image_defaults: Dict[str, Any] = Field(default_factory=lambda: {"filter": "halftone", "text_position": "below"})


def load_brand_config(config_path: Path | None = None) -> BrandConfig:
    path = config_path or BRAND_CONFIG_PATH
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return BrandConfig(**data)
    return BrandConfig()


def get_env_setting(key: str, default: str = "") -> str:
    # Try dotenv if available
    try:
        from dotenv import load_dotenv
        env_file = PROJECT_ROOT / ".env"
        if env_file.exists():
            load_dotenv(env_file)
    except ImportError:
        pass
    return os.environ.get(key, default)
