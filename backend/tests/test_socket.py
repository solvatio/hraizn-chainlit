import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import chainlit.socket as socket_module
from chainlit.session import WebsocketSession
from chainlit.socket import (
    _store_start_parameters_for_new_thread,
    edit_message,
    load_chat_parameters,
    message,
    validate_user_message_payload,
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


def user_message_payload(content):
    return {
        "message": {
            "id": "78ac539f-5ff5-4b5c-bc4e-a60f208854a4",
            "output": content,
        },
        "fileReferences": None,
    }


@pytest.mark.parametrize("content", ["", "12345"])
def test_user_message_validation_accepts_messages_at_or_below_limit(content):
    error, char_count = validate_user_message_payload(
        user_message_payload(content),
        char_limit=5,
    )

    assert error is None
    assert char_count == len(content)


def test_user_message_validation_rejects_message_above_limit():
    error, char_count = validate_user_message_payload(
        user_message_payload("123456"),
        char_limit=5,
    )

    assert error == "Your message exceeds the maximum allowed length of 5 characters."
    assert char_count == 6


@pytest.mark.parametrize(
    "payload",
    [None, {}, {"message": None}, {"message": {"output": None}}],
)
def test_user_message_validation_rejects_malformed_payload(payload):
    error, char_count = validate_user_message_payload(payload, char_limit=5)

    assert error == "The message could not be processed."
    assert char_count is None


@pytest.fixture
def message_rejection_context(monkeypatch: pytest.MonkeyPatch):
    session = Mock(spec=WebsocketSession)
    session.get_config.return_value = SimpleNamespace(
        features=SimpleNamespace(max_char_limit=5)
    )
    emitter = Mock()
    emitter.send_toast = AsyncMock()
    context = Mock(emitter=emitter)
    monkeypatch.setattr(WebsocketSession, "require", Mock(return_value=session))
    monkeypatch.setattr(socket_module, "init_ws_context", Mock(return_value=context))
    return session, context


async def test_oversized_client_message_is_rejected_before_processing(
    monkeypatch: pytest.MonkeyPatch,
    message_rejection_context,
):
    _, context = message_rejection_context
    process_message = AsyncMock()
    monkeypatch.setattr(socket_module, "process_message", process_message)

    await message("socket-id", user_message_payload("123456"))

    process_message.assert_not_awaited()
    context.emitter.send_toast.assert_awaited_once_with(
        "Your message exceeds the maximum allowed length of 5 characters.",
        type="error",
    )


async def test_valid_client_message_is_processed(
    monkeypatch: pytest.MonkeyPatch,
    message_rejection_context,
):
    session, context = message_rejection_context
    process_message = AsyncMock()
    monkeypatch.setattr(socket_module, "process_message", process_message)

    await message("socket-id", user_message_payload("12345"))
    await session.current_task

    process_message.assert_awaited_once_with(
        session,
        user_message_payload("12345"),
    )
    context.emitter.send_toast.assert_not_awaited()


async def test_oversized_edit_is_rejected_before_chat_context_access(
    monkeypatch: pytest.MonkeyPatch,
    message_rejection_context,
):
    _, context = message_rejection_context
    get_messages = Mock()
    monkeypatch.setattr(socket_module.chat_context, "get", get_messages)

    await edit_message("socket-id", user_message_payload("123456"))

    get_messages.assert_not_called()
    context.emitter.send_toast.assert_awaited_once_with(
        "Your message exceeds the maximum allowed length of 5 characters.",
        type="error",
    )
