"""Application logging that omits request bodies, response bodies and client addresses.

Uvicorn's own access log is separate. Run it with ``--no-access-log`` so that
log, which includes the client address, stays off.
"""

import logging

from starlette.types import ASGIApp, Message, Receive, Scope, Send

APP_LOGGER_NAME = "ingradient"


def parse_log_level(level_name: str) -> int:
    """Map a level name such as ``INFO`` to a logging level number."""

    level = logging.getLevelNamesMapping().get(level_name.upper())
    if level is None:
        raise RuntimeError(
            "INGRADIENT_LOG_LEVEL must be a logging level such as INFO, "
            f"not {level_name!r}"
        )
    return level


def configure_logging(level_name: str) -> logging.Logger:
    """Attach one stream handler to the application logger.

    Propagation is off so records do not also reach Uvicorn's access logger.
    """

    logger = logging.getLogger(APP_LOGGER_NAME)
    logger.handlers.clear()
    logger.setLevel(parse_log_level(level_name))
    logger.propagate = False

    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logger.addHandler(handler)
    return logger


class RequestCompletedLogMiddleware:
    """Log method, route template and status after each HTTP request.

    Only the application-owned route template is recorded. Unknown URLs and
    route parameter values can contain private data, so neither is recorded.
    The middleware never reads the body, query string or ``scope["client"]``.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                raw_status = message.get("status")
                if isinstance(raw_status, int):
                    status_code = raw_status
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            raw_method = scope.get("method")
            method = raw_method if raw_method in _HTTP_METHODS else "OTHER"
            route_path = getattr(scope.get("route"), "path", None)
            path = route_path if isinstance(route_path, str) else "<unmatched>"
            logging.getLogger(APP_LOGGER_NAME).info(
                "request completed method=%s path=%s status=%s",
                method,
                path,
                status_code,
            )


_HTTP_METHODS = frozenset(
    {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"}
)
