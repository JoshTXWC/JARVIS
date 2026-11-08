"""Shared httpx client helpers.

On Windows, the default certifi CA bundle often fails TLS to Google/cloud
APIs (`CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`)
when the system uses corporate roots or the Windows store. Prefer the OS
trust store via `truststore` when available.
"""
from __future__ import annotations

import logging
import ssl
from typing import Any

import httpx

log = logging.getLogger("jarvis.http")

_verify: ssl.SSLContext | bool | str | None = None
_verify_ready = False


def ssl_verify() -> ssl.SSLContext | bool | str:
    """Return an httpx `verify=` value that works on this host."""
    global _verify, _verify_ready
    if _verify_ready and _verify is not None:
        return _verify
    try:
        import truststore

        _verify = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        log.debug("TLS verify via Windows/macOS trust store (truststore)")
    except Exception as e:  # noqa: BLE001
        try:
            import certifi

            _verify = certifi.where()
            log.debug("TLS verify via certifi (%s): %s", _verify, e)
        except Exception:
            _verify = True
            log.debug("TLS verify via defaults: %s", e)
    _verify_ready = True
    return _verify


def make_async_client(**kwargs: Any) -> httpx.AsyncClient:
    """AsyncClient with OS trust-store SSL unless caller overrides `verify`."""
    if "verify" not in kwargs:
        kwargs["verify"] = ssl_verify()
    return httpx.AsyncClient(**kwargs)


def make_client(**kwargs: Any) -> httpx.Client:
    """Sync Client with OS trust-store SSL unless caller overrides `verify`."""
    if "verify" not in kwargs:
        kwargs["verify"] = ssl_verify()
    return httpx.Client(**kwargs)
