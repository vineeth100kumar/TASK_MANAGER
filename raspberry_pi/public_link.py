"""
The address Sage can be reached at from outside the home network, for the
"Your public link" box in Settings. Checked in order:

  1. SAGE_PUBLIC_URL in /etc/sage/sage.env, if set by hand.
  2. A named Cloudflare Tunnel on your own domain (/etc/cloudflared/sage.yml).
  3. A free Cloudflare quick tunnel (a random *.trycloudflare.com address
     that changes whenever cloudflared restarts), asked of cloudflared itself.
  4. Tailscale Funnel.
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Optional

import httpx

TUNNEL_CONFIG = Path("/etc/cloudflared/sage.yml")
# cloudflared serves its metrics on the first free port in this range, unless
# told otherwise; deploy/systemd/sage-quicktunnel.service pins 20241.
CLOUDFLARED_METRICS_PORTS = range(20241, 20246)


def _named_tunnel() -> Optional[str]:
    try:
        for line in TUNNEL_CONFIG.read_text().splitlines():
            key, _, value = line.strip().lstrip("- ").partition(":")
            if key.strip() == "hostname" and value.strip():
                return f"https://{value.strip()}"
    except OSError:
        pass
    return None


def _quick_tunnel() -> Optional[str]:
    for port in CLOUDFLARED_METRICS_PORTS:
        try:
            res = httpx.get(f"http://127.0.0.1:{port}/quicktunnel", timeout=0.5)
        except httpx.HTTPError:
            continue
        host = res.json().get("hostname") if res.status_code == 200 else None
        if host:
            return f"https://{host}"
    return None


def _tailscale_funnel() -> Optional[str]:
    try:
        out = subprocess.run(["tailscale", "funnel", "status", "--json"], capture_output=True, text=True, timeout=3)
        allowed = json.loads(out.stdout or "{}").get("AllowFunnel") or {}
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    for host_port, on in allowed.items():
        if on:
            host, _, port = host_port.rpartition(":")
            return f"https://{host}" if port == "443" else f"https://{host_port}"
    return None


def find() -> dict:
    url = os.getenv("SAGE_PUBLIC_URL", "").strip()
    if url:
        return {"url": url, "kind": "custom"}
    for kind, finder in (("cloudflare", _named_tunnel), ("cloudflare-quick", _quick_tunnel), ("tailscale", _tailscale_funnel)):
        url = finder()
        if url:
            return {"url": url, "kind": kind}
    return {"url": None, "kind": None}
