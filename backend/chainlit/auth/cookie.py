import os
from typing import Literal, Optional, cast

from fastapi import Request, Response
from fastapi.exceptions import HTTPException
from fastapi.security.base import SecurityBase
from fastapi.security.utils import get_authorization_scheme_param
from starlette.status import HTTP_401_UNAUTHORIZED

""" Module level cookie settings. """
_cookie_samesite = cast(
    Literal["lax", "strict", "none"],
    os.environ.get("CHAINLIT_COOKIE_SAMESITE", "lax"),
)

assert _cookie_samesite in [
    "lax",
    "strict",
    "none",
], (
    "Invalid value for CHAINLIT_COOKIE_SAMESITE. Must be one of 'lax', 'strict' or 'none'."
)
_cookie_secure = _cookie_samesite == "none"
if _cookie_root_path := os.environ.get("CHAINLIT_ROOT_PATH", None):
    _cookie_path = os.environ.get(_cookie_root_path, "/")
else:
    _cookie_path = os.environ.get("CHAINLIT_AUTH_COOKIE_PATH", "/")
_state_cookie_lifetime = 3 * 60  # 3m
_auth_cookie_name = os.environ.get("CHAINLIT_AUTH_COOKIE_NAME", "access_token")
_token_handoff_cookie_name = "token_handoff"
_token_handoff_cookie_lifetime = 60  # 1m
_state_cookie_name = "oauth_state"
_url_state_cookie_name = "url_state"


class OAuth2PasswordBearerHeader(SecurityBase):
    """
    OAuth2 password flow reading the token from the Authorization header only.

    Cookies are deliberately not accepted: browsers block third-party cookies
    in embedded (iframe) chats, so the bearer token is the single auth path.
    """

    def __init__(
        self,
        tokenUrl: str,
        scheme_name: Optional[str] = None,
        auto_error: bool = True,
    ):
        self.tokenUrl = tokenUrl
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error

    async def __call__(self, request: Request) -> Optional[str]:
        authorization = request.headers.get("Authorization")
        scheme, token = get_authorization_scheme_param(authorization)

        if not authorization or scheme.lower() != "bearer" or not token:
            if self.auto_error:
                raise HTTPException(
                    status_code=HTTP_401_UNAUTHORIZED,
                    detail="Not authenticated",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return None

        return token


def _get_chunked_cookie(cookies: dict[str, str], name: str) -> Optional[str]:
    """Read a cookie that may have been split into <name>_<i> chunks."""
    if value := cookies.get(name):
        return value

    chunk_parts = []

    i = 0
    while True:
        cookie_key = f"{name}_{i}"
        if cookie_key not in cookies:
            break

        chunk_parts.append(cookies[cookie_key])
        i += 1

    joined = "".join(chunk_parts)

    return joined if joined != "" else None


def _clear_chunked_cookie(
    request: Request,
    response: Response,
    name: str,
    samesite: Literal["lax", "strict", "none"],
):
    for k in [k for k in request.cookies.keys() if k.startswith(name)]:
        response.delete_cookie(
            key=k, path=_cookie_path, secure=_cookie_secure, samesite=samesite
        )


def clear_auth_cookie(request: Request, response: Response):
    """
    Remove auth cookies left over from the former cookie based authentication.
    Auth cookies are no longer set; the access token is returned in the login
    response body and sent as bearer token by the client.
    """
    _clear_chunked_cookie(request, response, _auth_cookie_name, _cookie_samesite)


def set_token_handoff_cookie(response: Response, token: str):
    """
    Hand the access token over to the frontend after a redirect based login
    (OAuth). The token must not appear in a URL, so it travels in a short-lived
    HttpOnly cookie that the frontend exchanges once via POST /auth/token.

    SameSite=Lax: the cookie is only needed in the first-party redirect flow
    and must never be sent with cross-site requests.
    """
    _chunk_size = 3000
    chunks = [token[i : i + _chunk_size] for i in range(0, len(token), _chunk_size)]

    for i, chunk in enumerate(chunks):
        response.set_cookie(
            key=f"{_token_handoff_cookie_name}_{i}",
            value=chunk,
            httponly=True,
            secure=_cookie_secure,
            samesite="lax",
            path=_cookie_path,
            max_age=_token_handoff_cookie_lifetime,
        )


def get_token_from_handoff_cookie(request: Request) -> Optional[str]:
    return _get_chunked_cookie(request.cookies, _token_handoff_cookie_name)


def clear_token_handoff_cookie(request: Request, response: Response):
    _clear_chunked_cookie(request, response, _token_handoff_cookie_name, "lax")


def set_url_state_cookie(response: Response, url_state: str):
    response.set_cookie(
        _url_state_cookie_name,
        url_state,
        httponly=True,
        samesite=_cookie_samesite,
        secure=_cookie_secure,
        max_age=_state_cookie_lifetime,
    )

def set_oauth_state_cookie(response: Response, token: str):
    response.set_cookie(
        _state_cookie_name,
        token,
        httponly=True,
        samesite=_cookie_samesite,
        secure=_cookie_secure,
        max_age=_state_cookie_lifetime,
    )


def validate_oauth_state_cookie(request: Request, state: str):
    """Check the state from the oauth provider against the browser cookie."""

    oauth_state = request.cookies.get(_state_cookie_name)

    if oauth_state != state:
        raise Exception("oauth state does not correspond")

def get_url_state_from_cookie(request: Request):
    return request.cookies.get(_url_state_cookie_name)


def clear_oauth_state_cookie(response: Response):
    """Oauth complete, delete state token."""
    response.delete_cookie(_state_cookie_name)  # Do we set path here?


def clear_url_state_cookie(response: Response):
    """Oauth complete, delete url state."""
    response.delete_cookie(_url_state_cookie_name)
