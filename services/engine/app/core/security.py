from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status


def create_session_token() -> str:
    return secrets.token_urlsafe(32)


def get_session_token_from_request(request: Request) -> str:
    return str(request.headers.get("x-session-token", "")).strip()


def enforce_session_token(request: Request) -> None:
    app_token = str(getattr(request.app.state, "session_token", "") or "")
    incoming = get_session_token_from_request(request)
    if not app_token or not incoming or incoming != app_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "unauthorized",
                "message": "Invalid or missing session token.",
                "recoverable": True,
                "context": {},
            },
        )

