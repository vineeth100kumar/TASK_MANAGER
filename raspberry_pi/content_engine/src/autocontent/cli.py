"""CLI interface for Mind Deeds Auto Content Generator."""

import sys
from pathlib import Path
import json
import typer
from typing import Optional

from .settings import (
    PROJECT_ROOT, FONTS_DIR, OUTPUT_DIR, get_env_setting, load_brand_config
)
from .pipeline.run import run_pipeline, _build_grounding_report
from .pipeline.audit import audit_deck_folder
from .render.renderer import SlideRenderer
from .render.compare import run_design_test
from .validators.deck import validate_deck
from .pipeline.extract_claims import Claim
from .llm.limiter import RateLimiter, USAGE_PATH
from .progress import report

app = typer.Typer(help="Mind Deeds Auto Content Generator CLI")

SUPPORTED_INPUTS = {".docx", ".pdf", ".txt", ".md", ".markdown"}
MODES = {"auto", "keep", "summarize"}


def _fail(msg: str, hint: Optional[str] = None, code: int = 1) -> None:
    """Print a clear error (and an optional next step) and exit."""
    typer.secho(f"Error: {msg}", fg=typer.colors.RED, err=True)
    if hint:
        typer.secho(f"  -> {hint}", fg=typer.colors.YELLOW, err=True)
    raise typer.Exit(code=code)


def _check_style_and_format(style: str, canvas_format: Optional[str]) -> None:
    from .render.style_config import list_available_styles, CANVAS_FORMATS
    styles = list_available_styles()
    if styles and style not in styles:
        _fail(f"Unknown style '{style}'.", f"Available styles: {', '.join(styles)}")
    if canvas_format is not None and canvas_format not in CANVAS_FORMATS:
        _fail(f"Unknown format '{canvas_format}'.", f"Available formats: {', '.join(CANVAS_FORMATS)}")


def _render_or_explain(renderer: SlideRenderer, data: dict, out_folder: Path) -> list:
    """Render slides, turning the common Playwright setup failure into one actionable line."""
    try:
        return renderer.render_deck(data, out_folder)
    except Exception as e:
        text = str(e)
        if "Executable doesn't exist" in text or "playwright install" in text:
            _fail("Chromium for Playwright is not installed.", "Run: python -m playwright install chromium")
        _fail(f"Rendering failed: {text.splitlines()[0] if text else e}",
              f"Slide text is saved; fix it in {out_folder / 'slides.json'} and run the render command.")


def _open_folder(folder: Path) -> None:
    try:
        if sys.platform.startswith("win"):
            import os
            os.startfile(str(folder))  # type: ignore[attr-defined]
        else:
            import subprocess
            subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(folder)], check=False)
    except Exception:
        pass


@app.command()
def doctor():
    """Verify environment, dependencies, fonts, Chromium, and configuration."""
    from .doctor import run_checks, usage_today
    typer.secho("--- Mind Deeds Environment Doctor ---", bold=True, fg=typer.colors.CYAN)
    marks = {"ok": ("[OK]", typer.colors.GREEN), "warn": ("[!]", typer.colors.YELLOW), "fail": ("[FAIL]", typer.colors.RED)}
    checks = run_checks()
    for c in checks:
        mark, color = marks[c["status"]]
        typer.secho(f"{mark} {c['name']}: {c['detail']}", fg=color)
    all_ok = not any(c["status"] == "fail" for c in checks)

    usage = usage_today()
    typer.echo("")
    typer.secho(f"--- TODAY'S GROQ USAGE (UTC {usage.get('date_utc', 'N/A')}) ---", bold=True, fg=typer.colors.CYAN)
    per_model = usage.get("per_model", {})
    if not per_model:
        typer.echo("No Groq API calls recorded today.")
    else:
        for m_name, stats in per_model.items():
            typer.echo(f"  - {m_name}: {stats.get('requests', 0)} requests, {stats.get('tokens', 0)} tokens")

    typer.echo("")
    typer.secho("--- PRIVACY NOTICE ---", bold=True, fg=typer.colors.YELLOW)
    typer.echo(
        "Groq is a cloud service. Before feeding confidential company or client\n"
        "reports to it, review Groq's current data-usage policy.\n"
        "Use --provider ollama or --no-llm for completely local, zero-leak processing."
    )
    typer.echo("")

    if all_ok:
        typer.secho("Doctor checklist complete: All essential components are READY.", bold=True, fg=typer.colors.GREEN)
    else:
        typer.secho("Doctor checklist failed: Please resolve items marked [FAIL].", bold=True, fg=typer.colors.RED)
        raise typer.Exit(code=1)


