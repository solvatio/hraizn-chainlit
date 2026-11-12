import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt as pyjwt

from chainlit.config import config
from chainlit.user import User


def get_jwt_secret() -> Optional[str]:
    return os.environ.get("CHAINLIT_AUTH_SECRET")


def create_jwt(data: User) -> str:
    to_encode: Dict[str, Any] = data.to_dict()
    to_encode.update(
        {
            "exp": datetime.now(timezone.utc)
            + timedelta(seconds=config.project.user_session_timeout),
            "iat": datetime.now(timezone.utc),  # Add issued at time
        }
    )

    secret = get_jwt_secret()
    assert secret
    encoded_jwt = pyjwt.encode(to_encode, secret, algorithm="HS256")
    return encoded_jwt


def _decode_jwt(token: str, verify_exp: bool) -> User:
    secret = get_jwt_secret()
    assert secret

    dict = pyjwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        options={"verify_signature": True, "verify_exp": verify_exp},
    )
    del dict["exp"]
    return User(**dict)


def decode_jwt(token: str) -> User:
    return _decode_jwt(token, verify_exp=True)


def decode_expired_jwt(token: str) -> User:
    """Decode a token issued by this server, even if it has expired.

    The signature is still verified. The result does not authenticate a
    request: it only tells a login callback which user the client was before,
    so that the callback can decide to hand out the same identity again.
    """
    return _decode_jwt(token, verify_exp=False)
