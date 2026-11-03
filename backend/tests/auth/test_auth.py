from unittest.mock import AsyncMock

import pytest

from chainlit.auth import authenticate_user
from chainlit.user import User


async def test_authentication_does_not_persist_new_user(
    monkeypatch: pytest.MonkeyPatch,
):
    user = User(identifier="new-user", metadata={"mode": None})
    data_layer = AsyncMock()
    data_layer.get_user.return_value = None
    monkeypatch.setattr("chainlit.auth.decode_jwt", lambda token: user)
    monkeypatch.setattr("chainlit.auth.get_data_layer", lambda: data_layer)

    authenticated_user = await authenticate_user(mode_name=None, token="token")

    assert authenticated_user is user
    data_layer.get_user.assert_awaited_once_with(user.identifier)
    data_layer.create_user.assert_not_awaited()