@app.command("design-test")
def design_test(
    headline: Optional[str] = typer.Option(None, "--headline", help="Custom headline to test"),
    lines_test: bool = typer.Option(False, "--lines-test", help="Render 1, 3, and 5 line headline tests"),
    style: str = typer.Option("beige_grain", "--style", help="Style pack to test: beige_grain | grid_pill"),
    format: str = typer.Option("portrait", "--format", "-f", help="Canvas format preset: portrait | square"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Output directory")
):
    """Calibrate visual design against reference image (ref_06_beige_branding or ref_03_grid_business)."""
    typer.secho(f"Running visual design calibration test for '{style}' ({format})...", fg=typer.colors.CYAN)
    out_dir = run_design_test(out_dir=out, headline=headline, lines_test=lines_test, style=style, canvas_format=format)
    typer.secho(f"Design test generated successfully in {out_dir}:", fg=typer.colors.GREEN)
    typer.echo(f"  - Our cover:    {out_dir / 'cover.png'}")
    typer.echo(f"  - Side-by-side: {out_dir / 'compare.png'}")
    typer.echo(f"  - 50% overlay:  {out_dir / 'overlay.png'}")
    typer.echo("\nOpen compare.png and overlay.png to visually evaluate design alignment.")


@app.command()
def audit(
    post_folder: Path = typer.Argument(..., help="Path to output post folder containing slides.json and 01_units.json")
):
    """Run automated deterministic faithfulness audit on a generated deck."""
    typer.secho(f"Running faithfulness audit on {post_folder}...", fg=typer.colors.CYAN)
    try:
        is_pass, report_text = audit_deck_folder(post_folder)
        if is_pass:
            typer.secho("AUDIT RESULT: PASS", bold=True, fg=typer.colors.GREEN)
            typer.echo(f"Audit report saved to: {post_folder / 'audit.md'}")
            raise typer.Exit(code=0)
        else:
            typer.secho("AUDIT RESULT: FAIL", bold=True, fg=typer.colors.RED)
            typer.echo(f"Audit report with reasons saved to: {post_folder / 'audit.md'}")
            raise typer.Exit(code=2)
    except typer.Exit:
        raise
    except Exception as e:
        typer.secho(f"Audit failed with error: {e}", fg=typer.colors.RED)
        raise typer.Exit(code=2)


@app.command()
def run(
    file_path: Path = typer.Argument(..., help="Path to input document (.docx, .pdf, .txt, .md, .markdown)"),
    mode: str = typer.Option("auto", "--mode", "-m", help="Processing mode: auto | keep | summarize"),
    slides: int = typer.Option(8, "--slides", "-s", help="Total number of slides (5 to 10)"),
    tag: Optional[str] = typer.Option(None, "--tag", "-t", help="Topic hashtag, e.g. #cashflow"),
    no_llm: bool = typer.Option(False, "--no-llm", help="Force deterministic extractive mode (zero AI)"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p", help="LLM provider: groq | ollama | gemini"),
    allow_fail: bool = typer.Option(False, "--allow-fail", help="Force image rendering even if validation fails"),
    style: Optional[str] = typer.Option(None, "--style", help="Visual style pack: beige_grain (default) | grid_pill"),
    format: Optional[str] = typer.Option(None, "--format", "-f", help="Canvas format preset: portrait (1080x1350, default) | square (1080x1080) | reel (1080x1920)"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Custom output directory"),
    open_folder: bool = typer.Option(False, "--open", help="Open the output folder when done"),
    as_spec: bool = typer.Option(False, "--spec", help="Treat the file as a post spec even if it has no 'autocontent: post' header")
):
    """Generate Instagram carousel PNGs from a business report, or build one exactly from a post spec (.md)."""
    if not file_path.exists():
        _fail(f"Input file not found: {file_path}", "Check the path; wrap it in quotes if it contains spaces.")
    if file_path.suffix.lower() not in SUPPORTED_INPUTS:
        _fail(f"Unsupported file type '{file_path.suffix}'.", f"Use one of: {', '.join(sorted(SUPPORTED_INPUTS))}")
    from .spec import is_spec_file
    if as_spec or is_spec_file(file_path):
        _run_spec(file_path, style, format, tag, out, open_folder, require_marker=not as_spec)
        return
    style = style or "beige_grain"
    format = format or "portrait"
    if mode not in MODES:
        _fail(f"Unknown mode '{mode}'.", f"Use one of: {', '.join(sorted(MODES))}")
    if slides < 5 or slides > 10:
        _fail("--slides must be between 5 and 10.")
    _check_style_and_format(style, format)

    typer.echo(f"Processing: {file_path} (mode: {mode}, slides: {slides}, style: {style}, format: {format})")

    try:
        out_folder, slides_data, report_md = run_pipeline(
            file_path=file_path,
            mode=mode,
            slide_count=slides,
            tag=tag,
            no_llm=no_llm,
            provider=provider,
            allow_fail=allow_fail,
            out_dir=out,
            style=style,
            canvas_format=format
        )
    except SystemExit as se:
        raise typer.Exit(code=se.code)

    # Render PNGs
    report(f"Rendering {len(slides_data['slides'])} slide PNGs ({style} style, {format} format)...")
    renderer = SlideRenderer(style, canvas_format=format)
    rendered_pngs = _render_or_explain(renderer, slides_data, out_folder)

    # Generate contact sheet
    from .render.renderer import make_contact_sheet
    report("Building contact sheet...")
    make_contact_sheet(rendered_pngs, out_folder / "contact_sheet.png")

    typer.secho(f"\nCompleted successfully! Generated {len(rendered_pngs)} slides in:", fg=typer.colors.GREEN)
    typer.echo(f"Folder: {out_folder}")
    typer.echo(f"Report: {out_folder / 'grounding_report.md'}")
    typer.echo(f"Contact Sheet: {out_folder / 'contact_sheet.png'}")

    typer.echo("\nSlide Status:")
    for s in slides_data["slides"]:
        st = s.get("source_status", "unknown")
        h = s.get('headline', '').replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '--')
        try:
            typer.echo(f"  Slide {s['n']} ({s['type']}): [{st}] - {h}")
        except Exception:
            typer.echo(f"  Slide {s['n']} ({s['type']}): [{st}] - {h.encode('ascii', errors='replace').decode('ascii')}")

    # Independent faithfulness audit, so every run ends with a verdict
    report("Running faithfulness audit...")
    try:
        audit_pass, _ = audit_deck_folder(out_folder)
    except Exception as e:
        audit_pass = None
        typer.secho(f"\nAudit could not run: {e}", fg=typer.colors.YELLOW)
    report("Audit verdict: " + {True: "PASS", False: "FAIL", None: "not available"}[audit_pass])
    if audit_pass is True:
        typer.secho(f"\nAUDIT: PASS  ({out_folder / 'audit.md'})", bold=True, fg=typer.colors.GREEN)
    elif audit_pass is False:
        typer.secho(f"\nAUDIT: FAIL  - read {out_folder / 'audit.md'} before posting", bold=True, fg=typer.colors.RED)

    typer.echo("\nReview loop hint:")
    typer.echo(f"Edit {out_folder / 'slides.json'} then run:")
    typer.echo(f"  python -m autocontent render \"{out_folder}\"\n")
    if open_folder:
        _open_folder(out_folder)
    if audit_pass is False:
        raise typer.Exit(code=2)


def _print_spec_issues(issues) -> None:
    for i in issues:
        color = typer.colors.RED if i.severity == "ERROR" else typer.colors.YELLOW
        try:
            typer.secho(f"  {i}", fg=color, err=True)
        except UnicodeEncodeError:
            typer.secho(f"  {i}".encode("ascii", errors="replace").decode("ascii"), fg=color, err=True)


def _render_spec_deck(data: dict, out_folder: Path) -> list:
    """Render a spec deck, measuring every slide's layout into fit_report.json."""
    renderer = SlideRenderer(data.get("style", "grid_pill"), canvas_format=data.get("canvas_format", "portrait"))
    renderer.base_dir = out_folder
    renderer.collect_fit = True
    pngs = _render_or_explain(renderer, data, out_folder)
    (out_folder / "fit_report.json").write_text(json.dumps(
        {"slide_count": len(data.get("slides", [])), "slides": renderer.fit_report}, indent=2, ensure_ascii=False),
        encoding="utf-8")
    for r in renderer.fit_report:
        for p in r["problems"]:
            report(f"Layout problem on slide {r['n']} ({r['type']}): {p}")
    return pngs


def _run_spec(file_path: Path, style: Optional[str], canvas_format: Optional[str], tag: Optional[str],
              out: Optional[Path], open_folder: bool, require_marker: bool = True) -> None:
    """`run` for a post spec: parse, check, write the deck folder, render, audit. No AI."""
    from .spec.build import build_from_spec, SpecError
    if style or canvas_format:
        _check_style_and_format(style or "grid_pill", canvas_format)
    typer.echo(f"Post spec detected: {file_path} (built exactly as written; no AI)")
    try:
        out_folder, data, issues = build_from_spec(file_path, out_dir=out, style=style, canvas_format=canvas_format,
                                                   tag=tag, require_marker=require_marker)
    except SpecError as e:
        typer.secho("The post spec has errors; nothing was rendered:", fg=typer.colors.RED, err=True)
        _print_spec_issues([i for i in e.issues if i.severity == "ERROR"])
        _fail("Fix the errors above in the spec file and run again.",
              "See POST_FORMAT.md for the format; `python -m autocontent spec-check <file>` checks it without rendering.")
    _check_style_and_format(data["style"], data["canvas_format"])

    report(f"Rendering {len(data['slides'])} slide PNGs ({data['style']} style, {data['canvas_format']} format)...")
    pngs = _render_spec_deck(data, out_folder)
    from .render.renderer import make_contact_sheet
    make_contact_sheet(pngs, out_folder / "contact_sheet.png")

    typer.secho(f"\nCompleted! Generated {len(pngs)} slides in:", fg=typer.colors.GREEN)
    typer.echo(f"Folder: {out_folder}")
    typer.echo(f"Caption: {out_folder / 'caption.txt'}")
    for s in data["slides"]:
        h = (s.get("headline") or s.get("number") or s.get("body") or "").replace("‑", "-")
        typer.echo(f"  Slide {s['n']} ({s['type']}): {h[:70].encode('ascii', errors='replace').decode('ascii')}")

    report("Running post audit...")
    try:
        audit_pass, _ = audit_deck_folder(out_folder)
    except Exception as e:
        audit_pass = None
        typer.secho(f"\nAudit could not run: {e}", fg=typer.colors.YELLOW)
    report("Audit verdict: " + {True: "PASS", False: "FAIL", None: "not available"}[audit_pass])
    if audit_pass is True:
        typer.secho(f"\nAUDIT: PASS  ({out_folder / 'audit.md'})", bold=True, fg=typer.colors.GREEN)
    elif audit_pass is False:
        typer.secho(f"\nAUDIT: FAIL  - read {out_folder / 'audit.md'} before posting", bold=True, fg=typer.colors.RED)
    if open_folder:
        _open_folder(out_folder)
    if audit_pass is False:
        raise typer.Exit(code=2)


@app.command("spec-check")
def spec_check(
    file_path: Path = typer.Argument(..., help="Path to a post spec (.md)")
):
    """Check a post spec without rendering: every error and warning with its line number."""
    from .spec import parse_spec, issues_summary, is_spec_file
    if not file_path.exists():
        _fail(f"File not found: {file_path}")
    spec = parse_spec(file_path.read_text(encoding="utf-8-sig", errors="replace"), base_dir=file_path.resolve().parent,
                      require_marker=False)
    if not is_spec_file(file_path):
        typer.secho("This file has no 'autocontent: post' header, so `run` treats it as an ordinary report "
                    "(add the header, or use `run --spec`).", fg=typer.colors.YELLOW)
    typer.echo(f"{file_path.name}: {len(spec.slides)} slides, {issues_summary(spec.issues)}")
    for n, s in enumerate(spec.slides, start=1):
        title = (s.get("headline") or s.get("number") or s.get("body") or s.get("image") or "")[:60]
        typer.echo(f"  {n:2d}. {s['type']:<6} {title.replace('==', '').replace('**', '').encode('ascii', errors='replace').decode('ascii')}")
    _print_spec_issues(spec.issues)
    if spec.ok:
        typer.secho("Spec OK: ready to render with `python -m autocontent run`.", fg=typer.colors.GREEN)
    else:
        raise typer.Exit(code=1)


@app.command()
def render(
    slides_json: Path = typer.Argument(..., help="Path to edited slides.json (or the deck folder)"),
    format: Optional[str] = typer.Option(None, "--format", "-f", help="Canvas format preset: portrait | square (defaults to slides.json format)"),
    strict: bool = typer.Option(False, "--strict", help="Fail and abort if any validation error is detected")
):
    """Re-render slide PNGs from an edited slides.json file."""
    if slides_json.is_dir():
        slides_json = slides_json / "slides.json"
    if not slides_json.exists():
        _fail(f"{slides_json} does not exist.", "Pass a deck folder or its slides.json.")

    try:
        with open(slides_json, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        _fail(f"slides.json is not valid JSON (line {e.lineno}, column {e.colno}): {e.msg}",
              "A missing comma or quote after an edit is the usual cause.")

    slides = data.get("slides", [])
    if data.get("mode_used") == "spec":
        # Spec decks: the author's facts are trusted; re-check lengths, charts, images and layout
        from .spec.build import deck_checks
        out_dir = slides_json.parent
        issues = deck_checks(out_dir, data)
        _print_spec_issues(issues)
        if strict and any(i.severity == "ERROR" for i in issues):
            typer.secho("Strict mode enabled: rendering aborted due to spec errors.", fg=typer.colors.RED)
            raise typer.Exit(code=1)
        if format:
            data["canvas_format"] = format
        _check_style_and_format(data.get("style", "grid_pill"), data.get("canvas_format", "portrait"))
        rendered_pngs = _render_spec_deck(data, out_dir)
        from .render.renderer import make_contact_sheet
        make_contact_sheet(rendered_pngs, out_dir / "contact_sheet.png")
        typer.secho(f"Re-rendered {len(rendered_pngs)} slides in {out_dir}", fg=typer.colors.GREEN)
        return
    claims_list = data.get("claims", [])
    claims_map = {c["id"]: c["quote"] for c in claims_list}
    claims_obj_map = {c["id"]: Claim(**c) for c in claims_list}

    # Re-run validation against the whole source (as the audit does), else the claims alone
    full_source_text = " ".join(claims_map.values())
    units_file = slides_json.parent / "01_units.json"
    if units_file.exists():
        try:
            units_data = json.loads(units_file.read_text(encoding="utf-8"))
            units_data = units_data.get("units", units_data) if isinstance(units_data, dict) else units_data
            full_source_text = " ".join(u["text"] for u in units_data)
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    claim_about = {c["id"]: c.get("about", []) for c in claims_list}
    val_report = validate_deck(slides, claims_map, full_source_text, claim_about)

    has_errors = False
    for res in val_report.slides:
        if res.has_error:
            has_errors = True
            typer.secho(f"Validation Warning on Slide {res.slide_n}:", fg=typer.colors.YELLOW)
            for iss in res.issues:
                typer.echo(f"  [{iss['severity']}] {iss['message']}")
            if res.slide_n <= len(slides):
                slides[res.slide_n - 1]["source_status"] = "user_override"

    if has_errors and strict:
        typer.secho("Strict mode enabled: rendering aborted due to validation errors.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    canvas_format = format or data.get("canvas_format", "portrait")
    data["canvas_format"] = canvas_format
    out_dir = slides_json.parent
    _check_style_and_format(data.get("style", "beige_grain"), canvas_format)
    renderer = SlideRenderer(data.get("style", "beige_grain"), canvas_format=canvas_format)
    rendered_pngs = _render_or_explain(renderer, data, out_dir)
    from .render.renderer import make_contact_sheet
    make_contact_sheet(rendered_pngs, out_dir / "contact_sheet.png")

    # Regenerate grounding report
    report_md = _build_grounding_report(
        slides=slides,
        claims_by_id=claims_obj_map,
        val_report=val_report,
        final_verdicts={},
        mode_used=data.get("mode_used", "manual"),
        source_filename=data.get("source_file", "unknown")
    )
    with open(out_dir / "grounding_report.md", "w", encoding="utf-8") as f:
        f.write(report_md)

    typer.secho(f"Re-rendered {len(rendered_pngs)} slides in {out_dir}", fg=typer.colors.GREEN)


@app.command("eval")
def eval_benchmark(
    fixtures: Optional[Path] = typer.Option(None, "--fixtures", "-f", help="Directory containing benchmark fixtures"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p", help="LLM provider: groq | ollama | gemini"),
    no_llm: bool = typer.Option(False, "--no-llm", help="Force deterministic extractive evaluation (zero AI)"),
    style: str = typer.Option("beige_grain", "--style", help="Visual style pack: beige_grain | grid_pill"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Evaluation output directory")
):
    """Run benchmark evaluation across diverse document types."""
    typer.secho(f"Running Mind Deeds Benchmark Evaluation ({style} style)...", bold=True, fg=typer.colors.CYAN)
    try:
        from .pipeline.eval import run_evaluation
        all_passed, scorecard_path = run_evaluation(
            fixtures_dir=fixtures,
            provider=provider,
            out_dir=out,
            no_llm=no_llm,
            style=style
        )
        with open(scorecard_path, "r", encoding="utf-8") as sc:
            typer.echo(sc.read())

        if all_passed:
            typer.secho(f"Evaluation completed successfully! Scorecard saved to: {scorecard_path}", fg=typer.colors.GREEN)
        else:
            typer.secho(f"Evaluation finished with failures. See scorecard at: {scorecard_path}", fg=typer.colors.RED)
            raise typer.Exit(code=2)
    except typer.Exit:
        raise
    except Exception as e:
        typer.secho(f"Evaluation benchmark failed with error: {e}", fg=typer.colors.RED)
        raise typer.Exit(code=1)



@app.command("reel-check")
def reel_check(file_path: Path = typer.Argument(..., help="Path to a reel script (.md)")):
    """Check a reel script without making it: every error and warning, and about how long it will run."""
    from .reel import parse_reel
    if not file_path.exists():
        _fail(f"File not found: {file_path}")
    reel = parse_reel(file_path.read_text(encoding="utf-8-sig", errors="replace"), base_dir=file_path.resolve().parent)
    typer.echo(f"{file_path.name}: {len(reel.scenes)} slides, about {reel.estimate_seconds():.0f} seconds, "
               f"voice {'your recording' if reel.uses_own_voice else reel.meta.get('voice', '?')}")
    for sc in reel.scenes:
        title = (sc.slide.get("headline") or sc.slide.get("number") or sc.slide.get("quote") or sc.slide.get("body") or "")[:48]
        typer.echo(f"  {sc.n:2d}. {sc.slide.get('type', '?'):<9} {sc.motion:<8} {len(sc.words):3d} words  "
                   f"{title.replace('==', '').replace('**', '').encode('ascii', errors='replace').decode('ascii')}")
    _print_spec_issues(reel.issues)
    if reel.ok:
        typer.secho("Reel script OK: make it with `python -m autocontent reel`.", fg=typer.colors.GREEN)
    else:
        raise typer.Exit(code=1)


@app.command("reel")
def reel_cmd(
    file_path: Path = typer.Argument(..., help="Path to a reel script (.md, `autocontent: reel`)"),
    voice_file: Optional[Path] = typer.Option(None, "--voice-file", "-v", help="Your own recording (any audio or video file); without it Kokoro speaks the `say:` lines"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Output folder (default: output/<title>)"),
    style: Optional[str] = typer.Option(None, "--style", "-s", help="Style pack: grid_pill | beige_grain"),
    tag: Optional[str] = typer.Option(None, "--tag", help="Topic pill, such as #business"),
    aligner: str = typer.Option("auto", "--aligner", help="Word timing: auto | whisper | spread"),
    preset: str = typer.Option("veryfast", "--preset", help="x264 speed preset (slower = smaller file)"),
    no_fetch: bool = typer.Option(False, "--no-fetch", help="Don't download stock pictures"),
):
    """Make a 1080x1920 reel (H.264 + AAC mp4) from a reel script: slides appear in time with the voice-over."""
    from .reel import make_reel
    from .reel.pipeline import ReelError
    if not file_path.exists():
        _fail(f"File not found: {file_path}")
    if voice_file is not None and not voice_file.exists():
        _fail(f"Voice file not found: {voice_file}")
    text = file_path.read_text(encoding="utf-8-sig", errors="replace")
    if out is None:
        from .spec.build import _slug
        out = OUTPUT_DIR / f"reel_{_slug(file_path.stem)}"
    try:
        summary = make_reel(text, out, base_dir=file_path.resolve().parent, voice_file=voice_file, style=style, tag=tag,
                            backend=aligner, fetch_images=not no_fetch, preset=preset)
    except ReelError as e:
        typer.secho(f"\n{e}", fg=typer.colors.RED, err=True)
        _print_spec_issues(e.issues)
        _fail("Fix the script and run again.", "`python -m autocontent reel-check <file>` checks it without making the video.")
    typer.secho(f"\nDone: {out / 'reel.mp4'} ({summary['seconds']} seconds, {summary['size'] / 1e6:.1f} MB)", fg=typer.colors.GREEN)
    typer.echo(f"Caption: {out / 'caption.txt'}")


if __name__ == "__main__":
    app()
