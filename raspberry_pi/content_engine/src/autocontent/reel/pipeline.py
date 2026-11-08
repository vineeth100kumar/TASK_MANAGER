"""Script in, reel out. The steps, in order, each reported as a progress line."""

import json
import shutil
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from PIL import Image

from ..progress import report
from . import align as aligner
from . import captions as caps
from . import compose, timing, voice
from .layers import extract_scene
from .script import ReelScript, parse_reel

PosterAt = 1.2   # seconds into the reel for the poster picture: the cover once its headline is up


class ReelError(Exception):
    """A problem with the script or the setup that the author can fix; the message says how."""

    def __init__(self, message: str, issues: Optional[list] = None):
        super().__init__(message)
        self.issues = issues or []


def split_by_scene(times: List[aligner.Timed], scenes) -> List[List[aligner.Timed]]:
    out, i = [], 0
    for sc in scenes:
        n = len(sc.words)
        out.append(times[i:i + n])
        i += n
    return out


def align_tts(track: voice.Track, scenes, backend: str) -> Tuple[List[List[aligner.Timed]], str]:
    """Word times when the voice was made slide by slide: each slide's words are placed inside the
    window where that slide's narration is known to sit."""
    segments = aligner.speech_segments(track.path)
    heard = aligner.recognise(track.path) if backend in ("auto", "whisper") else None
    used = f"whisper ({aligner._model_name})" if heard else "spread"
    out: List[List[aligner.Timed]] = []
    for sc, (a, b) in zip(scenes, track.windows):
        if not sc.say:
            out.append([])
            continue
        words = sc.words
        segs = [(max(s, a), min(e, b)) for s, e in segments if e > a and s < b] or [(a, b)]
        local = [h for h in (heard or []) if h.end > a - 0.1 and h.start < b + 0.1]
        out.append(aligner.match(words, local, segs) if local else aligner.spread(words, segs))
    return out, used


