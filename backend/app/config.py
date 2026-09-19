import os
import secrets
from pathlib import Path
from typing import List

# Data Directory
DATA_DIR: str = os.environ.get(
    "DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
)
os.makedirs(DATA_DIR, exist_ok=True)

# 1. Read API_SECRET from environment
API_SECRET: str = os.environ.get("API_SECRET", "")

# 2. Check candidate .env files if not in environment
if not API_SECRET:
    candidate_env_paths = [
        Path(os.path.dirname(__file__)).parent.parent / ".env",
        Path(os.path.dirname(__file__)).parent / ".env",
        Path(DATA_DIR) / ".env",
    ]
    for env_path in candidate_env_paths:
        if env_path.is_file():
            try:
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line.startswith("API_SECRET=") and not line.startswith("#"):
                        API_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
                if API_SECRET:
                    break
            except Exception:
                pass

# 3. Check persistent api_secret.txt in DATA_DIR
secret_file = Path(DATA_DIR) / "api_secret.txt"
if not API_SECRET:
    if secret_file.is_file():
        try:
            API_SECRET = secret_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass

# 4. If still empty, generate and persist a secure token so server boots safely
if not API_SECRET:
    API_SECRET = secrets.token_hex(24)
    try:
        secret_file.write_text(API_SECRET, encoding="utf-8")
        print(
            "[SECURITY] No API_SECRET was configured, so a new random one was "
            f"generated and saved to {secret_file}. Open Settings in the app "
            "and paste it in to connect. Better: put it in /etc/sage/sage.env."
        )
    except Exception as e:
        print(f"[SECURITY] Could not persist API_SECRET to file: {e}")

ENV: str = os.environ.get("ENV", "development")

# The frontend is served by the same nginx that proxies this API, so the app
# itself is same-origin and needs no CORS grant at all. The default is
# therefore nothing: set FRONTEND_ORIGIN only to name a genuinely separate
# origin, such as a Vite dev server. It used to default to "*", which handed
# every site on the internet a scripted path to this data.
FRONTEND_ORIGIN_RAW: str = os.environ.get("FRONTEND_ORIGIN", "")
ALLOWED_ORIGINS: List[str] = [
    origin.strip() for origin in FRONTEND_ORIGIN_RAW.split(",") if origin.strip()
]

DEFAULT_LAT: float = float(os.environ.get("DEFAULT_LAT", "28.6139"))
DEFAULT_LON: float = float(os.environ.get("DEFAULT_LON", "77.2090"))
DEFAULT_USER_NAME: str = os.environ.get("DEFAULT_USER_NAME", "Chief")
