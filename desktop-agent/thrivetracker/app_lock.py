from dataclasses import dataclass
from pathlib import Path
import os

try:
    import msvcrt
except ImportError:  # pragma: no cover - Windows app safeguard
    msvcrt = None


class AppLockError(RuntimeError):
    pass


@dataclass
class AppLock:
    path: Path
    handle: object | None = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(self.path, "a+b")
        if msvcrt is None:
            return

        try:
            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            self.handle.truncate()
            self.handle.write(str(os.getpid()).encode("utf-8"))
            self.handle.flush()
        except OSError as error:
            self.release()
            raise AppLockError("Another copy of the tracker is already running.") from error

    def release(self) -> None:
        if not self.handle:
            return

        if msvcrt is not None:
            try:
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass

        try:
            self.handle.close()
        finally:
            self.handle = None
