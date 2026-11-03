"""Phase 2 benchmark evaluation runner across 5 diverse document types."""

from datetime import datetime
import json
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple

from autocontent.pipeline.run import run_pipeline
from autocontent.pipeline.audit import audit_deck_folder
from autocontent.llm.base import LLMClient
from autocontent.settings import PROJECT_ROOT, OUTPUT_DIR

DEFAULT_EVAL_DIR = PROJECT_ROOT / "tests" / "fixtures" / "eval"


def run_evaluation(
    fixtures_dir: Optional[Path] = None,
    provider: Optional[str] = None,
    out_dir: Optional[Path] = None,
    llm: Optional[LLMClient] = None,
    no_llm: bool = False,
    style: str = "beige_grain"
) -> Tuple[bool, Path]:
    """Execute evaluation benchmark across all test documents in fixtures_dir.

    Generates eval_scorecard.md in out_dir.
    Returns: (all_passed, scorecard_path)
    """
    eval_fixtures = fixtures_dir or DEFAULT_EVAL_DIR
    target_out = out_dir or (OUTPUT_DIR / "eval_results")
    target_out.mkdir(parents=True, exist_ok=True)

    files = sorted(
        [f for f in eval_fixtures.iterdir() if f.is_file() and f.suffix.lower() in (".docx", ".pdf", ".txt", ".md", ".markdown")],
        key=lambda x: x.name
    )

    if not files:
        raise FileNotFoundError(f"No benchmark fixtures found in {eval_fixtures}")

    scorecard_lines = [
        "# Mind Deeds Phase 2 Benchmark Evaluation Scorecard",
        f"- **Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- **Provider:** {provider or 'extractive' if no_llm else 'default'}",
        f"- **Total Documents:** {len(files)}",
        "",
        "## Summary Scorecard",
        "",
        "| Document | Mode | Slides | Time (s) | Claims Acc/Rej | Fallbacks | Audit Verdict | Status |",
        "|---|---|---|---|---|---|---|---|"
    ]

    all_passed = True
    results: List[Dict[str, Any]] = []

    for doc_file in files:
        doc_out = target_out / doc_file.stem
        t0 = time.time()
        error_msg = ""
        audit_passed = False
        claims_acc = 0
        claims_rej = 0
        fallbacks_count = 0
        slides_count = 0
        mode_used = "auto"

        try:
            out_folder, slides_data, report_md = run_pipeline(
                file_path=doc_file,
                mode="auto",
                slide_count=6,
                no_llm=no_llm,
                provider=provider,
                allow_fail=True,
                out_dir=doc_out,
                llm=llm,
                style=style
            )
            elapsed = time.time() - t0
            mode_used = slides_data.get("mode_used", "auto")
            slides_count = len(slides_data.get("slides", []))
            claims_acc = len(slides_data.get("claims", []))

            # Check rejected claims if file exists
            rej_file = doc_out / "02_claims_rejected.json"
            if rej_file.exists():
                with open(rej_file, "r", encoding="utf-8") as rf:
                    rej_data = json.load(rf)
                    claims_rej = len(rej_data)

            # Check fallbacks
            for s in slides_data.get("slides", []):
                if s.get("source_status") == "extractive_fallback":
                    fallbacks_count += 1

            # Run deterministic audit
            audit_passed, _ = audit_deck_folder(doc_out)

            if not audit_passed:
                all_passed = False

            status_str = "**PASS**" if audit_passed else "**FAIL**"
            scorecard_lines.append(
                f"| `{doc_file.name}` | {mode_used} | {slides_count} | {elapsed:.2f} | "
                f"{claims_acc}/{claims_rej} | {fallbacks_count} | {audit_passed} | {status_str} |"
            )

        except Exception as e:
            elapsed = time.time() - t0
            all_passed = False
            scorecard_lines.append(
                f"| `{doc_file.name}` | {mode_used} | ERROR | {elapsed:.2f} | "
                f"-/- | - | FAIL | **ERROR** ({e}) |"
            )

    scorecard_lines.extend([
        "",
        "## Overall Benchmark Result",
        f"- **Benchmark Status:** {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}",
        ""
    ])

    scorecard_path = target_out / "eval_scorecard.md"
    with open(scorecard_path, "w", encoding="utf-8") as sc:
        sc.write("\n".join(scorecard_lines) + "\n")

    return all_passed, scorecard_path
