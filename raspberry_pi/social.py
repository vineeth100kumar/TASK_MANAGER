"""
Social: Instagram numbers for a content project, pulled from Meta for free.

One content project is one Instagram page. Connect that page's professional
account once and the Pi pulls its numbers every morning and keeps them, so the
Content dashboard can show history Meta itself forgets (account metrics live about 90
days at Meta, and this keeps a daily snapshot for good).

Why this path: "Instagram API with Instagram Login" (host graph.instagram.com)
reads your OWN professional account with Standard Access. No Facebook Page, no
App Review and no business verification, so it costs nothing. Advanced Access,
which does need review, is only for reading accounts you don't own.

How a page gets connected (see docs/social-setup.md for the user's steps):
  1. You make a Meta app, add "Instagram > API setup with Instagram login",
     and put its Instagram App ID and app secret into Sage once.
  2. Sage shows you the Instagram authorize URL. You allow access and Instagram
     sends back a short code, which you paste into Sage.
  3. Sage swaps the code for a short-lived token, swaps that for a 60-day
     long-lived token, and keeps only the long-lived one.
  4. run() refreshes that token while it is older than a day and not expired.
     A token left unrefreshed for 60 days dies and has to be made again.

Metric names move around at Meta, so METRICS below is the wish list, not a
promise: _insights drops any metric Meta rejects and records which, rather than
losing the whole pull. `impressions` is gone (deprecated 21 Apr 2025) and
`views` replaces it; media uses `saved`, while the account uses `saves`.

The tables are Pi-only, like Drop's: they are not in SYNC_TABLES, so they never
go to the phone or into the Sheets backup. Tokens never leave the Pi.
"""

import asyncio
import datetime
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

import logstore
import system_health

GRAPH = "https://graph.instagram.com"
API = "https://api.instagram.com"
VERSION = os.getenv("SAGE_SOCIAL_API_VERSION", "v25.0")
AUTHORIZE = "https://www.instagram.com/oauth/authorize"

# Account insights: period=day, metric_type=total_value (v25.0).
ACCOUNT_METRICS = ["reach", "views", "total_interactions", "likes", "comments",
                   "shares", "saves", "replies", "accounts_engaged", "follows_and_unfollows"]
# Media insights have no metric_type and only period=lifetime. Per media type.
MEDIA_METRICS = {
    "REELS": ["reach", "views", "likes", "comments", "saved", "shares",
              "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"],
    "FEED": ["reach", "views", "likes", "comments", "saved", "shares",
             "total_interactions", "profile_visits", "follows"],
    "STORY": ["reach", "views", "replies", "shares", "navigation"],
}
ACCOUNT_FIELDS = "user_id,username,account_type,followers_count,follows_count,media_count,profile_picture_url"
MEDIA_FIELDS = ("id,caption,media_type,media_product_type,permalink,timestamp,"
                "thumbnail_url,media_url,like_count,comments_count")
# Day 1, 3, 7 and 30 snapshots give a growth curve without re-pulling everything.
SNAP_DAYS = [1, 3, 7, 30]
PULL_HOUR = int(os.getenv("SAGE_SOCIAL_HOUR", "6"))      # local time
REFRESH_WHEN_DAYS_LEFT = 15
MEDIA_PER_PULL = int(os.getenv("SAGE_SOCIAL_MEDIA", "25"))

DB_PATH = "sage_sync.db"
SECRETS_FILE = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent / "sage_secrets.json"


# --- Storage ---