def make_reel(script_text: str, out_dir: Path, *, base_dir: Optional[Path] = None, voice_file: Optional[Path] = None,
              style: Optional[str] = None, tag: Optional[str] = None, backend: str = "auto", fetch_images: bool = True,
              engine: Optional[Callable] = None, preset: str = "veryfast", progress: Callable[[str], None] = report,
              keep_work: bool = False) -> Dict[str, Any]:
    """Make the reel for a script. Returns a summary dict (also written as reel.json)."""
    from ..spec import build_from_spec
    from ..spec.build import SpecError
    from ..render.renderer import SlideRenderer, browser_launch_options
    from playwright.sync_api import sync_playwright

    started = time.time()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)

    progress("Reading the reel script...")
    reel = parse_reel(script_text, base_dir=base_dir)
    for issue in reel.issues:
        progress(f"  {issue}")
    if not reel.ok:
        raise ReelError("The reel script has errors; nothing was made.", [i for i in reel.issues if i.severity == "ERROR"])
    meta = reel.meta
    fps = int(meta["fps"])

    # --- the voice ---
    own = voice_file is not None or reel.uses_own_voice
    if own and not voice_file:
        raise ReelError("The script says `voice: mine`, so it needs your recording; upload it with the script.")
    if own:
        silent = [s.n for s in reel.scenes if not s.say]
        if silent:
            raise ReelError(f"With your own recording every slide needs a `say:` line with the words you speak "
                            f"(slide {', '.join(map(str, silent))} has none).")
        progress("Preparing your recording...")
        track = voice.render_recording(Path(voice_file), work)
    else:
        problem = voice.check_voice(meta["voice"])
        if problem:
            raise ReelError(problem)
        if engine is None:
            ok, why = voice.kokoro_ready()
            if not ok:
                raise ReelError(f"The voice isn't ready on this Pi: {why}. Or record your own and use `voice: mine`.")
        progress(f"Speaking the narration ({meta['voice']})...")
        track = voice.render_tts(reel.scenes, meta["voice"], float(meta["speed"]), work, say=progress, engine=engine)

    # --- when is each word spoken ---
    progress("Finding when each word is spoken...")
    if track.kind == "recording":
        all_words = [w for s in reel.scenes for w in s.words]
        times, used = aligner.align(track.path, all_words, backend)
        per_scene = split_by_scene(times, reel.scenes)
    else:
        per_scene, used = align_tts(track, reel.scenes, backend)
    progress(f"  word timing: {used}")
    spans = [(w[0].start, w[-1].end) if w else None for w in per_scene]
    windows = timing.scene_windows(spans, [s.duration for s in reel.scenes], float(meta["end_hold"]), compose.EXIT)
    total = max(windows[-1][1], track.seconds + 0.3)
    windows[-1] = (windows[-1][0], total)

    # --- the slides, drawn like a post's ---
    progress("Drawing the slides...")
    deck_dir = work / "deck"
    spec_file = work / "reel_spec.md"
    spec_file.write_text(reel.post_text, encoding="utf-8")
    try:
        _, data, _issues = build_from_spec(spec_file, out_dir=deck_dir, style=style, canvas_format="reel", tag=tag,
                                           fetch_images=fetch_images)
    except SpecError as e:
        raise ReelError("The slides have errors; nothing was made.", [i for i in e.issues if i.severity == "ERROR"])
    renderer = SlideRenderer(data.get("style", "grid_pill"), canvas_format="reel")
    renderer.base_dir = deck_dir
    renderer.collect_fit = True
    renderer.fit_report = []
    slides = data["slides"]
    brand, seed = data.get("brand", {}), data.get("seed", 20261017)
    scenes_layers = []
    clips: List[compose.SceneClip] = []
    phrases: List[caps.Phrase] = []
    themes: Dict[int, str] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(**browser_launch_options())
        page = browser.new_page(viewport={"width": compose.W, "height": compose.H}, device_scale_factor=1)
        for i, slide in enumerate(slides):
            progress(f"Cutting slide {i + 1} of {len(slides)} into pieces ({slide.get('type')})...")
            sl = extract_scene(renderer, page, slide, brand, len(slides), seed, work / "layers")
            scenes_layers.append(sl)
            themes[i + 1] = sl.theme
        bad = [r for r in renderer.fit_report if not r["ok"]]
        if bad:
            browser.close()
            raise ReelError("Some slides don't fit the screen: " + " ".join(
                f"Slide {r['n']} ({r['type']}): {'; '.join(r['problems'])}" for r in bad)
                + " Shorten that text and try again.")

        # --- the pieces and when they appear ---
        reveals = []
        for i, (sl, (t0, t1)) in enumerate(zip(scenes_layers, windows)):
            sc = reel.scenes[i]
            primary = [k for k, ly in enumerate(sl.layers) if not ly.follow]
            ts = timing.plan_reveals(len(primary), sc.show, per_scene[i], t0, t1, compose.EXIT)
            at: Dict[int, float] = {}
            for k, t in zip(primary, ts):
                at[k] = t
            for k, ly in enumerate(sl.layers):
                if ly.follow:
                    at[k] = at[k - 1]
            clip = compose.SceneClip(t0=t0, t1=t1, base=Image.open(sl.base).convert("RGB"), motion=sc.motion)
            for k, ly in enumerate(sl.layers):
                clip.pieces.append(compose.Piece(
                    image=Image.open(ly.path).convert("RGBA"), box=ly.box, at=at[k], follow=ly.follow,
                    zoom=(sc.motion == "kenburns" and "image-frame" in ly.classes)))
            clips.append(clip)
            reveals.append([round(at[k], 2) for k in range(len(sl.layers))])

        # --- captions ---
        caption_clips: List[compose.CaptionClip] = []
        if meta.get("captions", "on") != "off":
            progress("Drawing the captions...")
            phrases = caps.make_phrases([(i + 1, w) for i, w in enumerate(per_scene) if w])
            cap_page = browser.new_page(viewport={"width": compose.W, "height": 400}, device_scale_factor=1)
            caps.render_phrases(cap_page, phrases, themes, renderer.league_url, work / "captions", canvas_w=compose.W)
            for ph in phrases:
                for k, w in enumerate(ph.words):
                    end = ph.words[k + 1].start if k + 1 < len(ph.words) else ph.words[-1].end + 0.1
                    start = ph.words[0].start if k == 0 else w.start
                    caption_clips.append(compose.CaptionClip(
                        t0=start, t1=max(end, start + 0.05), image=Image.open(ph.pictures[k]).convert("RGBA"),
                        box=ph.box, first=(k == 0)))
        browser.close()

    # --- the video ---
    timeline = compose.Timeline(clips, caption_clips, total)
    progress(f"Encoding the video ({total:.0f} seconds at {fps} frames a second)...")
    mp4 = out_dir / "reel.mp4"
    last = [-1]

    def encoding(frac: float) -> None:
        pct = int(frac * 100)
        if pct // 10 != last[0] // 10:
            progress(f"  encoding {pct}%")
        last[0] = pct

    compose.encode(timeline, track.path, mp4, fps=fps, progress=encoding, preset=preset)
    poster_path = out_dir / "poster.jpg"
    compose.poster(timeline, min(PosterAt, total - 0.1), poster_path)

    # --- the files that go with it ---
    (out_dir / "caption.txt").write_text(data.get("caption", ""), encoding="utf-8")
    (out_dir / "script.md").write_text(script_text, encoding="utf-8")
    shutil.copy2(track.path, out_dir / "voice.wav")
    summary = {
        "title": meta.get("title") or "Reel", "seconds": round(total, 1), "fps": fps, "scenes": len(slides),
        "voice": "own recording" if track.kind == "recording" else meta["voice"], "wordTiming": used,
        "captions": bool(caption_clips), "size": mp4.stat().st_size, "built": round(time.time() - started, 1),
        "timeline": [{"n": i + 1, "type": slides[i].get("type"), "start": round(a, 2), "end": round(b, 2), "reveals": reveals[i]}
                     for i, (a, b) in enumerate(windows)],
        "warnings": [str(i) for i in reel.issues if i.severity == "WARN"],
    }
    (out_dir / "reel.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    if not keep_work:
        shutil.rmtree(work, ignore_errors=True)
    progress(f"Done: {mp4.name}, {summary['seconds']} seconds, {mp4.stat().st_size / 1e6:.1f} MB.")
    return summary
