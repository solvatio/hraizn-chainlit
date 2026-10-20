from chainlit.callbacks import on_persist_session
from chainlit.session import HTTPSession
from chainlit.user_session import user_sessions


async def test_user_session_set_get(mock_chainlit_context, user_session):
    async with mock_chainlit_context as context:
        # Test setting a value
        user_session.set("test_key", "test_value")

        # Test getting the value
        assert user_session.get("test_key") == "test_value"

        # Test getting a default value for a non-existent key
        assert user_session.get("non_existent_key", "default") == "default"

        # Test getting session-related values
        assert user_session.get("id") == context.session.id
        assert user_session.get("env") == context.session.user_env
        assert (
            user_session.get("chatParameters") == context.session.chat_parameters
        )


async def test_persist_session_callback_modifies_only_session_copy(test_config):
    session = HTTPSession(
        id="persist-session-test",
        client_type="webapp",
    )
    state = object()
    session_values = {
        "chat_state": state,
        "temporary_value": "do-not-persist",
    }
    user_sessions[session.id] = session_values

    @on_persist_session
    def persist_session(session_copy: dict) -> None:
        session_copy.pop("temporary_value", None)
        session_copy["chat_state"] = {"serialized": True}

    assert test_config.code.on_persist_session is not None

    try:
        metadata = session.to_persistable()
    finally:
        user_sessions.pop(session.id, None)

    assert metadata["chat_state"] == {"serialized": True}
    assert "temporary_value" not in metadata
    assert session_values["chat_state"] is state
    assert session_values["temporary_value"] == "do-not-persist"
