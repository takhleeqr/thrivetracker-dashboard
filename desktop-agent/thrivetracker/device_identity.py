from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from uuid import uuid4
import getpass
import json
import os
import socket

try:
    import winreg
except ImportError:
    winreg = None

from .app_paths import AppPaths


DEVICE_FILE_NAME = "device.json"


@dataclass(frozen=True)
class DeviceIdentity:
    install_id: str
    hostname: str
    os_username: str
    fingerprint_hash: str


def get_device_identity(paths: AppPaths) -> DeviceIdentity:
    install_id = _load_or_create_install_id(paths.base_dir / DEVICE_FILE_NAME)
    hostname = _hostname()
    os_username = _os_username()
    fingerprint_source = _machine_guid() or hostname
    fingerprint_hash = sha256(f"{fingerprint_source}|{hostname}".encode("utf-8")).hexdigest()

    return DeviceIdentity(
        install_id=install_id,
        hostname=hostname,
        os_username=os_username,
        fingerprint_hash=fingerprint_hash,
    )


def _load_or_create_install_id(path: Path) -> str:
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            install_id = str(data.get("install_id") or "").strip()
            if install_id:
                return install_id
        except json.JSONDecodeError:
            pass

    install_id = uuid4().hex
    path.write_text(json.dumps({"install_id": install_id}, indent=2), encoding="utf-8")
    return install_id


def _hostname() -> str:
    return (
        os.getenv("COMPUTERNAME")
        or os.getenv("HOSTNAME")
        or socket.gethostname()
        or "Unknown-PC"
    ).strip()[:120]


def _os_username() -> str:
    return getpass.getuser().strip()[:120]


def _machine_guid() -> str | None:
    if not winreg:
        return None

    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as key:
            value, _ = winreg.QueryValueEx(key, "MachineGuid")
            normalized = str(value).strip()
            return normalized or None
    except OSError:
        return None
