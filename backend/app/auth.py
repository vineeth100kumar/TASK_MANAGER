import secrets
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .config import API_SECRET

security_scheme = HTTPBearer(auto_error=False)

def assert_api_secret_configured():
    """Fail startup if API_SECRET is not configured."""
    if not API_SECRET or not API_SECRET.strip():
        raise RuntimeError(
            "CRITICAL: API_SECRET environment variable is not set. "
            "Please configure API_SECRET in your environment or .env file before starting the application."
        )

async def verify_auth_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)
) -> str:
    """Validate bearer token against configured API_SECRET."""
    if not API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server authentication is not configured"
        )
        
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )
        
    if not secrets.compare_digest(credentials.credentials, API_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"}
        )
        
    return credentials.credentials
