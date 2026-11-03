"""Design calibration and comparison tools."""

from pathlib import Path
from PIL import Image
from ..settings import PROJECT_ROOT, OUTPUT_DIR
from .renderer import SlideRenderer

REFERENCE_IMAGE_BEIGE = PROJECT_ROOT / "inspiration" / "ref_06_beige_branding.png"
REFERENCE_IMAGE_GRID = PROJECT_ROOT / "inspiration" / "ref_03_grid_business.png"
REFERENCE_IMAGE_PATH = REFERENCE_IMAGE_BEIGE


def run_design_test(
    out_dir: Path | None = None,
    headline: str | None = None,
    lines_test: bool = False,
    style: str = "beige_grain",
    canvas_format: str = "portrait"
) -> Path:
    """Render cover with reference wording or custom headline and generate compare/overlay images."""
    suffix = f"_{canvas_format}" if canvas_format != "portrait" else ""
    default_dir_name = f"_design_test_grid{suffix}" if style == "grid_pill" else f"_design_test{suffix}"
    target_dir = out_dir or (OUTPUT_DIR / default_dir_name)
    target_dir.mkdir(parents=True, exist_ok=True)

    if style == "grid_pill":
        ref_path = REFERENCE_IMAGE_GRID
        main_headline = headline or "Build a business that works"
        brand_info = {
            "page_name": "MIND DEEDS",
            "handle": "@minddeeds",
            "tag": "BUSINESS"
        }
    else:
        ref_path = REFERENCE_IMAGE_BEIGE
        main_headline = headline or "Branding is more than just looks"
        brand_info = {
            "page_name": "MIND DEEDS",
            "handle": "@minddeeds",
            "tag": "#branding"
        }

    cover_slide = {
        "n": 1,
        "type": "cover",
        "headline": main_headline,
        "claim_ids": []
    }

    renderer = SlideRenderer(style, canvas_format=canvas_format)
    cover_path = target_dir / "cover.png"
    renderer.render_slide(
        slide=cover_slide,
        brand=brand_info,
        total_slides=6,
        seed=20261017,
        out_path=cover_path
    )

    if lines_test:
        test_cases = [
            ("cover_1line.png", "Cash is oxygen"),
            ("cover_3lines.png", "Late payments hurt small businesses"),
            ("cover_5lines.png", "Cash flow habits of small businesses: 2025"),
        ]
        for fname, text in test_cases:
            renderer.render_slide(
                slide={"n": 1, "type": "cover", "headline": text, "claim_ids": []},
                brand=brand_info,
                total_slides=6,
                seed=20261017,
                out_path=target_dir / fname
            )

    # Load reference image and resize to match rendered cover dimensions
    if not ref_path.exists():
        raise FileNotFoundError(f"Reference image not found: {ref_path}")

    our_cover = Image.open(cover_path).convert("RGB")
    cw, ch = our_cover.size
    ref_img = Image.open(ref_path).convert("RGB")
    ref_resized = ref_img.resize((cw, ch), Image.Resampling.LANCZOS)

    # 1. Side-by-side compare.png (cw * 2 x ch)
    compare_img = Image.new("RGB", (cw * 2, ch))
    compare_img.paste(ref_resized, (0, 0))
    compare_img.paste(our_cover, (cw, 0))
    compare_path = target_dir / "compare.png"
    compare_img.save(compare_path, format="PNG")

    # 2. 50% blend overlay.png (cw x ch)
    overlay_img = Image.blend(ref_resized, our_cover, alpha=0.5)
    overlay_path = target_dir / "overlay.png"
    overlay_img.save(overlay_path, format="PNG")

    # 3. grain_compare.png (for beige_grain)
    if style == "beige_grain":
        crop_box = (250, 150, 650, 550)
        ref_crop = ref_resized.crop(crop_box)
        our_crop = our_cover.crop(crop_box)
        grain_compare = Image.new("RGB", (800, 400))
        grain_compare.paste(ref_crop, (0, 0))
        grain_compare.paste(our_crop, (400, 0))
        grain_compare.save(target_dir / "grain_compare.png", format="PNG")

    return target_dir
