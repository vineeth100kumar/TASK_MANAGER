import time
import httpx
from typing import Dict, Any, Optional

_weather_cache: Dict[str, Any] = {}
_cache_ttl_seconds = 600 # 10 minutes

# Default to New Delhi (or user coordinates)
DEFAULT_LAT = 28.6139
DEFAULT_LON = 77.2090

WEATHER_CODE_MAP = {
    0: ("Clear sky", "Sun"),
    1: ("Mainly clear", "SunMedium"),
    2: ("Partly cloudy", "CloudSun"),
    3: ("Overcast", "Cloud"),
    45: ("Foggy", "CloudFog"),
    48: ("Depositing rime fog", "CloudFog"),
    51: ("Light drizzle", "CloudDrizzle"),
    53: ("Moderate drizzle", "CloudDrizzle"),
    55: ("Dense drizzle", "CloudDrizzle"),
    61: ("Slight rain", "CloudRain"),
    63: ("Moderate rain", "CloudRain"),
    65: ("Heavy rain", "CloudRainWind"),
    71: ("Slight snow", "Snowflake"),
    73: ("Moderate snow", "Snowflake"),
    75: ("Heavy snow", "Snowflake"),
    80: ("Rain showers", "CloudRain"),
    81: ("Moderate showers", "CloudRain"),
    82: ("Violent showers", "CloudLightning"),
    95: ("Thunderstorm", "CloudLightning"),
}

async def get_current_weather(lat: float = DEFAULT_LAT, lon: float = DEFAULT_LON) -> Dict[str, Any]:
    """
    Fetches real-time weather using the 100% free Open-Meteo API.
    Cached for 10 minutes.
    """
    cache_key = f"{round(lat, 2)},{round(lon, 2)}"
    now = time.time()
    
    if cache_key in _weather_cache:
        data, timestamp = _weather_cache[cache_key]
        if now - timestamp < _cache_ttl_seconds:
            return data

    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto"
    )
    
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                json_data = resp.json()
                current = json_data.get("current", {})
                daily = json_data.get("daily", {})
                weather_code = current.get("weather_code", 0)
                condition, icon = WEATHER_CODE_MAP.get(weather_code, ("Fair", "Sun"))
                
                result = {
                    "temperature": round(current.get("temperature_2m", 25.0), 1),
                    "apparent_temperature": round(current.get("apparent_temperature", 26.0), 1),
                    "humidity": current.get("relative_humidity_2m", 50),
                    "precipitation": current.get("precipitation", 0.0),
                    "rain_probability": daily.get("precipitation_probability_max", [0])[0] if daily.get("precipitation_probability_max") else 0,
                    "temp_max": daily.get("temperature_2m_max", [28.0])[0] if daily.get("temperature_2m_max") else 28.0,
                    "temp_min": daily.get("temperature_2m_min", [18.0])[0] if daily.get("temperature_2m_min") else 18.0,
                    "condition": condition,
                    "icon": icon,
                    "wind_speed": current.get("wind_speed_10m", 5.0),
                    "source": "Open-Meteo (Free)",
                }
                _weather_cache[cache_key] = (result, now)
                return result
    except Exception as e:
        print(f"Weather API error: {e}")
        
    # Fallback if offline
    return {
        "temperature": 24.0,
        "apparent_temperature": 25.0,
        "humidity": 50,
        "precipitation": 0.0,
        "rain_probability": 0,
        "temp_max": 28.0,
        "temp_min": 18.0,
        "condition": "Pleasant",
        "icon": "Sun",
        "wind_speed": 5.0,
        "source": "Offline Fallback",
    }