def connect(db_path: str) -> None:
    global DB_PATH
    DB_PATH = db_path
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS social_account (
            project_id TEXT PRIMARY KEY,
            ig_user_id TEXT,
            username TEXT,
            account_type TEXT,
            picture TEXT,
            token TEXT,
            token_expires_at TEXT,
            connected_at TEXT,
            last_pull_at TEXT,
            problem TEXT,
            dropped TEXT
        );
        CREATE TABLE IF NOT EXISTS social_day (
            project_id TEXT,
            day TEXT,
            followers INTEGER,
            follows INTEGER,
            media_count INTEGER,
            metrics TEXT,
            PRIMARY KEY (project_id, day)
        );
        CREATE TABLE IF NOT EXISTS social_media (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            kind TEXT,
            caption TEXT,
            permalink TEXT,
            thumbnail TEXT,
            posted_at TEXT,
            sage_kind TEXT,
            sage_id TEXT,
            metrics TEXT,
            updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS social_media_project ON social_media (project_id, posted_at);
        CREATE TABLE IF NOT EXISTS social_media_snap (
            media_id TEXT,
            age_days INTEGER,
            metrics TEXT,
            taken_at TEXT,
            PRIMARY KEY (media_id, age_days)
        );
        """
    )
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _secrets() -> dict:
    try:
        return json.loads(SECRETS_FILE.read_text())
    except Exception:
        return {}


def _save_secrets(values: Dict[str, Optional[str]]) -> None:
    secrets = _secrets()
    for key, value in values.items():
        if value:
            secrets[key] = value
        else:
            secrets.pop(key, None)
    SECRETS_FILE.touch(mode=0o600, exist_ok=True)
    SECRETS_FILE.write_text(json.dumps(secrets))


def app_creds() -> Tuple[str, str]:
    s = _secrets()
    return (str(s.get("IG_APP_ID", "") or os.getenv("SAGE_IG_APP_ID", "")).strip(),
            str(s.get("IG_APP_SECRET", "") or os.getenv("SAGE_IG_APP_SECRET", "")).strip())


def redirect_uri() -> str:
    """Where Instagram sends the code back. Meta demands HTTPS, and it only has
    to match what the app's Business login settings list: Sage reads the code
    you paste, so nothing has to be served there."""
    return os.getenv("SAGE_IG_REDIRECT", "https://localhost/sage/social")


def authorize_url(scopes: str = "instagram_business_basic,instagram_business_manage_insights") -> str:
    app_id, _ = app_creds()
    from urllib.parse import urlencode
    return AUTHORIZE + "?" + urlencode({
        "client_id": app_id, "redirect_uri": redirect_uri(),
        "response_type": "code", "scope": scopes,
    })


# --- Time ---

def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _local_now() -> datetime.datetime:
    return datetime.datetime.now()


def _iso(dt: datetime.datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


# --- Meta calls ---

class SocialError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _meta_message(res: httpx.Response) -> str:
    try:
        body = res.json()
    except Exception:
        return f"Instagram answered {res.status_code}"
    err = body.get("error") or {}
    msg = err.get("error_user_msg") or err.get("message") or f"Instagram answered {res.status_code}"
    return str(msg)


async def _get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    res = await client.get(f"{GRAPH}/{VERSION}{path}", params=params, timeout=30)
    if res.status_code >= 400:
        raise SocialError(_meta_message(res), 502)
    return res.json()


async def exchange_code(code: str) -> Tuple[str, str]:
    """Code -> short-lived token -> 60-day long-lived token. Returns (token, expires_at)."""
    app_id, secret = app_creds()
    if not app_id or not secret:
        raise SocialError("Add your Instagram App ID and app secret in Settings first.")
    code = code.strip().rstrip("#_")  # Instagram appends "#_" to the redirect
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{API}/oauth/access_token", data={
            "client_id": app_id, "client_secret": secret,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri(), "code": code,
        }, timeout=30)
        if res.status_code >= 400:
            raise SocialError(_meta_message(res), 502)
        body = res.json()
        data = (body.get("data") or [{}])[0] if isinstance(body.get("data"), list) else body
        short = str(data.get("access_token", "")).strip()
        if not short:
            raise SocialError("Instagram did not return a token for that code. Codes last an hour and work once.")
        return await _long_lived(client, short)


async def _long_lived(client: httpx.AsyncClient, short: str) -> Tuple[str, str]:
    _, secret = app_creds()
    body = await _get(client, "/access_token", {
        "grant_type": "ig_exchange_token", "client_secret": secret, "access_token": short})
    token = str(body.get("access_token", "")).strip()
    if not token:
        raise SocialError("Instagram did not return a long-lived token.")
    secs = int(body.get("expires_in") or 5184000)
    return token, _iso(_utcnow() + datetime.timedelta(seconds=secs))


async def refresh_token(token: str) -> Tuple[str, str]:
    async with httpx.AsyncClient() as client:
        body = await _get(client, "/refresh_access_token", {
            "grant_type": "ig_refresh_token", "access_token": token})
        new = str(body.get("access_token", "")).strip() or token
        secs = int(body.get("expires_in") or 5184000)
        return new, _iso(_utcnow() + datetime.timedelta(seconds=secs))


async def account(token: str) -> dict:
    """The connected account itself. Falls back to fewer fields if Meta rejects one."""
    async with httpx.AsyncClient() as client:
        try:
            return await _get(client, "/me", {"fields": ACCOUNT_FIELDS, "access_token": token})
        except SocialError:
            return await _get(client, "/me", {"fields": "user_id,username,followers_count,media_count",
                                              "access_token": token})


_UNSUPPORTED = re.compile(r"metric\[?\d*\]?|unsupported|does not support|invalid|unknown", re.I)


async def _insights(client: httpx.AsyncClient, path: str, metrics: List[str], token: str,
                    extra: Optional[dict] = None) -> Tuple[Dict[str, float], List[str]]:
    """Ask for metrics and keep what Meta gives. A rejected metric is dropped and
    named, so one retired metric can't lose the whole pull."""
    wanted = list(metrics)
    dropped: List[str] = []
    if wanted:
        params = {"metric": ",".join(wanted), "access_token": token, **(extra or {})}
        try:
            body = await _get(client, path, params)
        except SocialError as e:
            if len(wanted) == 1 or not _UNSUPPORTED.search(str(e)):
                dropped.extend(wanted)
                return {}, dropped
            # Meta won't always say which one it hates: halve and try each side.
            half = len(wanted) // 2
            left, l_drop = await _insights(client, path, wanted[:half], token, extra)
            right, r_drop = await _insights(client, path, wanted[half:], token, extra)
            left.update(right)
            return left, dropped + l_drop + r_drop
        out: Dict[str, float] = {}
        for row in body.get("data") or []:
            name = str(row.get("name", ""))
            total = (row.get("total_value") or {}).get("value")
            if total is None:
                values = row.get("values") or []
                total = values[-1].get("value") if values else None
            if isinstance(total, (int, float)):
                out[name] = float(total)
        return out, dropped
    return {}, dropped


async def account_insights(token: str, ig_user_id: str) -> Tuple[Dict[str, float], List[str]]:
    async with httpx.AsyncClient() as client:
        return await _insights(client, f"/{ig_user_id}/insights", ACCOUNT_METRICS, token,
                               {"period": "day", "metric_type": "total_value"})


async def media_list(token: str, limit: int) -> List[dict]:
    async with httpx.AsyncClient() as client:
        body = await _get(client, "/me/media", {"fields": MEDIA_FIELDS, "limit": limit,
                                                "access_token": token})
        return list(body.get("data") or [])


async def media_insights(token: str, media_id: str, kind: str) -> Tuple[Dict[str, float], List[str]]:
    metrics = MEDIA_METRICS.get(kind) or MEDIA_METRICS["FEED"]
    async with httpx.AsyncClient() as client:
        return await _insights(client, f"/{media_id}/insights", metrics, token)


# --- Pulling ---

def _kind(media: dict) -> str:
    product = str(media.get("media_product_type") or "").upper()
    if product in MEDIA_METRICS:
        return product
    return "REELS" if product == "CLIPS" else "FEED"


def accounts() -> List[dict]:
    conn = _db()
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM social_account").fetchall()]
    finally:
        conn.close()


def account_row(project_id: str) -> Optional[dict]:
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM social_account WHERE project_id = ?", (project_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _save_account(project_id: str, **fields: Any) -> None:
    row = account_row(project_id) or {"project_id": project_id}
    row.update(fields)
    conn = _db()
    try:
        keys = ["project_id", "ig_user_id", "username", "account_type", "picture", "token",
                "token_expires_at", "connected_at", "last_pull_at", "problem", "dropped"]
        conn.execute(
            f"INSERT OR REPLACE INTO social_account ({','.join(keys)}) VALUES ({','.join('?' * len(keys))})",
            [row.get(k) for k in keys])
        conn.commit()
    finally:
        conn.close()


def forget(project_id: str) -> None:
    conn = _db()
    try:
        ids = [r[0] for r in conn.execute("SELECT id FROM social_media WHERE project_id = ?", (project_id,))]
        conn.execute("DELETE FROM social_account WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM social_day WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM social_media WHERE project_id = ?", (project_id,))
        for media_id in ids:
            conn.execute("DELETE FROM social_media_snap WHERE media_id = ?", (media_id,))
        conn.commit()
    finally:
        conn.close()


async def link_account(project_id: str, code_or_token: str) -> dict:
    """Connect a page: a pasted code is swapped for a token, a pasted token is used."""
    value = code_or_token.strip()
    if len(value) < 60 and not value.startswith("IG"):
        token, expires = await exchange_code(value)
    else:
        async with httpx.AsyncClient() as client:
            token, expires = await _long_lived(client, value)
    me = await account(token)
    _save_account(project_id, ig_user_id=str(me.get("user_id") or me.get("id") or ""),
                  username=str(me.get("username") or ""), account_type=str(me.get("account_type") or ""),
                  picture=str(me.get("profile_picture_url") or ""), token=token,
                  token_expires_at=expires, connected_at=_iso(_utcnow()), problem=None)
    await pull(project_id)
    return status(project_id)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _match_sage(project_id: str, caption: str, posted_at: str,
                conn: sqlite3.Connection) -> Tuple[Optional[str], Optional[str]]:
    """Which Sage post or reel became this Instagram media. Posts and reels keep
    their whole record in a JSON `payload`, so this reads that: same project, made
    or marked posted within a week of the Instagram timestamp, and the caption
    (or the title) shares its opening with the Instagram caption."""
    head = _norm(caption)[:40]
    if len(head) < 12:  # too short to tell two posts apart
        return None, None
    when = None
    try:
        when = datetime.datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except Exception:
        pass
    for table, kind in (("posts", "post"), ("reels", "reel")):
        try:
            rows = conn.execute(f"SELECT id, payload FROM {table}").fetchall()
        except sqlite3.Error:
            continue
        for row in rows:
            try:
                piece = json.loads(row["payload"] or "{}")
            except Exception:
                continue
            if (piece.get("projectId") or None) != (project_id or None):
                continue
            if when is not None:
                stamp = piece.get("postedAt") or piece.get("scheduledFor") or piece.get("createdAt")
                try:
                    made = datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
                    if made.tzinfo is None:
                        made = made.replace(tzinfo=datetime.timezone.utc)
                    if abs((when - made).days) > 7:
                        continue
                except Exception:
                    pass
            for text in (piece.get("caption"), piece.get("title")):
                body = _norm(str(text or ""))
                if body and (body.startswith(head[:20]) or head in body):
                    return kind, row["id"]
    return None, None


async def pull(project_id: str) -> dict:
    """One page's numbers: today's account snapshot, then recent media."""
    row = account_row(project_id)
    if not row or not row.get("token"):
        raise SocialError("That page has no Instagram account connected yet.", 404)
    token = str(row["token"])
    dropped: List[str] = []
    try:
        me = await account(token)
        ig_user_id = str(row.get("ig_user_id") or me.get("user_id") or me.get("id") or "")
        if not ig_user_id:
            raise SocialError("Instagram didn't say which account this token is for. Connect the page again.")
        metrics, drop1 = await account_insights(token, ig_user_id)
        dropped += drop1
        day = _local_now().date().isoformat()
        conn = _db()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO social_day (project_id, day, followers, follows, media_count, metrics)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (project_id, day, int(me.get("followers_count") or 0), int(me.get("follows_count") or 0),
                 int(me.get("media_count") or 0), json.dumps(metrics)))
            conn.commit()
        finally:
            conn.close()

        media = await media_list(token, MEDIA_PER_PULL)
        # Ask Instagram for every post's numbers BEFORE touching the database. Writing
        # as we went would hold a write transaction open across 25 network calls, which
        # is how "database is locked" started on a slow Pi last time.
        fetched: List[Tuple[dict, str, Dict[str, float]]] = []
        for item in media:
            media_id = str(item.get("id") or "")
            if not media_id:
                continue
            kind = _kind(item)
            stats, drop2 = await media_insights(token, media_id, kind)
            dropped += drop2
            fetched.append((item, kind, stats))

        now = _utcnow()
        conn = _db()
        try:
            for item, kind, stats in fetched:
                media_id = str(item.get("id") or "")
                posted_at = str(item.get("timestamp") or "")
                existing = conn.execute("SELECT sage_kind, sage_id FROM social_media WHERE id = ?",
                                        (media_id,)).fetchone()
                sage_kind, sage_id = (existing["sage_kind"], existing["sage_id"]) if existing else (None, None)
                if not sage_id:
                    sage_kind, sage_id = _match_sage(project_id, str(item.get("caption") or ""), posted_at, conn)
                conn.execute(
                    "INSERT OR REPLACE INTO social_media (id, project_id, kind, caption, permalink,"
                    " thumbnail, posted_at, sage_kind, sage_id, metrics, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (media_id, project_id, kind, str(item.get("caption") or ""),
                     str(item.get("permalink") or ""),
                     str(item.get("thumbnail_url") or item.get("media_url") or ""),
                     posted_at, sage_kind, sage_id, json.dumps(stats), _iso(now)))
                age = _age_days(posted_at, now)
                if age is not None:
                    slot = next((d for d in SNAP_DAYS if age <= d), None)
                    if slot is not None:
                        conn.execute(
                            "INSERT OR REPLACE INTO social_media_snap (media_id, age_days, metrics, taken_at)"
                            " VALUES (?, ?, ?, ?)", (media_id, slot, json.dumps(stats), _iso(now)))
            conn.commit()
        finally:
            conn.close()
        _save_account(project_id, last_pull_at=_iso(now), problem=None,
                      dropped=json.dumps(sorted(set(dropped))) if dropped else None)
        if dropped:
            logstore.log("warn", "social", f"Instagram refused these metrics: {', '.join(sorted(set(dropped)))}")
        return {"ok": True, "media": len(media), "dropped": sorted(set(dropped))}
    except SocialError as e:
        _save_account(project_id, problem=str(e))
        raise
    except Exception as e:  # a surprise shouldn't kill the worker
        _save_account(project_id, problem=str(e))
        raise SocialError(str(e), 502)


