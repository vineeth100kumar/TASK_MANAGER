import secrets
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .config import API_SECRET

security_scheme = HTTPBearer(auto_error=False)

def assert_api_secret_configured():
    """Ensure API_SECRET is available."""
    if not API_SECRET or not API_SECRET.strip():
        raise RuntimeError(
            "CRITICAL: API_SECRET is not configured."
        )

async def verify_auth_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)
) -> str:
    """
    Validate the bearer token against the configured API_SECRET.

    There used to be a second accepted value, a constant named
    LEGACY_SHORTCUTS_SECRET, kept so older Siri Shortcuts would keep working.
    It was committed to a public repository and shipped inside the frontend
    bundle, which made every route here readable and writable by anyone who
    knew the address. Shortcuts carry the real secret now.
    """
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
        
    token = credentials.credentials
    if not secrets.compare_digest(token, API_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"}
        )
        
    return token
