"""Errors raised by the Graunt client."""

from __future__ import annotations

from typing import Any, Mapping


class GrauntError(Exception):
    """The Graunt API answered with an error status.

    Usually the body carries Graunt's error envelope
    ``{"ok": false, "error": {"code", "message", "details"?}}``.
    """

    def __init__(
        self,
        *,
        status: int,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        #: HTTP status code of the response.
        self.status = status
        #: Stable machine-readable code, e.g. ``NOT_FOUND`` or ``RATE_LIMITED``;
        #: ``HTTP_<status>`` when the body is not Graunt's envelope.
        self.code = code
        #: The error message.
        self.message = message
        #: Extra fields the API attached to the error, when it sent any.
        self.details = dict(details) if details is not None else None
        #: Seconds to wait before retrying, from a numeric ``Retry-After`` header.
        self.retry_after_seconds = retry_after_seconds

    def __repr__(self) -> str:
        return f"GrauntError(status={self.status!r}, code={self.code!r}, message={self.message!r})"


class GrauntConnectionError(Exception):
    """The request produced no HTTP response: DNS, connection, TLS or timeout failure.

    The underlying error is chained as ``__cause__``.
    """