def _age_days(posted_at: str, now: datetime.datetime) -> Optional[int]:
    try:
        when = datetime.datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except Exception:
        return None
    return max(0, (now - when).days)


# --- Reading for the app ---

def status(project_id: str) -> dict:
    row = account_row(project_id)
    app_id, secret = app_creds()
    out: Dict[str, Any] = {"projectId": project_id, "appReady": bool(app_id and secret),
                           "connected": bool(row and row.get("token"))}
    if not row:
        return out
    expires = str(row.get("token_expires_at") or "")
    left = None
    try:
        left = (datetime.datetime.fromisoformat(expires) - _utcnow()).days
    except Exception:
        pass
    out.update({"username": row.get("username"), "accountType": row.get("account_type"),
                "picture": row.get("picture"), "lastPull": row.get("last_pull_at"),
                "tokenExpires": expires or None, "tokenDaysLeft": left,
                "problem": row.get("problem"),
                "dropped": json.loads(row.get("dropped") or "[]")})
    return out


def overview(project_id: str, days: int = 30) -> dict:
    conn = _db()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM social_day WHERE project_id = ? ORDER BY day DESC LIMIT ?",
            (project_id, max(2, min(400, days)))).fetchall()]
    finally:
        conn.close()
    rows.reverse()
    daily = []
    for r in rows:
        metrics = json.loads(r.get("metrics") or "{}")
        daily.append({"day": r["day"], "followers": r.get("followers") or 0,
                      "mediaCount": r.get("media_count") or 0, **metrics})
    first, last = (daily[0], daily[-1]) if daily else ({}, {})
    totals: Dict[str, float] = {}
    for d in daily:
        for key, value in d.items():
            if key in ("day",) or not isinstance(value, (int, float)):
                continue
            if key in ("followers", "mediaCount"):
                continue
            totals[key] = totals.get(key, 0) + value
    followers = last.get("followers") or 0
    reach = totals.get("reach") or 0
    return {
        "projectId": project_id, "days": len(daily), "daily": daily, "totals": totals,
        "followers": followers,
        "followersChange": followers - (first.get("followers") or 0) if daily else 0,
        "engagementRate": round(100 * (totals.get("total_interactions") or 0) / reach, 2) if reach else None,
        **status(project_id),
    }


