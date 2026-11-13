"""Reels: the same Markdown spec as a carousel post, plus the words to say, turned into a 9:16 video.

A reel script is a post spec (see spec/) with a few extra lines per slide (`say:`, `show:`, `motion:`)
and a few extra header lines (`voice:`, `captions:`, `fps:`). The slides are drawn by the same renderer
as a post, then cut into layers that appear one after another in time with the voice-over, and encoded
as one H.264/AAC mp4. See REEL_FORMAT.md.
"""

from .script import ReelScript, Scene, parse_reel, is_reel_text, check_reel
from .objects import SceneObject, parse_objects, SHAPES

__all__ = ["ReelScript", "Scene", "parse_reel", "is_reel_text", "check_reel",
           "SceneObject", "parse_objects", "SHAPES"]


def make_reel(*args, **kwargs):
    """See pipeline.make_reel (imported on use: it needs Playwright and ffmpeg)."""
    from .pipeline import make_reel as _make
    return _make(*args, **kwargs)
