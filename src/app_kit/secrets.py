"""Descriptor-based runtime secrets; no values escape through configuration errors."""

import os
import stat
from pathlib import Path


class UnsafeSecret(ValueError):
    pass


def read_secret(path: Path) -> str:
    # ASI-004/012: reject links, writable/public files and blocking devices.
    # Docker secrets may be 0444 on a read-only, per-container secret mount;
    # we deliberately do not allow that broad exception. Mount private 0400/0600 files.
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.geteuid()):
                raise UnsafeSecret("Unsafe secret source")
            if info.st_mode & 0o077 or info.st_nlink != 1:
                raise UnsafeSecret("Unsafe secret source")
            raw = os.read(fd, 8193)
        finally:
            os.close(fd)
        value = raw.decode("ascii").strip()
        if len(raw) > 8192 or not value or any(ord(char) < 33 or ord(char) > 126 for char in value):
            raise UnsafeSecret("Invalid secret source")
        return value
    except (OSError, UnicodeError):
        raise UnsafeSecret("Secret unavailable") from None
