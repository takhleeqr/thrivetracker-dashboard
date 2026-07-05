from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import json


@dataclass(frozen=True)
class PersistedSessionState:
    entry_id: str | None
    project_id: str | None
    mode: str
    started_at: datetime | None
    break_started_at: datetime | None
    last_runtime_at: datetime
    last_heartbeat_at: datetime | None


class SessionStateStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> PersistedSessionState | None:
        if not self.path.exists():
            return None

        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

        mode = str(payload.get("mode") or "").strip()
        last_runtime_at = _parse_datetime(payload.get("last_runtime_at"))
        if not mode or last_runtime_at is None:
            return None

        return PersistedSessionState(
            entry_id=_clean_text(payload.get("entry_id")),
            project_id=_clean_text(payload.get("project_id")),
            mode=mode,
            started_at=_parse_datetime(payload.get("started_at")),
            break_started_at=_parse_datetime(payload.get("break_started_at")),
            last_runtime_at=last_runtime_at,
            last_heartbeat_at=_parse_datetime(payload.get("last_heartbeat_at")),
        )

    def save_tracking(
        self,
        entry_id: str,
        project_id: str | None,
        started_at: datetime,
        last_runtime_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._write(
            {
                "entry_id": entry_id,
                "project_id": project_id,
                "mode": "tracking",
                "started_at": started_at.astimezone(timezone.utc).isoformat(),
                "break_started_at": None,
                "last_runtime_at": last_runtime_at.astimezone(timezone.utc).isoformat(),
                "last_heartbeat_at": last_heartbeat_at.astimezone(timezone.utc).isoformat() if last_heartbeat_at else None,
            }
        )

    def save_break(
        self,
        project_id: str | None,
        break_started_at: datetime,
        last_runtime_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._write(
            {
                "entry_id": None,
                "project_id": project_id,
                "mode": "break",
                "started_at": None,
                "break_started_at": break_started_at.astimezone(timezone.utc).isoformat(),
                "last_runtime_at": last_runtime_at.astimezone(timezone.utc).isoformat(),
                "last_heartbeat_at": last_heartbeat_at.astimezone(timezone.utc).isoformat() if last_heartbeat_at else None,
            }
        )

    def save_shutdown(
        self,
        entry_id: str,
        project_id: str | None,
        started_at: datetime,
        shutdown_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._write(
            {
                "entry_id": entry_id,
                "project_id": project_id,
                "mode": "shutdown_pending",
                "started_at": started_at.astimezone(timezone.utc).isoformat(),
                "break_started_at": None,
                "last_runtime_at": shutdown_at.astimezone(timezone.utc).isoformat(),
                "last_heartbeat_at": last_heartbeat_at.astimezone(timezone.utc).isoformat() if last_heartbeat_at else None,
            }
        )

    def save_connectivity_pending_stop(
        self,
        entry_id: str,
        project_id: str | None,
        started_at: datetime,
        stopped_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._save_pending_stop(
            mode="connectivity_pending_stop",
            entry_id=entry_id,
            project_id=project_id,
            started_at=started_at,
            stopped_at=stopped_at,
            last_heartbeat_at=last_heartbeat_at,
        )

    def save_idle_pending_stop(
        self,
        entry_id: str,
        project_id: str | None,
        started_at: datetime,
        stopped_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._save_pending_stop(
            mode="idle_pending_stop",
            entry_id=entry_id,
            project_id=project_id,
            started_at=started_at,
            stopped_at=stopped_at,
            last_heartbeat_at=last_heartbeat_at,
        )

    def save_sleep_pending_stop(
        self,
        entry_id: str,
        project_id: str | None,
        started_at: datetime,
        stopped_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._save_pending_stop(
            mode="sleep_pending_stop",
            entry_id=entry_id,
            project_id=project_id,
            started_at=started_at,
            stopped_at=stopped_at,
            last_heartbeat_at=last_heartbeat_at,
        )

    def _save_pending_stop(
        self,
        mode: str,
        entry_id: str,
        project_id: str | None,
        started_at: datetime,
        stopped_at: datetime,
        last_heartbeat_at: datetime | None,
    ) -> None:
        self._write(
            {
                "entry_id": entry_id,
                "project_id": project_id,
                "mode": mode,
                "started_at": started_at.astimezone(timezone.utc).isoformat(),
                "break_started_at": None,
                "last_runtime_at": stopped_at.astimezone(timezone.utc).isoformat(),
                "last_heartbeat_at": last_heartbeat_at.astimezone(timezone.utc).isoformat() if last_heartbeat_at else None,
            }
        )

    def clear(self) -> None:
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            return

    def _write(self, payload: dict) -> None:
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _parse_datetime(value: object) -> datetime | None:
    raw = _clean_text(value)
    if not raw:
        return None

    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
