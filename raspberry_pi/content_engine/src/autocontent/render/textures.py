"""Paper texture generator mimicking ref_06 beige grain (Version 2 calibrated)."""

from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from ..settings import GENERATED_DIR

TEXTURE_VERSION = 2
BASE_COLOR = np.array([237.0, 227.3, 212.1], dtype=np.float32)
SPECKLE_COLOR = np.array([242, 162, 122], dtype=np.float32)  # #F2A27A


def make_paper(width: int = 1080, height: int = 1350, seed: int = 20261017, cache_dir: Path | None = None) -> Path:
    """Generate deterministic grainy beige paper texture and return file path.
    Version 2 adds bicubic coarser grain and per-channel noise calibrated to ref_06.
    """
    out_dir = cache_dir or GENERATED_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    target_path = out_dir / f"paper_v{TEXTURE_VERSION}_{width}x{height}_{seed}.png"

    if target_path.exists():
        return target_path

    rng = np.random.default_rng(seed)

    # 1. Base canvas
    img_data = np.full((height, width, 3), BASE_COLOR, dtype=np.float32)

    # 2. Coarser sandy grain: half-resolution noise bicubic upscaled
    coarse_h, coarse_w = height // 2, width // 2
    coarse_noise = rng.normal(0.0, 3.2, (coarse_h, coarse_w, 3)).astype(np.float32)
    c_img = Image.fromarray(np.clip(coarse_noise + 128.0, 0, 255).astype(np.uint8)).resize(
        (width, height), Image.Resampling.BICUBIC
    )
    c_arr = np.array(c_img, dtype=np.float32) - 128.0
    img_data += c_arr

    # 3. Fine grain: per-pixel Gaussian noise with per-channel sigma multipliers (blue higher)
    channel_sigmas = np.array([8.8, 9.3, 11.5], dtype=np.float32)
    fine_noise = rng.normal(0.0, 1.0, (height, width, 3)).astype(np.float32) * channel_sigmas
    img_data += fine_noise

    # Soft Gaussian blur
    clipped = np.clip(img_data, 0, 255).astype(np.uint8)
    pil_img = Image.fromarray(clipped).filter(ImageFilter.GaussianBlur(radius=0.45))

    # 4. Sparse speckles: ~0.08% pixels
    arr = np.array(pil_img, dtype=np.float32)
    num_speckles = int(width * height * 0.0008)
    speckle_y = rng.integers(0, height, size=num_speckles)
    speckle_x = rng.integers(0, width, size=num_speckles)
    arr[speckle_y, speckle_x] = (arr[speckle_y, speckle_x] * 0.65) + (SPECKLE_COLOR * 0.35)

    final_img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    final_img.save(target_path, format="PNG")

    return target_path
