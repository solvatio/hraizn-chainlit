import dataclasses
import json
import os
from typing import Callable, Any

import socketio
import tomli

from chainlit.config import config, ChainlitConfig, APP_ROOT, ChainlitConfigOverrides, FeaturesSettings, \
    UISettings, ProjectSettings, reload_config
from fastapi import APIRouter, Request

def load_settings(config_file: str):
    with open(config_file, "rb") as f:
        toml_dict = tomli.load(f)
        # Load project settings
        features_settings = toml_dict.get("features", {})
        ui_settings = toml_dict.get("UI", {})
        project_settings = toml_dict.get("project", {})
        features_settings = FeaturesSettings(**features_settings)
        ui_settings = UISettings(**ui_settings)
        project_settings = ProjectSettings(**project_settings)
        return {
            "features": features_settings,
            "ui": ui_settings,
            "project": project_settings
        }

def load_mode_configs() -> dict[str, ChainlitConfigOverrides]:
    configs: dict[str, ChainlitConfigOverrides] = {}

    chainlit_dir = os.path.join(APP_ROOT, ".chainlit")
    modes_dir = os.path.join(chainlit_dir, "modes")

    if not os.path.isdir(modes_dir):
        return configs

    for mode_name in os.listdir(modes_dir):
        mode_dir = os.path.join(modes_dir, mode_name)

        if not os.path.isdir(mode_dir):
            continue

        config_path = os.path.join(mode_dir, "config.toml")

        if not os.path.isfile(config_path):
            continue

        settings = load_settings(config_path)
        mode_config = ChainlitConfigOverrides(**settings)
        configs[mode_name] = mode_config

    return configs


@dataclasses.dataclass
class Mode:
    path: str|None = None
    name: str|None = None
    params: str|None = None
    default_name: str|None = None
    variant: str | None = None

    def get_decoded_params(self):
        return _decode_params(self.params) or {}

def _encode_params(query:dict):
    if not query:
        return None
    else:
        import json
        json_text = json.dumps(query)
        mode_params = "h_" + json_text.encode("utf-8").hex()
        return mode_params

def _decode_params(params: str) -> dict|None:
    if not params:
        return None
    if params.startswith("h_"):
        to_decode = params.removeprefix("h_")
        decoded = bytes.fromhex(to_decode).decode(encoding="utf-8")
        decoded = json.loads(decoded)
        return decoded
    return None

def get_mode_params_redirect(root_path: str, path: str, query:dict, modes: list[str]|None = None):
    if modes is None:
        modes = list(mode_configs.keys())
    if not query:
        return None
    if not path.endswith("/context") and not path.endswith("/context/"):
        return None
    else:
        mode = get_mode(root_path, path, modes)
        if not mode.name:
            return None
        else:
            mode_params = _encode_params(query)
            return f"{mode.name}/context/{mode_params}"

def get_mode_from_user_session(user_session):
    path_info = user_session.get("path_info", "")
    if path_info:
        root_path = config.run.root_path
        mode = get_mode(root_path=root_path, path=path_info)
        return mode
    return None

def get_mode(root_path: str, path: str, modes: list[str] = None) -> Mode:
    if modes is None:
        modes = list(mode_configs.keys())

    mode = None
    in_mode_params = False
    mode_params = None
    default_mode = modes[0] if modes else None

    # NEW: variant parsing via /m/<variant>
    in_variant = False
    variant = None

    if root_path:
        path = path.removeprefix(root_path)

    for segment in path.split("/"):
        if not segment:
            continue

        if in_mode_params:
            mode_params = segment
            in_mode_params = False
            continue

        if in_variant:
            variant = segment
            in_variant = False
            continue

        if mode and segment == "context":
            in_mode_params = True
            continue

        # NEW: reserviertes Segment "m"
        if mode and segment == "m":
            in_variant = True
            continue

        if mode:
            break

        if segment in modes:
            mode = segment

    if mode:
        built_path = mode
        if mode_params:
            built_path = f"{mode}/context/{mode_params}"
        if variant:
            built_path = f"{built_path}/m/{variant}"

        return Mode(name=mode, params=mode_params, path=built_path, default_name=default_mode)

    return Mode(name=None, params=None, path=None, default_name=default_mode)


def get_mode_from_request(request: Request):
    root_path = os.getenv("CHAINLIT_PARENT_ROOT_PATH", "") + os.getenv(
        "CHAINLIT_ROOT_PATH", ""
    )
    mode = get_mode(root_path=root_path, path=request.url.path)
    return mode.name

class ModeRouter:
    def __init__(self, router: APIRouter):
        self.underlying = router

    @staticmethod
    def get_mode_paths(base_path: str):
        return [
            base_path,
            "/{mode}" + base_path,
            "/{mode}/{context}" + base_path,
            "/{mode}/m/{variant}" + base_path
        ]

    def get(self, base_path: str):
        def decorator(func: Callable[..., Any]):
            for path in self.get_mode_paths(base_path):
                self.underlying.get(path)(func)
            return func

        return decorator

    def post(self, base_path: str):
        def decorator(func: Callable[..., Any]):
            for path in self.get_mode_paths(base_path):
                self.underlying.post(path)(func)
            return func

        return decorator

    def put(self, base_path: str):
        def decorator(func: Callable[..., Any]):
            for path in self.get_mode_paths(base_path):
                self.underlying.put(path)(func)
            return func

        return decorator

    def delete(self, base_path: str):
        def decorator(func: Callable[..., Any]):
            for path in self.get_mode_paths(base_path):
                self.underlying.delete(path)(func)
            return func

        return decorator


mode_configs: dict[str, ChainlitConfigOverrides] = {}

def get_mode_config(mode: str|None) -> ChainlitConfig:
    if not mode:
        return config
    override = mode_configs.get(mode)
    if override:
        return config.with_overrides(override)
    else:
        return config

async def reload(sio: socketio.AsyncServer):
    #reload_config()
    global mode_configs
    mode_configs = load_mode_configs()
    await sio.emit("reload", {})