def posts(project_id: str, limit: int = 30) -> dict:
    conn = _db()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM social_media WHERE project_id = ? ORDER BY posted_at DESC LIMIT ?",
            (project_id, max(1, min(100, limit)))).fetchall()]
    finally:
        conn.close()
    out = []
    for r in rows:
        metrics = json.loads(r.get("metrics") or "{}")
        out.append({"id": r["id"], "kind": r.get("kind"), "caption": r.get("caption") or "",
                    "permalink": r.get("permalink"), "thumbnail": r.get("thumbnail"),
                    "postedAt": r.get("posted_at"), "sageKind": r.get("sage_kind"),
                    "sageId": r.get("sage_id"), "metrics": metrics})
    reaches = [p["metrics"].get("reach") for p in out if isinstance(p["metrics"].get("reach"), (int, float))]
    average = sum(reaches) / len(reaches) if reaches else None
    for p in out:
        reach = p["metrics"].get("reach")
        p["vsAverage"] = round(100 * (reach - average) / average) if average and isinstance(reach, (int, float)) else None
    return {"projectId": project_id, "posts": out, "averageReach": round(average) if average else None}


def post(media_id: str) -> dict:
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM social_media WHERE id = ?", (media_id,)).fetchone()
        if not row:
            raise SocialError("No such Instagram post is saved.", 404)
        snaps = [dict(s) for s in conn.execute(
            "SELECT * FROM social_media_snap WHERE media_id = ? ORDER BY age_days", (media_id,)).fetchall()]
    finally:
        conn.close()
    return {"id": row["id"], "projectId": row["project_id"], "kind": row["kind"],
            "caption": row["caption"] or "", "permalink": row["permalink"],
            "thumbnail": row["thumbnail"], "postedAt": row["posted_at"],
            "sageKind": row["sage_kind"], "sageId": row["sage_id"],
            "metrics": json.loads(row["metrics"] or "{}"),
            "growth": [{"ageDays": s["age_days"], "metrics": json.loads(s["metrics"] or "{}")} for s in snaps]}


