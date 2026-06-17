from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from mss import mss
from PIL import Image


@dataclass(frozen=True)
class CapturedScreenshot:
    file_path: Path
    storage_key: str
    captured_at: datetime
    file_size_bytes: int


class ScreenshotService:
    def __init__(self, temp_dir: Path, quality: int) -> None:
        self.temp_dir = temp_dir
        self.quality = max(1, min(100, quality))

    def capture(self, user_id: str) -> CapturedScreenshot:
        captured_at = datetime.now(timezone.utc)
        storage_key = self._build_storage_key(user_id, captured_at)
        file_path = self.temp_dir / storage_key
        file_path.parent.mkdir(parents=True, exist_ok=True)

        image = self._capture_all_monitors()
        image.save(file_path, format="JPEG", quality=self.quality, optimize=True)

        return CapturedScreenshot(
            file_path=file_path,
            storage_key=storage_key,
            captured_at=captured_at,
            file_size_bytes=file_path.stat().st_size,
        )

    def _capture_all_monitors(self) -> Image.Image:
        with mss() as screen_capture:
            monitor = screen_capture.monitors[0]
            screenshot = screen_capture.grab(monitor)
            return Image.frombytes("RGB", screenshot.size, screenshot.rgb)

    def _build_storage_key(self, user_id: str, captured_at: datetime) -> str:
        return str(
            PurePosixPath(
                user_id,
                captured_at.strftime("%Y-%m-%d"),
                f"{captured_at.strftime('%H-%M-%S')}.jpg",
            )
        )
