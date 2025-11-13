import dataclasses
import json
from typing import Callable, Any

from chainlit.config import config
from fastapi import APIRouter

@dataclasses.dataclass
class Mode:
    path: str|None = None
    name: str|None = None
    params: str|None = None
    default_name: str|None = None

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
        modes = config.project.modes
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

def get_mode(root_path: str, path: str, modes: list[str] = None)  -> Mode:
    if modes is None:
        modes = config.project.modes
    mode = None
    in_mode_params = False
    mode_params = None
    default_mode = modes[0] if modes else None
    if root_path:
        path = path.removeprefix(root_path)
    for segment in path.split("/"):
        if segment:
            if in_mode_params:
                mode_params = segment
                break
            elif mode and segment == "context":
                in_mode_params = True
            elif mode:
                break
            if segment in modes:
                mode = segment
    if not mode_params and mode:
        return Mode(name = mode, params = None, path = mode, default_name=default_mode)
    if mode_params and mode:
        return Mode(name = mode, params = mode_params, path = f"{mode}/context/{mode_params}", default_name=default_mode)
    return Mode(name = None, params = None, path = None, default_name=default_mode)

class ModeRouterWrapper:
    """
    Wraps an existing APIRouter and registers routes under multiple profile prefixes.
    It does NOT subclass APIRouter; it delegates to the provided router instance.
    Usage:
        router = APIRouter(prefix="/api")
        wrapped = ProfileRouterWrapper(router, profiles=["selfcare", "agent"])
        @wrapped.post("/teams/events")
        async def teams_endpoint(...):
            ...
    """

    def __init__(self, router: APIRouter, modes=None):
        self.router = router
        # normalize profiles to strings without leading/trailing slashes
        self.modes = [str(p).strip("/") for p in modes or {""}]

    def _wrap_method(self, method_name: str) -> Callable[..., Callable]:
        """
        Return a decorator factory that registers the route on the underlying router
        for the given method_name and also registers profile-prefixed versions.
        """
        def method(path: str, *args: Any, **kwargs: Any):
            def decorator(func: Callable):
                # Register the original route on the underlying router
                # getattr(self.router, method_name)(path, *args, **kwargs)(func)

                # Register each profile-prefixed route
                for mode in self.modes:
                    prefixed_path = f"/{mode}{path}" # /agent/api
                    getattr(self.router, method_name)(prefixed_path, *args, **kwargs)(func)
                    mode_params_path = f"/{mode}/context/{{context}}{path}" # /agent/context/foobar/api
                    getattr(self.router, method_name)(mode_params_path, *args, **kwargs)(func)
                return func
            return decorator
        return method

    # Common HTTP methods (including HEAD)
    def get(self, path: str, *args: Any, **kwargs: Any):
        return self._wrap_method("get")(path, *args, **kwargs)

    def post(self, path: str, *args: Any, **kwargs: Any):
        return self._wrap_method("post")(path, *args, **kwargs)

    def put(self, path: str, *args: Any, **kwargs: Any):
        return self._wrap_method("put")(path, *args, **kwargs)

    def delete(self, path: str, *args: Any, **kwargs: Any):
        return self._wrap_method("delete")(path, *args, **kwargs)

    def patch(self, path: str, *args: Any, **kwargs: Any):
        return self._wrap_method("patch")(path, *args, **kwargs)

    def head(self, path: str, *args: Any, **kwargs: Any):
        return self._wrap_method("head")(path, *args, **kwargs)

    # Optionally expose the underlying router for direct access
    @property
    def underlying(self) -> APIRouter:
        return self.router


    # Define standard HTTP methods
    def get(self, path: str, *args, **kwargs): return self._wrap_method("get")(path, *args, **kwargs)
    def post(self, path: str, *args, **kwargs): return self._wrap_method("post")(path, *args, **kwargs)
    def put(self, path: str, *args, **kwargs): return self._wrap_method("put")(path, *args, **kwargs)
    def delete(self, path: str, *args, **kwargs): return self._wrap_method("delete")(path, *args, **kwargs)
    def patch(self, path: str, *args, **kwargs): return self._wrap_method("patch")(path, *args, **kwargs)