# --- Worker ---

def due(now: datetime.datetime, last_pull: Optional[str]) -> bool:
    """Once a day, at or after PULL_HOUR local time."""
    if now.hour < PULL_HOUR:
        return False
    if not last_pull:
        return True
    try:
        when = datetime.datetime.fromisoformat(last_pull)
    except Exception:
        return True
    if when.tzinfo:
        when = when.astimezone().replace(tzinfo=None)
    return when.date() < now.date()


def token_due(days_left: Optional[int], connected_at: Optional[str], now: datetime.datetime) -> bool:
    """Refresh inside the last stretch of a 60-day token. Meta wants it at least
    a day old, so a token made minutes ago waits."""
    if days_left is None or days_left > REFRESH_WHEN_DAYS_LEFT or days_left < 0:
        return False
    try:
        age = now - datetime.datetime.fromisoformat(str(connected_at)).replace(tzinfo=None)
        return age >= datetime.timedelta(days=1)
    except Exception:
        return True


async def run() -> None:
    await asyncio.sleep(90)  # let the server settle after a restart
    while True:
        system_health.beat(7200, "social")
        for row in accounts():
            project_id = str(row.get("project_id"))
            if not row.get("token"):
                continue
            try:
                state = status(project_id)
                if token_due(state.get("tokenDaysLeft"), row.get("connected_at"), _utcnow().replace(tzinfo=None)):
                    token, expires = await refresh_token(str(row["token"]))
                    _save_account(project_id, token=token, token_expires_at=expires)
                    logstore.log("info", "social", f"Refreshed the Instagram token for {row.get('username')}")
                if due(_local_now(), row.get("last_pull_at")):
                    await pull(project_id)
                    logstore.log("info", "social", f"Pulled Instagram numbers for {row.get('username')}")
            except Exception as e:
                logstore.log("error", "social", f"Instagram pull for {row.get('username') or project_id} failed: {e}")
        await asyncio.sleep(1800)


