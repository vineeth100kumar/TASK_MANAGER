import os
from typing import List

API_SECRET: str = os.environ.get("API_SECRET", "")
ENV: str = os.environ.get("ENV", "development")

FRONTEND_ORIGIN_RAW: str = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173,http://localhost")
ALLOWED_ORIGINS: List[str] = [origin.strip() for origin in FRONTEND_ORIGIN_RAW.split(",") if origin.strip()]

DEFAULT_LAT: float = float(os.environ.get("DEFAULT_LAT", "28.6139"))
DEFAULT_LON: float = float(os.environ.get("DEFAULT_LON", "77.2090"))
DEFAULT_USER_NAME: str = os.environ.get("DEFAULT_USER_NAME", "Chief")
