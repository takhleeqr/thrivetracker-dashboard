from dataclasses import dataclass
from datetime import datetime, timezone
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from threading import RLock
from urllib.parse import quote
import base64
import binascii
import json
import time
import httpx

from .auth_service import AuthenticatedUser, AuthError, SupabaseAuthService
from .activity_tracker import ActivitySnapshot
from .device_identity import DeviceIdentity
from .screenshot_service import CapturedScreenshot


class ApiError(RuntimeError):
    pass


TOKEN_REFRESH_MARGIN_SECONDS = 300


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    color: str


@dataclass(frozen=True)
class TimeEntry:
    id: str
    project_id: str | None
    started_at: datetime
    device_hostname: str | None = None
    device_os_username: str | None = None
    device_fingerprint: str | None = None


@dataclass(frozen=True)
class RangeTimeEntry:
    id: str
    started_at: datetime
    stopped_at: datetime | None


@dataclass(frozen=True)
class SessionSnapshot:
    active_entry: TimeEntry | None
    last_seen_at: datetime | None


@dataclass(frozen=True)
class AgentRuntimeState:
    force_reauth_nonce: int
    force_reauth_reason: str | None
    force_reauth_requested_at: datetime | None
    minimum_desktop_version: str
    desktop_update_download_url: str
    desktop_update_required_message: str


@dataclass(frozen=True)
class VaSchedule:
    schedule_type: str
    shift_start_time: str | None
    shift_end_time: str | None
    working_days: list[str]