# --- Routes ---

router = APIRouter()


class AppCreds(BaseModel):
    appId: str = ""
    appSecret: str = ""


class Connect(BaseModel):
    project: str
    code: str


@router.get("/api/social")
def social_all():
    app_id, secret = app_creds()
    return {"success": True, "appReady": bool(app_id and secret),
            "appId": app_id or None, "redirectUri": redirect_uri(),
            "authorizeUrl": authorize_url() if app_id else None,
            "pages": [status(str(r["project_id"])) for r in accounts()]}


@router.post("/api/social/app")
def social_app(req: AppCreds):
    _save_secrets({"IG_APP_ID": req.appId.strip(), "IG_APP_SECRET": req.appSecret.strip()})
    return social_all()


@router.get("/api/social/{project}")
def social_status(project: str):
    return {"success": True, **status(project)}


@router.post("/api/social/connect")
async def social_connect(req: Connect):
    return {"success": True, **(await link_account(req.project, req.code))}


@router.delete("/api/social/{project}")
def social_forget(project: str):
    forget(project)
    return {"success": True, **status(project)}


@router.get("/api/social/{project}/overview")
def social_overview(project: str, days: int = 30):
    return {"success": True, **overview(project, days)}


@router.get("/api/social/{project}/posts")
def social_posts(project: str, limit: int = 30):
    return {"success": True, **posts(project, limit)}


@router.get("/api/social/media/{media_id}")
def social_post(media_id: str):
    return {"success": True, **post(media_id)}


@router.post("/api/social/{project}/refresh")
async def social_refresh(project: str):
    await pull(project)
    return {"success": True, **overview(project)}
