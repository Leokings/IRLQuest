"""Small compatibility shim for genlayer-test 0.29.2 on Windows.

The direct loader replaces fd 0 with a temporary file and immediately unlinks
that still-open file. POSIX permits that; Windows raises WinError 32. Defer only
those locked-file removals until pytest has restored stdin.
"""

import os


_ORIGINAL_UNLINK = os.unlink
_DEFERRED_PATHS = []


def _windows_tolerant_unlink(path, *args, **kwargs):
    try:
        return _ORIGINAL_UNLINK(path, *args, **kwargs)
    except PermissionError:
        _DEFERRED_PATHS.append(path)
        return None


if os.name == "nt":
    os.unlink = _windows_tolerant_unlink


def pytest_sessionfinish(session, exitstatus):
    del session, exitstatus
    if os.name != "nt":
        return
    os.unlink = _ORIGINAL_UNLINK
    for path in _DEFERRED_PATHS:
        try:
            _ORIGINAL_UNLINK(path)
        except (FileNotFoundError, PermissionError):
            pass
