"""The access token travels in response bodies and headers, never in an auth cookie."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from chainlit.auth import create_jwt, decode_jwt
from chainlit.config import ChainlitConfig
from chainlit.server import app
from chainlit.socket import _authenticate_connection, _get_token
from chainlit.user import User


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, test_config: ChainlitConfig):
    monkeypatch.setenv("CHAINLIT_AUTH_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setattr("chainlit.server.get_mode_from_request", lambda request: None)
    monkeypatch.setattr(
        "chainlit.modes.get_mode_from_request", lambda request: None
    )
    return TestClient(app)


@pytest.fixture
def user():
    return User(identifier="tester", metadata={"mode": None})


def _auth_cookies(response):
    return [
        c
        for c in response.headers.get_list("set-cookie")
        if c.startswith("access_token") and "max-age=0" not in c.lower()
    ]


def test_password_login_returns_token_in_body_and_sets_no_cookie(
    client, user, test_config, monkeypatch
):
    monkeypatch.setattr(
        test_config.code, "password_auth_callback", AsyncMock(return_value=user)
    )

    response = client.post("/login", data={"username": "a", "password": "b"})

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert decode_jwt(body["access_token"]).identifier == "tester"
    assert _auth_cookies(response) == []


def test_jwt_auth_does_not_extend_the_token(client, user):
    token = create_jwt(user)

    response = client.post("/auth/jwt", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["access_token"] == token
    assert _auth_cookies(response) == []


def test_jwt_auth_rejects_token_of_another_mode(client):
    token = create_jwt(User(identifier="tester", metadata={"mode": "other"}))

    response = client.post("/auth/jwt", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_token_exchange_is_single_use(client, user):
    token = create_jwt(user)
    client.cookies.set("token_handoff_0", token)

    response = client.post("/auth/token")

    assert response.status_code == 200
    assert response.json()["access_token"] == token
    cleared = response.headers.get_list("set-cookie")
    assert any(
        c.startswith("token_handoff_0=") and "max-age=0" in c.lower() for c in cleared
    )


def test_token_exchange_without_handoff_cookie_is_unauthorized(client):
    assert client.post("/auth/token").status_code == 401


def test_token_exchange_rejects_invalid_token(client):
    client.cookies.set("token_handoff_0", "not-a-jwt")

    assert client.post("/auth/token").status_code == 401


def test_socket_token_is_read_from_handshake_auth():
    assert _get_token({"token": "abc"}) == "abc"
    assert _get_token({"token": ""}) is None
    assert _get_token({"token": 123}) is None
    assert _get_token({}) is None
    assert _get_token(None) is None


async def test_socket_connection_ignores_auth_cookie():
    environ = {"HTTP_COOKIE": "access_token=cookie-token", "PATH_INFO": ""}

    assert await _authenticate_connection(environ, {}) == (None, None)


def _lifetime(token: str) -> int:
    import jwt as pyjwt

    claims = pyjwt.decode(token, options={"verify_signature": False})
    return claims["exp"] - claims["iat"]


@pytest.mark.parametrize(
    "metadata, expected",
    [
        ({"mode": None, "anonymous": True}, 3153600000),
        ({"mode": None, "anonymous": False}, 43200),
        ({"mode": None}, 43200),
        ({"mode": None, "anonymous": "true"}, 43200),
    ],
)
def test_anonymous_users_get_their_own_token_lifetime(
    client, test_config, monkeypatch, metadata, expected
):
    monkeypatch.setattr(test_config.project, "user_session_timeout", 43200)
    monkeypatch.setattr(
        test_config.project, "anonymous_user_session_timeout", 3153600000
    )
    monkeypatch.setattr("chainlit.auth.jwt.config", test_config)

    token = create_jwt(User(identifier="u", metadata=metadata))

    assert abs(_lifetime(token) - expected) <= 1
    assert decode_jwt(token).identifier == "u"


def test_without_anonymous_lifetime_all_users_get_the_session_timeout(
    client, test_config, monkeypatch
):
    monkeypatch.setattr(test_config.project, "user_session_timeout", 43200)
    monkeypatch.setattr(test_config.project, "anonymous_user_session_timeout", None)
    monkeypatch.setattr("chainlit.auth.jwt.config", test_config)

    token = create_jwt(User(identifier="u", metadata={"anonymous": True}))

    assert abs(_lifetime(token) - 43200) <= 1
