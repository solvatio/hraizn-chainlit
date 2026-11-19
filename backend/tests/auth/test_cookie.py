import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import Response

from chainlit.auth import clear_auth_cookie
from chainlit.auth.cookie import (
    OAuth2PasswordBearerHeader,
    clear_token_handoff_cookie,
    get_token_from_handoff_cookie,
    set_token_handoff_cookie,
)

bearer = OAuth2PasswordBearerHeader(tokenUrl="/login", auto_error=False)
strict_bearer = OAuth2PasswordBearerHeader(tokenUrl="/login")


@pytest.fixture
def test_app():
    app = FastAPI()

    @app.get("/token")
    async def token_endpoint(token: str = Depends(bearer)):
        return {"token": token}

    @app.get("/strict-token")
    async def strict_token_endpoint(token: str = Depends(strict_bearer)):
        return {"token": token}

    @app.post("/set-handoff")
    async def set_handoff_endpoint(token: str):
        response = Response()
        set_token_handoff_cookie(response, token)
        return response

    @app.get("/get-handoff")
    async def get_handoff_endpoint(request: Request):
        return {"token": get_token_from_handoff_cookie(request)}

    @app.delete("/clear-handoff")
    async def clear_handoff_endpoint(request: Request):
        response = Response()
        clear_token_handoff_cookie(request, response)
        return response

    @app.delete("/clear-auth-cookie")
    async def clear_auth_cookie_endpoint(request: Request):
        response = Response()
        clear_auth_cookie(request, response)
        return response

    return app


@pytest.fixture
def client(test_app):
    return TestClient(test_app)


def test_token_is_read_from_authorization_header(client):
    response = client.get("/token", headers={"Authorization": "Bearer abc"})

    assert response.json()["token"] == "abc"


def test_auth_cookie_is_not_accepted(client):
    """The former auth cookie must no longer authenticate a request."""
    client.cookies.set("access_token", "cookie-token")

    response = client.get("/token")

    assert response.json()["token"] is None


def test_non_bearer_scheme_is_rejected(client):
    response = client.get("/token", headers={"Authorization": "Basic abc"})

    assert response.json()["token"] is None


def test_missing_token_raises_with_auto_error(client):
    response = client.get("/strict-token")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_legacy_auth_cookies_are_cleared(client):
    client.cookies.set("access_token", "legacy")
    client.cookies.set("access_token_0", "legacy-chunk")

    response = client.delete("/clear-auth-cookie")

    cleared = response.headers.get_list("set-cookie")
    assert any(c.startswith("access_token=") for c in cleared)
    assert any(c.startswith("access_token_0=") for c in cleared)


@pytest.mark.parametrize("token", ["x" * 1000, "x" * 7000])
def test_handoff_cookie_lifecycle(client, token):
    """Short and chunked tokens survive the handoff and are removed afterwards."""
    set_response = client.post("/set-handoff", params={"token": token})

    set_cookies = set_response.headers.get_list("set-cookie")
    assert set_cookies
    for cookie in set_cookies:
        lowered = cookie.lower()
        assert "httponly" in lowered
        assert "samesite=lax" in lowered
        assert "max-age=60" in lowered

    assert client.get("/get-handoff").json()["token"] == token

    client.delete("/clear-handoff")
    assert client.get("/get-handoff").json()["token"] is None
