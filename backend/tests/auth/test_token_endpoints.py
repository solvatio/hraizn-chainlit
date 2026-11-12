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


def _expired_token(user: User) -> str:
    import datetime

    import jwt as pyjwt

    payload = user.to_dict()
    payload["exp"] = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        hours=1
    )
    return pyjwt.encode(
        payload, "test-secret-with-at-least-32-characters", algorithm="HS256"
    )


def test_login_passes_user_of_expired_previous_token_to_callback(
    client, user, test_config, monkeypatch
):
    callback = AsyncMock(return_value=user)
    monkeypatch.setattr(test_config.code, "password_auth_callback", callback)

    response = client.post(
        "/login",
        data={
            "username": "a",
            "password": "b",
            "previous_token": _expired_token(user),
        },
    )

    assert response.status_code == 200
    previous_user = callback.call_args.args[3]
    assert previous_user.identifier == "tester"


def test_expired_token_does_not_authenticate_requests(client, user):
    with pytest.raises(Exception):
        decode_jwt(_expired_token(user))


@pytest.mark.parametrize(
    "previous_token",
    [None, "garbage", "forged"],
)
def test_login_ignores_missing_or_invalid_previous_token(
    client, user, test_config, monkeypatch, previous_token
):
    import jwt as pyjwt

    if previous_token == "forged":
        previous_token = pyjwt.encode(
            {**user.to_dict(), "exp": 4102444800},
            "another-secret-with-at-least-32-characters",
            algorithm="HS256",
        )
    callback = AsyncMock(return_value=user)
    monkeypatch.setattr(test_config.code, "password_auth_callback", callback)

    data = {"username": "a", "password": "b"}
    if previous_token:
        data["previous_token"] = previous_token
    response = client.post("/login", data=data)

    assert response.status_code == 200
    assert callback.call_args.args[3] is None


def test_login_ignores_previous_token_of_another_mode(
    client, test_config, monkeypatch
):
    user = User(identifier="tester", metadata={"mode": None})
    callback = AsyncMock(return_value=user)
    monkeypatch.setattr(test_config.code, "password_auth_callback", callback)
    other_mode_user = User(identifier="tester", metadata={"mode": "other"})

    response = client.post(
        "/login",
        data={
            "username": "a",
            "password": "b",
            "previous_token": _expired_token(other_mode_user),
        },
    )

    assert response.status_code == 200
    assert callback.call_args.args[3] is None
