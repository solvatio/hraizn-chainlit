import json

import pytest

from chainlit.socket import load_chat_parameters


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