class SupabaseApiService:
    def __init__(
        self,
        supabase_url: str,
        anon_key: str,
        user: AuthenticatedUser,
        on_session_refresh: Callable[[AuthenticatedUser], None] | None = None,
    ) -> None:
        self.base_url = supabase_url.rstrip("/")
        self.anon_key = anon_key
        self.user = user
        self.on_session_refresh = on_session_refresh
        self.auth_service = SupabaseAuthService()
        self._refresh_lock = RLock()

    @property
    def headers(self) -> dict[str, str]:
        return {
            "apikey": self.anon_key,
            "authorization": f"Bearer {self.user.access_token}",
            "content-type": "application/json",
        }

    def get_assigned_projects(self) -> list[Project]:
        data = self._request(
            "GET",
            f"/rest/v1/project_assignments?select=projects(id,name,color,is_active)&user_id=eq.{quote(self.user.user_id)}&order=assigned_at.asc",
        )
        projects: list[Project] = []
        seen_project_ids: set[str] = set()

        for item in data:
            project = item.get("projects")
            if not project or not project.get("is_active") or project["id"] in seen_project_ids:
                continue

            seen_project_ids.add(project["id"])
            projects.append(
                Project(
                    id=project["id"],
                    name=project["name"],
                    color=project.get("color") or "#2563EB",
                )
            )

        return sorted(projects, key=lambda project: project.name.lower())

    def register_device(self, device: DeviceIdentity) -> None:
        self._request(
            "POST",
            "/rest/v1/rpc/register_user_device",
            json={
                "p_install_id": device.install_id,
                "p_device_fingerprint": device.fingerprint_hash,
                "p_hostname": device.hostname,
                "p_os_username": device.os_username,
            },
            prefer="return=minimal",
        )

    def start_time_entry(self, project_id: str, device: DeviceIdentity) -> TimeEntry:
        data = self._request(
            "POST",
            "/rest/v1/rpc/start_tracking_session",
            json={
                "p_project_id": project_id,
                "p_install_id": device.install_id,
                "p_device_fingerprint": device.fingerprint_hash,
                "p_hostname": device.hostname,
                "p_os_username": device.os_username,
            },
        )
        if not data:
            raise ApiError("Supabase did not return the new time entry.")

        row = data[0] if isinstance(data, list) else data

        return TimeEntry(
            id=row["id"],
            project_id=row["project_id"],
            started_at=_parse_supabase_datetime(row["started_at"]),
            device_hostname=row.get("device_hostname"),
            device_os_username=row.get("device_os_username"),
            device_fingerprint=row.get("device_fingerprint"),
        )

    def stop_time_entry(self, entry: TimeEntry, reason: str = "manual") -> int | None:
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        updated = self.update_time_entry_stop(
            entry_id=entry.id,
            stopped_at=stopped_at.isoformat(),
            duration_seconds=duration_seconds,
            reason=reason,
        )
        return duration_seconds if updated else None

    def update_time_entry_stop(
        self,
        entry_id: str,
        stopped_at: str,
        duration_seconds: int,
        reason: str,
    ) -> bool:
        data = self._request(
            "PATCH",
            f"/rest/v1/time_entries?id=eq.{quote(entry_id)}&stopped_at=is.null",
            json={
                "stopped_at": stopped_at,
                "duration_seconds": duration_seconds,
                "stop_reason": reason,
            },
            prefer="return=representation",
        )
        return bool(data)

    def upload_screenshot(
        self,
        bucket_name: str,
        screenshot: CapturedScreenshot,
        time_entry_id: str,
        project_id: str,
        activity_percent: float | None = None,
        app_version: str | None = None,
    ) -> None:
        self.upload_screenshot_file(
            bucket_name=bucket_name,
            file_path=screenshot.file_path,
            storage_key=screenshot.storage_key,
            captured_at=screenshot.captured_at.isoformat(),
            file_size_bytes=screenshot.file_size_bytes,
            time_entry_id=time_entry_id,
            project_id=project_id,
            activity_percent=activity_percent,
            app_version=app_version,
        )

    def upload_screenshot_file(
        self,
        bucket_name: str,
        file_path: Path,
        storage_key: str,
        captured_at: str,
        file_size_bytes: int,
        time_entry_id: str,
        project_id: str,
        activity_percent: float | None = None,
        app_version: str | None = None,
    ) -> None:
        self._upload_storage_object(bucket_name, file_path, storage_key)
        self._request(
            "POST",
            "/rest/v1/screenshots",
            json={
                "user_id": self.user.user_id,
                "time_entry_id": time_entry_id,
                "project_id": project_id,
                "captured_at": captured_at,
                "storage_url": storage_key,
                "storage_key": storage_key,
                "file_size_bytes": file_size_bytes,
                "activity_percent_at_capture": activity_percent,
                "app_version": app_version,
            },
            prefer="return=minimal",
        )

    def insert_activity_log(
        self,
        time_entry_id: str,
        snapshot: ActivitySnapshot,
        active_window_title: str | None = None,
        active_app_name: str | None = None,
    ) -> None:
        self.insert_activity_log_payload(
            {
                "user_id": self.user.user_id,
                "time_entry_id": time_entry_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "keystrokes_count": snapshot.keystrokes_count,
                "mouse_clicks_count": snapshot.mouse_clicks_count,
                "mouse_moved": snapshot.mouse_moved,
                "activity_percent": snapshot.activity_percent,
                "active_window_title": active_window_title,
                "active_app_name": active_app_name,
            }
        )

    def insert_activity_log_payload(self, payload: dict) -> None:
        self._request(
            "POST",
            "/rest/v1/activity_logs",
            json=payload,
            prefer="return=minimal",
        )

    def get_time_entries_in_range(self, start_iso: str, end_iso: str) -> list[RangeTimeEntry]:
        base_query = (
            "/rest/v1/time_entries"
            "?select=id,started_at,stopped_at"
            f"&user_id=eq.{quote(self.user.user_id)}"
            f"&started_at=lte.{quote(end_iso)}"
        )
        closed_rows = self._request(
            "GET",
            f"{base_query}&stopped_at=gte.{quote(start_iso)}",
        ) or []
        open_rows = self._request(
            "GET",
            f"{base_query}&stopped_at=is.null",
        ) or []

        rows_by_id = {
            row["id"]: RangeTimeEntry(
                id=row["id"],
                started_at=_parse_supabase_datetime(row["started_at"]),
                stopped_at=_parse_supabase_datetime(row["stopped_at"]) if row.get("stopped_at") else None,
            )
            for row in [*closed_rows, *open_rows]
        }
        return list(rows_by_id.values())

    def get_session_snapshot(self) -> SessionSnapshot:
        profile_rows = self._request(
            "GET",
            f"/rest/v1/profiles?select=last_seen_at&id=eq.{quote(self.user.user_id)}",
        ) or []
        active_rows = self._request(
            "GET",
            (
                "/rest/v1/time_entries"
                "?select=id,project_id,started_at,device_hostname,device_os_username,device_fingerprint"
                f"&user_id=eq.{quote(self.user.user_id)}"
                "&stopped_at=is.null"
                "&order=started_at.desc"
                "&limit=1"
            ),
        ) or []

        profile_row = profile_rows[0] if profile_rows else None
        active_row = active_rows[0] if active_rows else None

        active_entry = None
        if active_row:
            active_entry = TimeEntry(
                id=active_row["id"],
                project_id=active_row.get("project_id"),
                started_at=_parse_supabase_datetime(active_row["started_at"]),
                device_hostname=active_row.get("device_hostname"),
                device_os_username=active_row.get("device_os_username"),
                device_fingerprint=active_row.get("device_fingerprint"),
            )

        return SessionSnapshot(
            active_entry=active_entry,
            last_seen_at=_parse_supabase_datetime(profile_row["last_seen_at"]) if profile_row and profile_row.get("last_seen_at") else None,
        )

    def get_settings(self) -> dict[str, str]:
        data = self._request("GET", "/rest/v1/settings?select=key,value")
        return {item["key"]: item["value"] for item in data}

    def get_va_schedule(self) -> VaSchedule:
        rows = self._request(
            "GET",
            (
                "/rest/v1/profiles"
                "?select=schedule_type,shift_start_time,shift_end_time,working_days"
                f"&id=eq.{quote(self.user.user_id)}"
                "&limit=1"
            ),
        ) or []
        row = rows[0] if rows else {}
        working_days = row.get("working_days") or []
        return VaSchedule(
            schedule_type=row.get("schedule_type") or "flexible",
            shift_start_time=row.get("shift_start_time"),
            shift_end_time=row.get("shift_end_time"),
            working_days=list(working_days) if isinstance(working_days, list) else [],
        )

    def get_agent_runtime_state(self) -> AgentRuntimeState:
        rows = self._request(
            "GET",
            "/rest/v1/rpc/get_agent_runtime_state",
        ) or []
        row = rows[0] if isinstance(rows, list) and rows else rows or {}
        return AgentRuntimeState(
            force_reauth_nonce=int(row.get("force_reauth_nonce") or 0),
            force_reauth_reason=row.get("force_reauth_reason"),
            force_reauth_requested_at=_parse_supabase_datetime(row["force_reauth_requested_at"]) if row.get("force_reauth_requested_at") else None,
            minimum_desktop_version=row.get("minimum_desktop_version") or "",
            desktop_update_download_url=row.get("desktop_update_download_url") or "",
            desktop_update_required_message=row.get("desktop_update_required_message")
            or "A newer ThriveTracker version is required. Please install the latest build before continuing.",
        )

    def record_app_launch(self, install_id: str, hostname: str, app_version: str) -> None:
        self._request(
            "POST",
            "/rest/v1/rpc/record_agent_app_launch",
            json={
                "p_install_id": install_id,
                "p_hostname": hostname,
                "p_app_version": app_version,
            },
            prefer="return=minimal",
        )

    def record_heartbeat(self, install_id: str, app_version: str, health: dict | None = None) -> None:
        payload = {
            "p_install_id": install_id,
            "p_queue_size": int(health.get("queue_size", 0)) if health else 0,
            "p_oldest_queue_item_at": health.get("oldest_queue_item_at") if health else None,
            "p_screenshot_failure_started_at": health.get("screenshot_failure_started_at") if health else None,
            "p_screenshot_failure_count": int(health.get("screenshot_failure_count", 0)) if health else 0,
            "p_last_screenshot_uploaded_at": health.get("last_screenshot_uploaded_at") if health else None,
            "p_hostname": health.get("hostname") if health else None,
            "p_app_version": app_version,
        }
        try:
            self._request(
                "POST",
                "/rest/v1/rpc/record_heartbeat",
                json=payload,
                prefer="return=minimal",
            )
        except ApiError:
            if not health:
                raise
            self._request(
                "POST",
                "/rest/v1/rpc/record_heartbeat",
                json={"p_install_id": install_id},
                prefer="return=minimal",
            )

    def record_agent_event(
        self,
        install_id: str | None,
        hostname: str | None,
        app_version: str,
        event_type: str,
        message: str,
        occurred_at: str | None = None,
        severity: str = "info",
        details: dict | None = None,
    ) -> None:
        self._request(
            "POST",
            "/rest/v1/rpc/record_agent_event",
            json={
                "p_install_id": install_id,
                "p_hostname": hostname,
                "p_app_version": app_version,
                "p_event_type": event_type,
                "p_message": message,
                "p_occurred_at": occurred_at,
                "p_severity": severity,
                "p_details": details or {},
            },
            prefer="return=minimal",
        )

    def _request(
        self,
        method: str,
        path: str,
        json: dict | None = None,
        prefer: str | None = None,
        retry_on_unauthorized: bool = True,
    ):
        self._ensure_fresh_token()
        headers = self.headers
        if prefer:
            headers["prefer"] = prefer

        try:
            with httpx.Client(timeout=20) as client:
                response = client.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=headers,
                    json=json,
                )
        except httpx.HTTPError as error:
            raise ApiError("Could not reach Supabase. Check your internet connection.") from error

        if response.status_code == 401 and retry_on_unauthorized:
            self._refresh_session(force=True)
            return self._request(
                method,
                path,
                json=json,
                prefer=prefer,
                retry_on_unauthorized=False,
            )

        if response.status_code >= 400:
            raise ApiError(_supabase_error_message(response))

        if not response.content:
            return None

        return response.json()

    def _upload_storage_object(self, bucket_name: str, file_path: Path, storage_key: str) -> None:
        self._ensure_fresh_token()
        object_path = "/".join(quote(part) for part in PurePosixPath(storage_key).parts)
        upload_url = f"{self.base_url}/storage/v1/object/{quote(bucket_name)}/{object_path}"

        headers = {
            "apikey": self.anon_key,
            "authorization": f"Bearer {self.user.access_token}",
            "content-type": "image/jpeg",
            "x-upsert": "true",
        }

        try:
            with httpx.Client(timeout=60) as client:
                response = client.post(
                    upload_url,
                    headers=headers,
                    content=file_path.read_bytes(),
                )
        except httpx.HTTPError as error:
            raise ApiError("Could not upload screenshot to Supabase Storage.") from error

        if response.status_code == 401:
            self._refresh_session(force=True)
            headers["authorization"] = f"Bearer {self.user.access_token}"
            try:
                with httpx.Client(timeout=60) as client:
                    response = client.post(
                        upload_url,
                        headers=headers,
                        content=file_path.read_bytes(),
                    )
            except httpx.HTTPError as error:
                raise ApiError("Could not upload screenshot to Supabase Storage.") from error

        if response.status_code >= 400:
            raise ApiError(f"Screenshot upload failed: {response.status_code} {response.text}")

    def _ensure_fresh_token(self) -> None:
        expires_at = self._access_token_expires_at()
        if expires_at is None:
            return

        refresh_at = expires_at - TOKEN_REFRESH_MARGIN_SECONDS
        if time.time() >= refresh_at:
            self._refresh_session()

    def _refresh_session(self, force: bool = False) -> None:
        with self._refresh_lock:
            if not force:
                expires_at = self._access_token_expires_at()
                if expires_at and time.time() < expires_at - TOKEN_REFRESH_MARGIN_SECONDS:
                    return

            try:
                self.auth_service.refresh_session(self.base_url, self.anon_key, self.user)
                if self.on_session_refresh:
                    self.on_session_refresh(self.user)
            except AuthError as error:
                raise ApiError(str(error)) from error

    def _access_token_expires_at(self) -> int | None:
        try:
            parts = self.user.access_token.split(".")
            if len(parts) < 2:
                return None

            payload = parts[1]
            padded_payload = payload + "=" * (-len(payload) % 4)
            decoded_payload = base64.urlsafe_b64decode(padded_payload.encode("utf-8"))
            claims = json.loads(decoded_payload)
            expires_at = claims.get("exp")
            return int(expires_at) if expires_at else None
        except (binascii.Error, ValueError, json.JSONDecodeError, TypeError):
            return None


def _parse_supabase_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _supabase_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return f"Supabase request failed: {response.status_code} {response.text}"

    if isinstance(payload, dict):
        message = payload.get("message") or payload.get("error_description") or payload.get("error")
        if message:
            return str(message)

    return f"Supabase request failed: {response.status_code} {response.text}"
