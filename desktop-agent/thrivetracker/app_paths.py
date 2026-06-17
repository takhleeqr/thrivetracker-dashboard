from dataclasses import dataclass
from pathlib import Path
import os

from . import __app_name__


@dataclass(frozen=True)
class AppPaths:
    base_dir: Path
    config_file: Path
    queue_dir: Path
    logs_dir: Path
    temp_dir: Path


def get_app_paths() -> AppPaths:
    app_data = os.getenv("APPDATA")
    base_dir = Path(app_data) / __app_name__ if app_data else Path.home() / f".{__app_name__.lower()}"

    return AppPaths(
        base_dir=base_dir,
        config_file=base_dir / "config.json",
        queue_dir=base_dir / "queue",
        logs_dir=base_dir / "logs",
        temp_dir=base_dir / "temp",
    )


def ensure_app_dirs(paths: AppPaths) -> None:
    paths.base_dir.mkdir(parents=True, exist_ok=True)
    paths.queue_dir.mkdir(parents=True, exist_ok=True)
    paths.logs_dir.mkdir(parents=True, exist_ok=True)
    paths.temp_dir.mkdir(parents=True, exist_ok=True)
