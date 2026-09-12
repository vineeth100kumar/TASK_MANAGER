from fastapi import APIRouter
from ..services.weather_service import get_current_weather

router = APIRouter(prefix="/api/v1/weather", tags=["Live Weather"])

@router.get("")
async def get_weather(lat: float = 28.6139, lon: float = 77.2090):
    """Returns instant, cached real-time weather from Open-Meteo at zero cost."""
    return await get_current_weather(lat, lon)
