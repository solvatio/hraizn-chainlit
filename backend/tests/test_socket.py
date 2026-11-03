import json

import pytest

from chainlit.socket import (
    _store_start_parameters_for_new_thread,
    load_chat_parameters,
)
from chainlit.user_session import user_sessions


def test_load_chat_parameters_limits_count_and_value_length():
    parameters = {f"parameter_{index}": "x" * 60 for index in range(10)}

    result = load_chat_parameters(json.dumps(parameters))

    assert list(result) == [f"parameter_{index}" for index in range(8)]
    assert all(value == "x" * 50 for value in result.values())


@pytest.mark.parametrize(
    "parameters",
    [json.dumps(["value"]), json.dumps({"parameter": 1})],
)
def test_load_chat_parameters_rejects_invalid_values(parameters):
    with pytest.raises(ConnectionRefusedError, match="Invalid chat parameters"):
        load_chat_parameters(parameters)


def test_new_thread_stores_a_copy_of_its_start_parameters():
    session_id = "new-thread-session"
    parameters = {"shop": "acme"}

    try:
        _store_start_parameters_for_new_thread(session_id, None, parameters)
        parameters["shop"] = "changed"

        assert user_sessions[session_id]["start_parameters"] == {"shop": "acme"}
    finally:
        user_sessions.pop(session_id, None)


def test_start_parameters_are_not_overwritten_for_an_existing_session():
    session_id = "reconnected-session"
    user_sessions[session_id] = {"start_parameters": {"shop": "original"}}

    try:
        _store_start_parameters_for_new_thread(
            session_id,
            None,
            {"shop": "from-reconnect"},
        )

        assert user_sessions[session_id]["start_parameters"] == {
            "shop": "original"
        }
    finally:
        user_sessions.pop(session_id, None)


def test_resumed_thread_does_not_store_current_parameters_as_start_parameters():
    session_id = "resumed-thread-session"

    _store_start_parameters_for_new_thread(
        session_id,
        "existing-thread-id",
        {"shop": "from-current-url"},
    )

    assert session_id not in user_sessions
