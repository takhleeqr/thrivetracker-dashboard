from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import sqlite3


LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class QueueItem:
    id: int
    operation_type: str
    payload: dict
    file_path: Path | None
    attempts: int
    created_at: datetime


@dataclass(frozen=True)
class QueueSummary:
    count: int
    oldest_created_at: datetime | None


class OfflineQueue:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_database()

    def enqueue(self, operation_type: str, payload: dict, file_path: Path | None = None) -> None:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                insert into queue_items (operation_type, payload_json, file_path, created_at, attempts)
                values (?, ?, ?, ?, 0)
                """,
                (
                    operation_type,
                    json.dumps(payload),
                    str(file_path) if file_path else None,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        LOGGER.info("Queued offline operation %s with id %s", operation_type, cursor.lastrowid)

    def oldest(self, limit: int = 10) -> list[QueueItem]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select id, operation_type, payload_json, file_path, attempts, created_at
                from queue_items
                order by id asc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [
            QueueItem(
                id=row["id"],
                operation_type=row["operation_type"],
                payload=json.loads(row["payload_json"]),
                file_path=Path(row["file_path"]) if row["file_path"] else None,
                attempts=row["attempts"],
                created_at=_parse_datetime(row["created_at"]) or datetime.now(timezone.utc),
            )
            for row in rows
        ]

    def delete(self, item_id: int) -> None:
        with self._connect() as connection:
            connection.execute("delete from queue_items where id = ?", (item_id,))
        LOGGER.info("Deleted queued operation id %s after successful replay", item_id)

    def mark_failed(self, item_id: int, error_message: str) -> int:
        with self._connect() as connection:
            connection.execute(
                """
                update queue_items
                set attempts = attempts + 1,
                    last_error = ?,
                    updated_at = ?
                where id = ?
                """,
                (error_message[:1000], datetime.now(timezone.utc).isoformat(), item_id),
            )
            row = connection.execute("select attempts from queue_items where id = ?", (item_id,)).fetchone()
        LOGGER.warning("Queued operation id %s failed replay: %s", item_id, error_message)
        return int(row["attempts"]) if row else 0

    def count(self) -> int:
        with self._connect() as connection:
            row = connection.execute("select count(*) as total from queue_items").fetchone()
            return int(row["total"])

    def summary(self) -> QueueSummary:
        with self._connect() as connection:
            row = connection.execute(
                """
                select count(*) as total, min(created_at) as oldest_created_at
                from queue_items
                """
            ).fetchone()

        return QueueSummary(
            count=int(row["total"]) if row else 0,
            oldest_created_at=_parse_datetime(row["oldest_created_at"]) if row and row["oldest_created_at"] else None,
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_database(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                create table if not exists queue_items (
                    id integer primary key autoincrement,
                    operation_type text not null,
                    payload_json text not null,
                    file_path text,
                    attempts integer not null default 0,
                    last_error text,
                    created_at text not null,
                    updated_at text
                )
                """
            )
            connection.execute(
                """
                create index if not exists idx_queue_items_oldest
                on queue_items (id asc)
                """
            )


def _parse_datetime(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None

    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
