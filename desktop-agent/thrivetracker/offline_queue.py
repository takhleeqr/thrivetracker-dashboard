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
                select id, operation_type, payload_json, file_path, attempts
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
            )
            for row in rows
        ]

    def delete(self, item_id: int) -> None:
        with self._connect() as connection:
            connection.execute("delete from queue_items where id = ?", (item_id,))
        LOGGER.info("Deleted queued operation id %s after successful replay", item_id)

    def mark_failed(self, item_id: int, error_message: str) -> None:
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
        LOGGER.warning("Queued operation id %s failed replay: %s", item_id, error_message)

    def count(self) -> int:
        with self._connect() as connection:
            row = connection.execute("select count(*) as total from queue_items").fetchone()
            return int(row["total"])

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
