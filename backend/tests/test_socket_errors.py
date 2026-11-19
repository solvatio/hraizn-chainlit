"""The client reacts to the messages of refused socket connections, so the
backend constants and their client copy must stay identical."""

import re
from pathlib import Path

import pytest

from chainlit.socket_errors import SocketConnectError

CLIENT_FILE = (
    Path(__file__).resolve().parents[2] / "libs" / "react-client" / "src" / "socketErrors.ts"
)


def _backend_errors() -> dict[str, str]:
    return {
        name: value
        for name, value in vars(SocketConnectError).items()
        if name.isupper() and isinstance(value, str)
    }


def _client_errors() -> dict[str, str]:
    source = CLIENT_FILE.read_text(encoding="utf-8")
    return dict(re.findall(r"^\s*([A-Z_]+):\s*'([^']*)'", source, re.MULTILINE))


@pytest.mark.skipif(not CLIENT_FILE.exists(), reason="client sources not available")
def test_client_uses_the_same_socket_connect_errors():
    assert _client_errors() == _backend_errors()
    assert len(_backend_errors()) == 3
