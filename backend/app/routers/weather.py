from fastapi import APIRouter
from ..config import DEFAULT_LAT, DEFAULT_LON
from ..services.weather_service import get_current_weather

router = APIRouter(prefix="/api/v1/weather", tags=["Live Weather"])

@router.get("")
async def get_weather(lat: float = DEFAULT_LAT, lon: float = DEFAULT_LON):
    """Returns instant, cached real-time weather from Open-Meteo at zero cost."""
    return await get_current_weather(lat, lon)
