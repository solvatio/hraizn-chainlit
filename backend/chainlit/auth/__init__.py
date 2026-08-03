import os

from fastapi import Depends, HTTPException, Request

from chainlit.data import get_data_layer
from chainlit.logger import logger
from chainlit.oauth_providers import get_configured_oauth_providers

from .cookie import (
    OAuth2PasswordBearerWithCookie,
    clear_auth_cookie,
    get_token_from_cookies,
    set_auth_cookie,
)
from .jwt import create_jwt, decode_jwt, get_jwt_secret
from chainlit.modes import get_mode_from_request, mode_configs, get_mode_config

reuseable_oauth = OAuth2PasswordBearerWithCookie(tokenUrl="/login", auto_error=False)


def ensure_jwt_secret():
    pass
    if require_login() and get_jwt_secret() is None:
        raise ValueError(
            "You must provide a JWT secret in the environment to use authentication. Run `chainlit create-secret` to generate one."
        )


def is_oauth_enabled(mode: str = None):
    mode_config = get_mode_config(mode)
    if mode:
        return mode_config.code.oauth_callback and len(get_configured_oauth_providers(mode)) > 0 and mode_config.project.azure_oauth_callback
    return mode_config.code.oauth_callback and len(get_configured_oauth_providers()) > 0

def require_login(mode: str|None = None):
    config = get_mode_config(mode)
    if config.project.login:
        return True
    if mode_configs:
        return False
    return (
        bool(os.environ.get("CHAINLIT_CUSTOM_AUTH"))
        or config.code.password_auth_callback is not None
        or config.code.header_auth_callback is not None
        or is_oauth_enabled(None)
    )



def get_configuration(mode: str):
    config = get_mode_config(mode)
    return {
        "requireLogin": require_login(mode),
        "passwordAuth": config.code.password_auth_callback is not None and config.project.password_auth_callback,
        "headerAuth": config.code.header_auth_callback is not None,
        "anonymousAuth": config.project.anonymous_auth_callback,
        "oauthProviders": get_configured_oauth_providers(mode) if is_oauth_enabled(mode) else [],
        "default_theme": config.ui.default_theme,
        "ui": {
            "login_page_image": config.ui.login_page_image,
            "login_page_image_filter": config.ui.login_page_image_filter,
            "login_page_image_dark_filter": config.ui.login_page_image_dark_filter,
        },
    }


async def authenticate_user(mode_name: str = None, token: str = Depends(reuseable_oauth)):
    try:
        user = decode_jwt(token)
    except Exception as e:
        raise HTTPException(
            status_code=401, detail="Invalid authentication token"
        ) from e

    if user.metadata.get("mode", None) != mode_name:
        raise HTTPException(
            status_code=401, detail="Invalid authentication token"
        )

    if data_layer := get_data_layer():
        # Get or create persistent user if we've a data layer available.
        try:
            persisted_user = await data_layer.get_user(user.identifier)
            if persisted_user is None:
                persisted_user = await data_layer.create_user(user)
                assert persisted_user
        except Exception as e:
            logger.exception("Unable to get persisted_user from data layer: %s", e)
            return user

        if user and user.display_name:
            # Copy ephemeral display_name from authenticated user to persistent user.
            persisted_user.display_name = user.display_name

        return persisted_user

    return user


async def get_current_user(request: Request = None, mode_name: str = None, token: str = Depends(reuseable_oauth)):
    if request is not None:
        mode_name = get_mode_from_request(request)
    else:
        mode_name = mode_name
    if not require_login(mode=mode_name):
        return None

    return await authenticate_user(mode_name=mode_name, token=token)


__all__ = [
    "clear_auth_cookie",
    "create_jwt",
    "get_configuration",
    "get_current_user",
    "get_token_from_cookies",
    "set_auth_cookie",
]
