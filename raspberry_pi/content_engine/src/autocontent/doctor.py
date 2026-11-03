"""Environment checks shared by `autocontent doctor` and the GUI Settings page.

Each check is {"status": "ok" | "warn" | "fail", "name": ..., "detail": ...}. A "fail" blocks
the app from working; a "warn" limits it (no AI key, no Ollama). Secrets are never returned.
"""

import sys
from typing import Any, Dict, List

from .settings import PROJECT_ROOT, FONTS_DIR, get_env_setting

PLACEHOLDER_KEY = "your_groq_api_key_here"

PACKAGES = [
    ("docx", "python-docx"),
    ("pdfplumber", "pdfplumber"),
    ("pydantic", "pydantic>=2"),
    ("dotenv", "python-dotenv"),
    ("jinja2", "Jinja2"),
    ("playwright", "playwright"),
    ("PIL", "Pillow"),
    ("numpy", "numpy"),
    ("pytest", "pytest"),
    ("typer", "typer"),
    ("groq", "groq"),
]


def groq_key_set() -> bool:
    key = get_env_setting("GROQ_API_KEY", "")
    return bool(key) and key != PLACEHOLDER_KEY


def _check(status: str, name: str, detail: str = "") -> Dict[str, str]:
    return {"status": status, "name": name, "detail": detail}


def run_checks(network: bool = True, chromium: bool = True) -> List[Dict[str, str]]:
    """Run the environment checks. network=False skips the Groq model list and Ollama probe."""
    checks: List[Dict[str, str]] = []

    v = sys.version_info
    py = f"{v.major}.{v.minor}.{v.micro}"
    checks.append(_check("ok" if v >= (3, 11) else "fail", "Python version",
                         f"{py} (needs 3.11 or newer)"))

    in_venv = sys.prefix != sys.base_prefix
    checks.append(_check("ok" if in_venv else "warn", "Virtual environment",
                         sys.prefix if in_venv else "Not active (running in system Python)"))

    for mod_name, pkg_name in PACKAGES:
        try:
            __import__(mod_name)
            checks.append(_check("ok", f"Package {pkg_name}", "importable"))
        except ImportError as e:
            checks.append(_check("fail", f"Package {pkg_name}", f"missing ({e}). Run: pip install -r requirements.txt"))

    if chromium:
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                browser.close()
            checks.append(_check("ok", "Chromium (for rendering)", "launches"))
        except Exception as e:
            first = str(e).splitlines()[0] if str(e) else type(e).__name__
            checks.append(_check("fail", "Chromium (for rendering)",
                                 f"{first}. Run: python -m playwright install chromium"))

    league = FONTS_DIR / "LeagueSpartan-Variable.ttf"
    inter = FONTS_DIR / "Inter-Variable.ttf"
    checks.append(_check("ok" if league.exists() and inter.exists() else "fail", "Fonts",
                         "League Spartan and Inter in assets/fonts/" if league.exists() and inter.exists()
                         else "Missing fonts in assets/fonts/. Run: python scripts/download_fonts.py"))

    provider = get_env_setting("LLM_PROVIDER", "groq").lower()
    checks.append(_check("ok", "AI provider", provider))

    env_file = PROJECT_ROOT / ".env"
    checks.append(_check("ok" if env_file.exists() else "warn", ".env file",
                         "found" if env_file.exists() else "not found (copy .env.example to .env, or set the key in Settings)"))

    has_key = groq_key_set()
    checks.append(_check("ok" if has_key else "warn", "Groq API key",
                         "set (hidden)" if has_key else
                         "not set. AI mode needs a free key from console.groq.com; offline mode works without one."))

    models = {
        "Extractor": get_env_setting("GROQ_MODEL_EXTRACT", "openai/gpt-oss-20b"),
        "Composer": get_env_setting("GROQ_MODEL_COMPOSE", "openai/gpt-oss-120b"),
        "Verifier": get_env_setting("GROQ_MODEL_VERIFY", "qwen/qwen3.8-27b"),
    }
    if network and has_key:
        try:
            from groq import Groq
            live = {m.id for m in Groq(api_key=get_env_setting("GROQ_API_KEY")).models.list().data}
            for role, m_id in models.items():
                checks.append(_check("ok" if m_id in live else "warn", f"{role} model",
                                     f"{m_id} " + ("available on Groq" if m_id in live else "not in Groq's live model list")))
        except Exception as e:
            checks.append(_check("warn", "Groq models", f"could not verify with the Groq API: {str(e).splitlines()[0][:160]}"))
    else:
        for role, m_id in models.items():
            checks.append(_check("ok", f"{role} model", m_id))

    if network:
        try:
            from .llm.ollama import OllamaClient
            ollama = OllamaClient()
            if ollama.is_available():
                installed = ", ".join(ollama.list_models()) or "no models installed"
                checks.append(_check("ok", "Ollama (local AI)", f"running at {ollama.base_url} ({installed})"))
            else:
                checks.append(_check("warn", "Ollama (local AI)",
                                     f"not running at {ollama.base_url} (optional; run 'ollama serve' for fully private AI)"))
        except Exception as e:
            checks.append(_check("warn", "Ollama (local AI)", f"could not check: {e}"))

    return checks


def usage_today() -> Dict[str, Any]:
    """Today's Groq request/token counts from output/.usage.json."""
    from .llm.limiter import RateLimiter
    return RateLimiter().load_usage()
