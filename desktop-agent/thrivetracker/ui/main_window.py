from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from collections.abc import Callable
import threading
import tkinter as tk
from tkinter import messagebox
from tkinter import ttk
import webbrowser
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .. import __app_name__, __version__
from ..activity_tracker import ActivitySnapshot, ActivityTracker
from ..api_service import AgentRuntimeState, ApiError, Project, RangeTimeEntry, SessionSnapshot, SupabaseApiService, TimeEntry, VaSchedule
from ..app_paths import AppPaths
from ..device_identity import DeviceIdentity
from ..auth_service import AuthenticatedUser
from ..config import AppConfig, save_local_config
from ..install_manager import download_update_package, get_install_context, queue_replace_and_restart, queue_run_installer_and_restart
from ..offline_queue import OfflineQueue, QueueItem
from ..session_state import PersistedSessionState, SessionStateStore
from ..screenshot_service import CapturedScreenshot, ScreenshotService
from ..window_tracker import get_active_window_info


SESSION_RECOVERY_GRACE_MINUTES = 5
SESSION_STALE_CLOSE_MINUTES = 10
HEARTBEAT_INTERVAL_MS = 60 * 1000
HEARTBEAT_RETRY_INTERVAL_MS = 30 * 1000
SESSION_STATE_PERSIST_SECONDS = 30
QUEUE_SKIP_RETRY_LIMIT = 3
SLEEP_GAP_SECONDS = 90
SHIFT_REMINDER_CHECK_MS = 60 * 1000
CONNECTIVITY_RESTORE_CHECK_MS = 30 * 1000


@dataclass(frozen=True)
class StartupState:
    restored_entry: TimeEntry | None = None
    break_project_id: str | None = None
    break_started_at: datetime | None = None
    notice: str = ""


class MainWindow(ttk.Frame):
    def __init__(
        self,
        root: tk.Tk,
        config: AppConfig,
        user: AuthenticatedUser,
        paths: AppPaths,
        device: DeviceIdentity,
        temp_dir,
        queue_dir,
        on_minimize: Callable[[], None],
        on_notify: Callable[[str, str | None], None] | None = None,
        on_tray_state_change: Callable[[str], None] | None = None,
        on_tray_resume_change: Callable[[bool], None] | None = None,
        on_logout: Callable[[str], None] | None = None,
        on_app_exit: Callable[[], None] | None = None,
    ) -> None:
        super().__init__(root, padding=24)
        self.root = root
        self.config = config
        self.user = user
        self.paths = paths
        self.device = device
        self.on_minimize = on_minimize
        self.on_notify = on_notify
        self.on_tray_state_change = on_tray_state_change
        self.on_tray_resume_change = on_tray_resume_change
        self.on_logout = on_logout
        self.on_app_exit = on_app_exit
        self.api = SupabaseApiService(
            config.supabase_url,
            config.supabase_anon_key,
            user,
            on_session_refresh=self._save_refreshed_session,
        )
        self.screenshots = ScreenshotService(temp_dir, config.screenshot_quality)
        self.offline_queue = OfflineQueue(queue_dir / "offline_queue.sqlite3")
        self.session_state = SessionStateStore(paths.session_state_file)
        self.install_context = get_install_context(__app_name__)

        self.projects: list[Project] = []
        self.va_schedule = VaSchedule(schedule_type="flexible", shift_start_time=None, shift_end_time=None, working_days=[])
        self.active_entry: TimeEntry | None = None
        self.today_total_seconds = 0
        self.screenshots_today = 0
        self.screenshot_after_id: str | None = None
        self.activity_tracker: ActivityTracker | None = None
        self.activity_after_id: str | None = None
        self.idle_after_id: str | None = None
        self.queue_after_id: str | None = None
        self.connectivity_restore_after_id: str | None = None
        self.settings_after_id: str | None = None
        self.shift_reminder_after_id: str | None = None
        self.heartbeat_after_id: str | None = None
        self.is_retrying_queue = False
        self.is_checking_connectivity_restore = False
        self.last_activity_percent: float | None = None
        self.idle_resume_project_id: str | None = None
        self.break_resume_project_id: str | None = None
        self.connectivity_resume_project_id: str | None = None
        self.connectivity_resume_ready = False
        self.break_started_at: datetime | None = None
        self.idle_minutes: int = 0
        self.last_heartbeat_success_at: datetime | None = None
        self.last_state_persisted_at: datetime | None = None
        self.is_connectivity_stopping = False
        self.last_runtime_tick_at: datetime | None = None
        self.is_sleep_stopping = False
        self.last_shift_reminder_key: str | None = None
        self.screenshot_failure_started_at: datetime | None = None
        self.screenshot_failure_count = 0
        self.last_screenshot_uploaded_at: datetime | None = None
        self.acknowledged_force_reauth_nonce = config.acknowledged_force_reauth_nonce
        self.is_handling_session_failure = False
        self.is_updating = False

        self.project_var = tk.StringVar()
        self.timer_text = tk.StringVar(value="00:00:00")
        self.today_text = tk.StringVar(value="Today: 0h 00m")
        self.status_text = tk.StringVar(value="Stopped")
        self.tracking_state_text = tk.StringVar(value="Ready")
        self.screenshot_text = tk.StringVar(value="Screenshots: ready")
        self.activity_text = tk.StringVar(value="Activity: ready")
        self.queue_text = tk.StringVar(value="Queue: 0 pending")
        self.settings_text = tk.StringVar(value="Settings: local defaults")
        self.error_text = tk.StringVar(value="")
        self.button_text = tk.StringVar(value="Start")
        self.break_button_text = tk.StringVar(value="Take Break")

        self._build()
        self._update_queue_text()
        self._load_initial_data()
        self._tick()
        self._schedule_queue_retry()
        self._sync_settings()

    def refresh_external_state(self) -> None:
        self._set_tray_resume_ready(
            bool(
                self.connectivity_resume_project_id
                and self.connectivity_resume_ready
                and not self.active_entry
                and not self.break_started_at
                and not self.break_resume_project_id
            )
        )
        if self.active_entry:
            self._set_tray_state("tracking")
            return

        if self.break_started_at or self.idle_resume_project_id:
            self._set_tray_state("paused")
            return

        if self.connectivity_resume_project_id or self.status_text.get() in {"Connection lost", "Connection restored", "Monitoring failed", "Sleep detected"}:
            self._set_tray_state("attention")
            return

        self._set_tray_state("stopped")

    def _set_tray_state(self, state: str) -> None:
        if self.on_tray_state_change:
            self.on_tray_state_change(state)

    def _set_tray_resume_ready(self, is_ready: bool) -> None:
        if self.on_tray_resume_change:
            self.on_tray_resume_change(is_ready)

    def _notify_user(self, message: str, title: str | None = None) -> None:
        if self.on_notify:
            self.on_notify(message, title)

    def _mark_screenshot_upload_failure(self) -> None:
        if not self.screenshot_failure_started_at:
            self.screenshot_failure_started_at = datetime.now(timezone.utc)
        self.screenshot_failure_count += 1

    def _mark_screenshot_upload_recovered(self) -> None:
        self.screenshot_failure_started_at = None
        self.screenshot_failure_count = 0
        self.last_screenshot_uploaded_at = datetime.now(timezone.utc)

    def _health_payload(self) -> dict[str, str | int | None]:
        queue_summary = self.offline_queue.summary()
        return {
            "hostname": self.device.hostname,
            "queue_size": queue_summary.count,
            "oldest_queue_item_at": queue_summary.oldest_created_at.isoformat() if queue_summary.oldest_created_at else None,
            "screenshot_failure_started_at": self.screenshot_failure_started_at.isoformat() if self.screenshot_failure_started_at else None,
            "screenshot_failure_count": self.screenshot_failure_count,
            "last_screenshot_uploaded_at": self.last_screenshot_uploaded_at.isoformat() if self.last_screenshot_uploaded_at else None,
        }

    def _apply_runtime_state(self, runtime_state: AgentRuntimeState, is_initial: bool = False) -> None:
        self.config = replace(
            self.config,
            minimum_desktop_version=runtime_state.minimum_desktop_version,
            desktop_update_download_url=runtime_state.desktop_update_download_url,
            desktop_update_required_message=runtime_state.desktop_update_required_message,
        )

        if runtime_state.force_reauth_nonce > self.acknowledged_force_reauth_nonce:
            if is_initial and self.user.session_origin == "password":
                self._acknowledge_force_reauth_nonce(runtime_state.force_reauth_nonce)
            else:
                self._acknowledge_force_reauth_nonce(runtime_state.force_reauth_nonce)
                self._force_reauthentication(runtime_state.force_reauth_reason)
                return

        if self._is_update_required():
            self._set_update_required_state()

    def _acknowledge_force_reauth_nonce(self, nonce: int) -> None:
        self.acknowledged_force_reauth_nonce = max(self.acknowledged_force_reauth_nonce, nonce)
        self._save_local_config_tokens()

    def _is_update_required(self) -> bool:
        return _compare_versions(__version__, self.config.minimum_desktop_version) < 0

    def _set_update_required_state(self) -> None:
        download_hint = f" Download: {self.config.desktop_update_download_url}" if self.config.desktop_update_download_url else ""
        self.status_text.set("Update required")
        self.tracking_state_text.set("Install the latest desktop build")
        self.error_text.set(f"{self.config.desktop_update_required_message}{download_hint}")
        if not self.active_entry and not self.break_started_at:
            self.toggle_button.configure(state="disabled")
            self.break_button.configure(state="disabled")
        self._set_tray_state("attention")
        self._refresh_update_button()

    def _refresh_update_button(self) -> None:
        state = "normal" if self.config.desktop_update_download_url else "disabled"
        label = "Update Now" if self.install_context.can_self_manage and self.install_context.is_running_installed_copy else "Get Update"
        self.update_button.configure(text=label)
        self.update_button.configure(state=state)

    def _open_update_download(self) -> None:
        if not self.config.desktop_update_download_url:
            return
        if self.is_updating:
            return
        if self.active_entry or self.break_started_at or self.break_resume_project_id:
            self.error_text.set("Stop the current session before installing an update.")
            return
        if self.install_context.can_self_manage and self.install_context.is_running_installed_copy:
            self.is_updating = True
            self.error_text.set("")
            self._set_busy(True, "Downloading update...")
            threading.Thread(target=self._install_update_worker, daemon=True).start()
            return
        webbrowser.open(self.config.desktop_update_download_url)

    def _install_update_worker(self) -> None:
        try:
            downloaded_file = download_update_package(
                self.config.desktop_update_download_url,
                self.paths.temp_dir,
                __app_name__,
            )
            if "setup" in downloaded_file.name.lower():
                queue_run_installer_and_restart(downloaded_file, self.install_context.installed_executable)
            else:
                queue_replace_and_restart(downloaded_file, self.install_context.installed_executable)
            self._record_agent_event(
                "update_started",
                "Downloaded the latest desktop update and scheduled an automatic restart.",
                details={"download_url": self.config.desktop_update_download_url},
            )
            self.root.after(0, self._finish_update_handoff)
        except Exception as error:
            self._record_agent_event("update_failed", str(error), severity="error")
            self.root.after(0, lambda: self._finish_update_error(str(error)))

    def _finish_update_handoff(self) -> None:
        self.status_text.set("Updating...")
        self.tracking_state_text.set("The app will reopen in a moment")
        self.error_text.set("Installing the latest desktop build.")
        self.root.after(350, self._exit_for_update_restart)

    def _finish_update_error(self, message: str) -> None:
        self.is_updating = False
        self.error_text.set(message)
        self._set_busy(False)
        self.refresh_external_state()

    def _exit_for_update_restart(self) -> None:
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_settings_sync()
        self._cancel_shift_reminder_check()
        self._cancel_heartbeat()
        self._cancel_connectivity_restore_check()
        if self.queue_after_id:
            self.root.after_cancel(self.queue_after_id)
            self.queue_after_id = None
        self._stop_activity_tracking()
        self._set_tray_state("stopped")
        if self.on_app_exit:
            self.on_app_exit()
            return
        self.root.destroy()

    def _record_agent_event(self, event_type: str, message: str, severity: str = "info", details: dict | None = None) -> None:
        payload = {
            "install_id": self.device.install_id,
            "hostname": self.device.hostname,
            "app_version": __version__,
            "event_type": event_type,
            "severity": severity,
            "message": message,
            "details": details or {},
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            self.api.record_agent_event(
                install_id=payload["install_id"],
                hostname=payload["hostname"],
                app_version=payload["app_version"],
                event_type=payload["event_type"],
                message=payload["message"],
                occurred_at=payload["occurred_at"],
                severity=payload["severity"],
                details=payload["details"],
            )
        except Exception:
            self._try_enqueue("agent_event", payload)

    def _force_reauthentication(self, reason: str | None = None) -> None:
        message = reason or "An admin asked you to sign in again."
        self._record_agent_event("force_reauth", message, severity="warning")
        self._queue_active_session_stop_for_reauth()
        self._finish_logout(message)
        self._notify_user(message, "ThriveTracker")

    def _is_auth_session_error(self, message: str) -> bool:
        lowered = message.lower()
        return (
            "sign in again" in lowered
            or "refresh supabase login session" in lowered
            or "login session cannot be refreshed" in lowered
            or "saved login expired" in lowered
        )

    def _handle_auth_session_failure(self, message: str) -> None:
        if self.is_handling_session_failure:
            return
        self.is_handling_session_failure = True
        self._record_agent_event("session_refresh_failed", message, severity="error")
        self._queue_active_session_stop_for_reauth()
        relogin_message = "Your login expired. Please sign in again before continuing work."
        self._finish_logout(relogin_message)
        self._notify_user(relogin_message, "ThriveTracker")

    def _save_local_config_tokens(self) -> None:
        payload = {
            "supabase_url": self.config.supabase_url,
            "email": self.user.email,
            "storage_bucket": self.config.storage_bucket,
            "minimum_desktop_version": self.config.minimum_desktop_version,
            "desktop_update_download_url": self.config.desktop_update_download_url,
            "desktop_update_required_message": self.config.desktop_update_required_message,
            "acknowledged_force_reauth_nonce": self.acknowledged_force_reauth_nonce,
        }
        if self.user.remember_session:
            payload["access_token"] = self.user.access_token
            payload["refresh_token"] = self.user.refresh_token
        save_local_config(self.paths, payload)

    def _queue_active_session_stop_for_reauth(self) -> None:
        if not self.active_entry:
            return

        self._flush_pending_activity(self.active_entry.id)
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - self.active_entry.started_at).total_seconds()))
        self._try_enqueue(
            "time_entry_stop",
            {
                "entry_id": self.active_entry.id,
                "stopped_at": stopped_at.isoformat(),
                "duration_seconds": duration_seconds,
                "reason": "connection_lost",
            },
        )

    def _schedule_shift_reminder_check(self) -> None:
        if self.shift_reminder_after_id:
            self.root.after_cancel(self.shift_reminder_after_id)
        self.shift_reminder_after_id = self.root.after(SHIFT_REMINDER_CHECK_MS, self._check_shift_start_reminder)

    def _cancel_shift_reminder_check(self) -> None:
        if self.shift_reminder_after_id:
            self.root.after_cancel(self.shift_reminder_after_id)
            self.shift_reminder_after_id = None

    def _check_shift_start_reminder(self) -> None:
        self.shift_reminder_after_id = None
        try:
            self._maybe_send_shift_start_reminder()
        finally:
            self._schedule_shift_reminder_check()

    def _maybe_send_shift_start_reminder(self) -> None:
        if self.active_entry or self.break_started_at or self.break_resume_project_id:
            return

        if self.today_total_seconds > 0:
            return

        if self.va_schedule.schedule_type != "fixed" or not self.va_schedule.shift_start_time or not self.va_schedule.working_days:
            return

        try:
            local_zone = ZoneInfo(self.config.timezone)
        except ZoneInfoNotFoundError:
            local_zone = timezone.utc

        now_local = datetime.now(local_zone)
        weekday = now_local.strftime("%a").lower()
        if weekday not in {day.lower()[:3] for day in self.va_schedule.working_days}:
            return

        reminder_key = now_local.strftime("%Y-%m-%d")
        if self.last_shift_reminder_key == reminder_key:
            return

        if not _is_valid_time(self.va_schedule.shift_start_time):
            return

        shift_hour, shift_minute = [int(part) for part in self.va_schedule.shift_start_time.split(":", 1)]
        reminder_at = now_local.replace(
            hour=shift_hour,
            minute=shift_minute,
            second=0,
            microsecond=0,
        ) + timedelta(minutes=max(1, self.config.shift_start_reminder_delay_minutes))

        if now_local < reminder_at:
            return

        self.last_shift_reminder_key = reminder_key
        self._set_tray_state("attention")
        self._notify_user(
            "Your fixed shift has started and the timer is not running. Open ThriveTracker and press Start.",
            "ThriveTracker",
        )

    def _build(self) -> None:
        self.pack(fill="both", expand=True)

        ttk.Label(self, text=self.user.full_name, style="Muted.TLabel").pack(anchor="w")
        ttk.Label(self, text=f"Desktop Agent v{__version__}", style="Muted.TLabel").pack(anchor="w", pady=(2, 0))
        ttk.Label(self, text="Time Tracker", style="Title.TLabel").pack(anchor="w", pady=(4, 14))

        ttk.Label(self, text="Project").pack(anchor="w")
        self.project_combo = ttk.Combobox(self, textvariable=self.project_var, state="readonly")
        self.project_combo.pack(fill="x", pady=(4, 12))

        ttk.Label(self, textvariable=self.timer_text, style="Timer.TLabel").pack(anchor="center", pady=(0, 8))
        ttk.Label(self, textvariable=self.today_text, style="Muted.TLabel").pack(anchor="center")

        self.toggle_button = ttk.Button(self, textvariable=self.button_text, command=self._toggle_timer)
        self.toggle_button.pack(fill="x", pady=(18, 10))
        self.break_button = ttk.Button(self, textvariable=self.break_button_text, command=self._toggle_break, state="disabled")
        self.break_button.pack(fill="x", pady=(0, 10))

        ttk.Label(self, textvariable=self.status_text, style="Status.TLabel").pack(anchor="center")
        ttk.Label(self, textvariable=self.tracking_state_text, style="Muted.TLabel").pack(anchor="center", pady=(4, 0))
        ttk.Label(self, textvariable=self.error_text, style="Error.TLabel", wraplength=340).pack(anchor="w", pady=(8, 0))

        footer = ttk.Frame(self)
        footer.pack(fill="x", side="bottom")
        self.update_button = ttk.Button(footer, text="Get Update", command=self._open_update_download, style="Link.TButton")
        self.update_button.pack(side="left")
        logout_button = ttk.Button(footer, text="Logout", command=self.request_logout, style="Link.TButton")
        logout_button.pack(side="right", padx=(0, 12))
        minimize_button = ttk.Button(footer, text="Minimize", command=self.on_minimize)
        minimize_button.pack(side="right")
        ToolTip(minimize_button, "Minimize to Tray")
        self._refresh_update_button()

    def _load_initial_data(self) -> None:
        self._set_busy(True, "Loading projects...")
        threading.Thread(target=self._load_initial_data_worker, daemon=True).start()

    def _load_initial_data_worker(self) -> None:
        try:
            self.api.register_device(self.device)
            try:
                self.api.record_app_launch(self.device.install_id, self.device.hostname, __version__)
            except ApiError:
                pass
            projects = self.api.get_assigned_projects()
            schedule = self.api.get_va_schedule()
            runtime_state = self.api.get_agent_runtime_state()
            persisted_state = self.session_state.load()
            startup_state = self._reconcile_startup_state(self.api.get_session_snapshot(), persisted_state)
            today_entries = self.api.get_time_entries_in_range(*self._today_range_iso())
            self.root.after(0, lambda: self._finish_initial_data(projects, today_entries, startup_state, schedule, runtime_state))
        except Exception as error:
            message = str(error) if isinstance(error, ApiError) else "Could not load your projects."
            self.root.after(0, lambda: self._finish_error(message))

    def _finish_initial_data(
        self,
        projects: list[Project],
        today_entries: list[RangeTimeEntry],
        startup_state: StartupState,
        schedule: VaSchedule,
        runtime_state: AgentRuntimeState,
    ) -> None:
        self.va_schedule = schedule
        self.projects = projects
        self.project_combo["values"] = [project.name for project in projects]
        self._set_today_total_from_entries(today_entries, startup_state.restored_entry.id if startup_state.restored_entry else None)
        self._apply_runtime_state(runtime_state, is_initial=True)
        if not self.winfo_exists():
            return

        if projects:
            self.project_combo.current(0)
            if startup_state.restored_entry:
                self._restore_tracking_session(startup_state.restored_entry, startup_state.notice)
            elif startup_state.break_project_id and startup_state.break_started_at:
                self._restore_break_state(startup_state.break_project_id, startup_state.break_started_at, startup_state.notice)
            else:
                self.status_text.set("Stopped")
                self._set_busy(False)
                if startup_state.notice:
                    self.error_text.set(startup_state.notice)
                self._set_tray_state("stopped")
        else:
            self.status_text.set("No assigned projects")
            self.toggle_button.configure(state="disabled")
            self._set_tray_state("stopped")

        self._update_today_text()
        self._schedule_shift_reminder_check()

    def _toggle_timer(self) -> None:
        if self.active_entry:
            self._stop_timer("manual")
        elif self.break_resume_project_id:
            self._stop_break_shift()
        elif self.connectivity_resume_project_id:
            self._resume_after_connectivity_loss()
        else:
            self._start_timer()

    def toggle_tracking_from_tray(self) -> None:
        self._toggle_timer()

    def is_tracking(self) -> bool:
        return self.active_entry is not None

    def request_logout(self) -> None:
        if self.active_entry:
            should_logout = messagebox.askyesno(
                "Logout?",
                "Tracking is active. Stop the current session and log out?",
                parent=self.root,
            )
            if not should_logout:
                return

            self._flush_pending_activity(self.active_entry.id)
            self._set_busy(True, "Logging out...")
            entry = self.active_entry
            threading.Thread(target=self._logout_active_session_worker, args=(entry,), daemon=True).start()
            return

        self._finish_logout()

    def _logout_active_session_worker(self, entry: TimeEntry) -> None:
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        try:
            self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason="manual",
            )
        except Exception:
            queued = self._try_enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": "manual",
                },
            )
            if queued:
                self.root.after(0, self._update_queue_text)
        finally:
            self.root.after(0, self._finish_logout)

    def _finish_logout(self, notice: str = "") -> None:
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_settings_sync()
        self._cancel_shift_reminder_check()
        self._cancel_heartbeat()
        self._cancel_connectivity_restore_check()
        if self.queue_after_id:
            self.root.after_cancel(self.queue_after_id)
            self.queue_after_id = None
        self._stop_activity_tracking()
        self.active_entry = None
        self.break_resume_project_id = None
        self.break_started_at = None
        self.last_heartbeat_success_at = None
        self.last_runtime_tick_at = None
        self._clear_connectivity_resume_state()
        self._clear_session_state()
        save_local_config(
            self.paths,
            {
                "supabase_url": self.config.supabase_url,
                "email": self.user.email,
                "storage_bucket": self.config.storage_bucket,
                "minimum_desktop_version": self.config.minimum_desktop_version,
                "desktop_update_download_url": self.config.desktop_update_download_url,
                "desktop_update_required_message": self.config.desktop_update_required_message,
                "acknowledged_force_reauth_nonce": self.acknowledged_force_reauth_nonce,
            },
        )
        self._set_tray_state("stopped")
        if self.on_logout:
            self.on_logout(notice)

    def _start_timer(self) -> None:
        if self._is_update_required():
            self._set_update_required_state()
            return
        project = self._selected_project()
        if not project:
            self.error_text.set("Choose a project first.")
            return

        self._set_busy(True, "Starting...")
        threading.Thread(target=self._start_timer_worker, args=(project,), daemon=True).start()

    def _start_timer_worker(self, project: Project) -> None:
        try:
            entry = self.api.start_time_entry(project.id, self.device)
            self.root.after(0, lambda: self._finish_start(entry))
        except Exception as error:
            message = str(error) if isinstance(error, ApiError) else "Could not start the timer."
            self.root.after(0, lambda: self._finish_error(message))

    def _finish_start(self, entry: TimeEntry) -> None:
        self._record_agent_event("tracking_started", "Tracking started.", details={"project_id": entry.project_id})
        self._activate_tracking_session(entry)

    def _activate_tracking_session(self, entry: TimeEntry, notice: str = "") -> None:
        self.active_entry = entry
        active_project = next((project for project in self.projects if project.id == entry.project_id), None)
        self.is_connectivity_stopping = False
        self.is_sleep_stopping = False
        self.idle_resume_project_id = None
        self.break_resume_project_id = None
        self.break_started_at = None
        self._clear_connectivity_resume_state()
        self.last_activity_percent = None
        self.last_runtime_tick_at = datetime.now(timezone.utc)
        self.error_text.set(notice)
        self.status_text.set("Working")
        self.tracking_state_text.set("Tracking in progress")
        self.screenshot_text.set("Screenshots: scheduled")
        self.button_text.set("Stop")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="normal")
        if active_project:
            self.project_var.set(active_project.name)
        self.project_combo.configure(state="disabled")
        self._set_busy(False)
        if not self._start_activity_tracking():
            self._set_busy(True, "Stopping...")
            self.error_text.set("Activity monitoring failed. Tracking was stopped to avoid unreliable hours.")
            threading.Thread(target=self._stop_timer_worker, args=(entry, "app_close"), daemon=True).start()
            return
        self._schedule_next_screenshot()
        self._schedule_idle_check()
        self._send_heartbeat()
        self._persist_session_state(force=True)
        self._set_tray_state("tracking")

    def _stop_timer(self, reason: str) -> None:
        if not self.active_entry:
            return

        entry = self.active_entry
        self._flush_pending_activity(entry.id)
        self._set_busy(True, "Stopping...")
        threading.Thread(target=self._stop_timer_worker, args=(entry, reason), daemon=True).start()

    def _stop_timer_worker(self, entry: TimeEntry, reason: str) -> None:
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        try:
            updated = self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason=reason,
            )
            self.root.after(0, lambda: self._finish_stop(duration_seconds if updated else None, reason))
        except Exception:
            queued = self._try_enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": reason,
                },
            )
            self.root.after(0, lambda: ((self._update_queue_text() if queued else None), self._finish_stop(duration_seconds, reason)))

    def _finish_stop(self, duration_seconds: int | None, reason: str) -> None:
        if duration_seconds is not None:
            self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.break_resume_project_id = None
        self.break_started_at = None
        self.last_heartbeat_success_at = None
        self.last_runtime_tick_at = None
        self._clear_connectivity_resume_state()
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()
        self.timer_text.set("00:00:00")
        if reason == "app_close":
            self.status_text.set("Monitoring failed")
            self.tracking_state_text.set("Reopen or press Start")
        else:
            self.status_text.set("Stopped")
            self.tracking_state_text.set("Ready")
        self.screenshot_text.set("Screenshots: stopped")
        self.activity_text.set("Activity: stopped")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        self._clear_session_state()
        if duration_seconds is None:
            self.error_text.set("The session had already been closed. Refreshed totals from the server.")
            self._request_today_total_sync()
        self._update_today_text()
        self._set_busy(False)
        if reason == "app_close":
            self._set_tray_state("attention")
            self._notify_user(
                "Activity monitoring failed and the timer was stopped. Open ThriveTracker and press Start when ready.",
                "ThriveTracker",
            )
        else:
            self._set_tray_state("stopped")

    def _toggle_break(self) -> None:
        if self.active_entry:
            self._take_break()
        elif self.break_resume_project_id:
            self._resume_after_break()

    def _take_break(self) -> None:
        if not self.active_entry:
            return

        self.break_resume_project_id = self.active_entry.project_id
        self._flush_pending_activity(self.active_entry.id)
        self.status_text.set("On break")
        self.tracking_state_text.set("On break")
        self.screenshot_text.set("Screenshots: paused")
        self.activity_text.set("Activity: paused")
        self.button_text.set("Stop")
        self.break_button_text.set("Resume")
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()

        entry = self.active_entry
        self._set_busy(True, "Starting break...")
        self.break_button.configure(state="disabled")
        threading.Thread(target=self._break_stop_worker, args=(entry,), daemon=True).start()

    def _break_stop_worker(self, entry: TimeEntry) -> None:
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        try:
            updated = self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason="break",
            )
            self.root.after(0, lambda: self._finish_break(duration_seconds if updated else None))
        except Exception:
            queued = self._try_enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": "break",
                },
            )
            self.root.after(0, lambda: ((self._update_queue_text() if queued else None), self._finish_break(duration_seconds)))

    def _finish_break(self, duration_seconds: int | None) -> None:
        if duration_seconds is not None:
            self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.break_started_at = datetime.now(timezone.utc)
        self._clear_connectivity_resume_state()
        self.timer_text.set("On break: 00:00:00")
        self.status_text.set("On break")
        self.tracking_state_text.set("On break")
        self.button_text.set("Stop")
        self.break_button_text.set("Resume")
        self.break_button.configure(state="normal")
        self.project_combo.configure(state="disabled")
        self._persist_session_state(force=True)
        if duration_seconds is None:
            self.error_text.set("The work session had already been closed before break started. Totals were refreshed.")
            self._request_today_total_sync()
        self._update_today_text()
        self._set_busy(False)
        self._send_heartbeat()
        self._set_tray_state("paused")

    def _resume_after_break(self) -> None:
        if not self.break_resume_project_id:
            return

        project = next((item for item in self.projects if item.id == self.break_resume_project_id), None)
        if not project:
            self.error_text.set("Could not resume. Project is no longer available.")
            return

        self.project_var.set(project.name)
        self._set_busy(True, "Resuming...")
        self.break_button.configure(state="disabled")
        threading.Thread(target=self._start_timer_worker, args=(project,), daemon=True).start()

    def _resume_after_connectivity_loss(self) -> None:
        if not self.connectivity_resume_project_id:
            return

        if self._is_update_required():
            self._set_update_required_state()
            return

        if not self.connectivity_resume_ready:
            self.error_text.set("Still waiting for the connection to come back. We will let you know when Resume is ready.")
            return

        project = next((item for item in self.projects if item.id == self.connectivity_resume_project_id), None)
        if not project:
            self._clear_connectivity_resume_state()
            self.error_text.set("Could not resume. The previous project is no longer available.")
            return

        self.project_var.set(project.name)
        self._set_busy(True, "Resuming...")
        threading.Thread(target=self._start_timer_worker, args=(project,), daemon=True).start()

    def _stop_break_shift(self) -> None:
        self.break_resume_project_id = None
        self.break_started_at = None
        self.last_heartbeat_success_at = None
        self.last_runtime_tick_at = None
        self._clear_connectivity_resume_state()
        self._cancel_heartbeat()
        self.timer_text.set("00:00:00")
        self.status_text.set("Stopped")
        self.tracking_state_text.set("Ready")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        self._clear_session_state()
        self._set_tray_state("stopped")

    def stop_for_app_close(self) -> None:
        if self.active_entry:
            self._flush_pending_activity(self.active_entry.id)
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_settings_sync()
        self._cancel_shift_reminder_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()
        if self.active_entry:
            stopped_at = datetime.now(timezone.utc)
            duration_seconds = max(0, int((stopped_at - self.active_entry.started_at).total_seconds()))
            self.session_state.save_shutdown(
                entry_id=self.active_entry.id,
                project_id=self.active_entry.project_id,
                started_at=self.active_entry.started_at,
                shutdown_at=stopped_at,
                last_heartbeat_at=self.last_heartbeat_success_at,
            )
            try:
                self.api.update_time_entry_stop(
                    entry_id=self.active_entry.id,
                    stopped_at=stopped_at.isoformat(),
                    duration_seconds=duration_seconds,
                    reason="app_close",
                )
                self._clear_session_state()
            except ApiError:
                self._try_enqueue(
                    "time_entry_stop",
                    {
                        "entry_id": self.active_entry.id,
                        "stopped_at": stopped_at.isoformat(),
                        "duration_seconds": duration_seconds,
                        "reason": "app_close",
                    },
                )
        elif self.break_resume_project_id and self.break_started_at:
            self.session_state.save_break(
                project_id=self.break_resume_project_id,
                break_started_at=self.break_started_at,
                last_runtime_at=datetime.now(timezone.utc),
                last_heartbeat_at=self.last_heartbeat_success_at,
            )
        else:
            persisted_state = self.session_state.load()
            if persisted_state and self._is_pending_stop_mode(persisted_state.mode):
                return
            self._clear_session_state()

    def _schedule_next_screenshot(self) -> None:
        self._cancel_screenshot_schedule()
        interval_ms = max(1, self.config.screenshot_interval_minutes) * 60 * 1000
        self.screenshot_after_id = self.root.after(interval_ms, self._capture_screenshot)

    def _cancel_screenshot_schedule(self) -> None:
        if self.screenshot_after_id:
            self.root.after_cancel(self.screenshot_after_id)
            self.screenshot_after_id = None

    def _schedule_idle_check(self) -> None:
        self._cancel_idle_check()
        self.idle_after_id = self.root.after(5 * 1000, self._check_idle_timeout)

    def _cancel_idle_check(self) -> None:
        if self.idle_after_id:
            self.root.after_cancel(self.idle_after_id)
            self.idle_after_id = None

    def _check_idle_timeout(self) -> None:
        self.idle_after_id = None
        if not self.active_entry or not self.activity_tracker:
            return

        idle_seconds = self.activity_tracker.seconds_since_last_input()
        idle_limit_seconds = max(1, self.config.idle_timeout_minutes) * 60
        if idle_seconds >= idle_limit_seconds:
            self.idle_minutes = max(1, int(idle_seconds // 60))
            self._pause_for_idle()
            return

        self._schedule_idle_check()

    def _pause_for_idle(self) -> None:
        if not self.active_entry:
            return

        self.idle_resume_project_id = self.active_entry.project_id
        self._flush_pending_activity(self.active_entry.id)
        self.status_text.set("Idle detected")
        self.tracking_state_text.set("Stopping idle time")
        self.screenshot_text.set("Screenshots: paused")
        self.activity_text.set("Activity: paused")
        self.button_text.set("Start")
        self.break_button.configure(state="disabled")
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()

        entry = self.active_entry
        self._set_busy(True)
        threading.Thread(target=self._idle_stop_worker, args=(entry,), daemon=True).start()

    def _idle_stop_worker(self, entry: TimeEntry) -> None:
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        self.session_state.save_idle_pending_stop(
            entry_id=entry.id,
            project_id=entry.project_id,
            started_at=entry.started_at,
            stopped_at=stopped_at,
            last_heartbeat_at=self.last_heartbeat_success_at,
        )
        try:
            updated = self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason="idle",
            )
            self.root.after(0, lambda: self._finish_idle_pause(duration_seconds if updated else None, queued=False))
        except Exception:
            queued = self._try_enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": "idle",
                },
            )
            self.root.after(0, lambda: (self._update_queue_text(), self._finish_idle_pause(duration_seconds, queued=True)))

    def _finish_idle_pause(self, duration_seconds: int | None, queued: bool) -> None:
        if duration_seconds is not None:
            self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.is_connectivity_stopping = False
        self.last_heartbeat_success_at = None
        self.last_runtime_tick_at = None
        self.timer_text.set("00:00:00")
        self.status_text.set("Idle detected")
        self.tracking_state_text.set("Press Start when you return")
        self.button_text.set("Start")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        if duration_seconds is None:
            self._clear_session_state()
            self.error_text.set("The session had already been closed before idle pause finished. Totals were refreshed.")
            self._request_today_total_sync()
        elif queued:
            self.error_text.set("Your timer was paused because you were idle. The stop will sync when the internet returns.")
        else:
            self._clear_session_state()
        self._update_today_text()
        self._set_busy(False)
        self._set_tray_state("paused")
        if duration_seconds is not None and not queued:
            self._prompt_resume_after_idle()
        elif queued:
            self._notify_user(
                "Your timer was paused because you were idle. The stop will sync when the internet returns.",
                "ThriveTracker",
            )

    def _prompt_resume_after_idle(self) -> None:
        should_resume = messagebox.askyesno(
            "Resume timer?",
            f"You were idle for about {self.idle_minutes} minute(s). Resume tracking?",
            parent=self.root,
        )
        if should_resume:
            self._resume_after_idle()
            return

        self._notify_user(
            "Your timer was paused because you were idle. Open ThriveTracker and press Start when you return.",
            "ThriveTracker",
        )

    def _resume_after_idle(self) -> None:
        if not self.idle_resume_project_id:
            return

        project = next((item for item in self.projects if item.id == self.idle_resume_project_id), None)
        if not project:
            return

        self.project_var.set(project.name)
        self._set_busy(True, "Resuming...")
        threading.Thread(target=self._start_timer_worker, args=(project,), daemon=True).start()

    def _capture_screenshot(self) -> None:
        if not self.active_entry:
            return
        if self.screenshots_today >= self.config.max_screenshots_per_day:
            self.screenshot_text.set("Screenshots: daily limit reached")
            return

        self.screenshot_text.set("Screenshots: capturing...")
        threading.Thread(target=self._capture_screenshot_worker, daemon=True).start()

    def _capture_screenshot_worker(self) -> None:
        try:
            screenshot = self.screenshots.capture(self.user.user_id)
            self.root.after(0, lambda: self._finish_screenshot_capture(screenshot))
        except Exception:
            self.root.after(0, lambda: self._finish_screenshot_error())

    def _finish_screenshot_capture(self, screenshot: CapturedScreenshot) -> None:
        if not self.active_entry:
            return

        self.screenshots_today += 1
        self.screenshot_text.set("Screenshots: uploading...")
        entry = self.active_entry
        project_id = entry.project_id
        threading.Thread(
            target=self._upload_screenshot_worker,
            args=(screenshot, entry.id, project_id),
            daemon=True,
        ).start()

    def _upload_screenshot_worker(self, screenshot: CapturedScreenshot, time_entry_id: str, project_id: str) -> None:
        try:
            self.api.upload_screenshot(
                bucket_name=self.config.storage_bucket,
                screenshot=screenshot,
                time_entry_id=time_entry_id,
                project_id=project_id,
                activity_percent=self.last_activity_percent,
            )
            screenshot.file_path.unlink(missing_ok=True)
            self.root.after(0, lambda: self._finish_screenshot_upload(screenshot))
        except Exception:
            queued = self._try_enqueue(
                "screenshot_upload",
                {
                    "bucket_name": self.config.storage_bucket,
                    "storage_key": screenshot.storage_key,
                    "captured_at": screenshot.captured_at.isoformat(),
                    "file_size_bytes": screenshot.file_size_bytes,
                    "time_entry_id": time_entry_id,
                    "project_id": project_id,
                    "activity_percent": self.last_activity_percent,
                },
                file_path=screenshot.file_path,
            )
            self.root.after(
                0,
                lambda: (
                    self._update_queue_text() if queued else None,
                    self._finish_screenshot_upload_error(screenshot),
                ),
            )

    def _finish_screenshot_upload(self, screenshot: CapturedScreenshot) -> None:
        if not self.active_entry:
            return

        self._mark_screenshot_upload_recovered()
        self.screenshot_text.set(f"Screenshots: uploaded {screenshot.file_path.name}")
        self._schedule_next_screenshot()

    def _finish_screenshot_upload_error(self, screenshot: CapturedScreenshot) -> None:
        if not self.active_entry:
            return

        self._mark_screenshot_upload_failure()
        self.screenshot_text.set(f"Screenshots: upload failed, kept {screenshot.file_path.name}")
        self._schedule_next_screenshot()

    def _finish_screenshot_error(self) -> None:
        if not self.active_entry:
            return

        self.screenshot_text.set("Screenshots: capture failed")
        self._schedule_next_screenshot()

    def _start_activity_tracking(self) -> bool:
        self._stop_activity_tracking()
        self.activity_tracker = ActivityTracker()

        try:
            self.activity_tracker.start()
        except Exception:
            self.activity_tracker = None
            self.activity_text.set("Activity: listener failed")
            return False

        self.activity_text.set("Activity: recording")
        self._schedule_activity_log()
        return True

    def _stop_activity_tracking(self) -> None:
        if self.activity_after_id:
            self.root.after_cancel(self.activity_after_id)
            self.activity_after_id = None

        if self.activity_tracker:
            self.activity_tracker.stop()
            self.activity_tracker = None

    def _schedule_activity_log(self) -> None:
        if self.activity_after_id:
            self.root.after_cancel(self.activity_after_id)
        self.activity_after_id = self.root.after(60 * 1000, self._capture_activity_log)

    def _flush_pending_activity(self, time_entry_id: str) -> None:
        if self.activity_after_id:
            self.root.after_cancel(self.activity_after_id)
            self.activity_after_id = None
        if not self.activity_tracker:
            return

        snapshot = self.activity_tracker.snapshot_and_reset()
        if (
            snapshot.keystrokes_count == 0
            and snapshot.mouse_clicks_count == 0
            and not snapshot.mouse_moved
            and snapshot.activity_percent <= 0
        ):
            return

        window_info = get_active_window_info()
        self.last_activity_percent = snapshot.activity_percent
        self.activity_text.set(f"Activity: {snapshot.activity_percent:.0f}%")
        threading.Thread(
            target=self._upload_activity_worker,
            args=(time_entry_id, snapshot, window_info.title, window_info.app_name),
            daemon=True,
        ).start()

    def _capture_activity_log(self) -> None:
        self.activity_after_id = None
        if not self.active_entry or not self.activity_tracker:
            return

        snapshot = self.activity_tracker.snapshot_and_reset()
        window_info = get_active_window_info()
        self.last_activity_percent = snapshot.activity_percent
        self.activity_text.set(f"Activity: {snapshot.activity_percent:.0f}%")
        entry_id = self.active_entry.id
        threading.Thread(
            target=self._upload_activity_worker,
            args=(entry_id, snapshot, window_info.title, window_info.app_name),
            daemon=True,
        ).start()
        self._schedule_activity_log()

    def _upload_activity_worker(
        self,
        time_entry_id: str,
        snapshot: ActivitySnapshot,
        active_window_title: str | None,
        active_app_name: str | None,
    ) -> None:
        payload = {
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
        try:
            self.api.insert_activity_log_payload(payload)
        except Exception:
            queued = self._try_enqueue("activity_log", payload)
            self.root.after(
                0,
                lambda: (
                    self.activity_text.set("Activity: upload failed"),
                    self._update_queue_text() if queued else self.error_text.set("Activity upload failed and could not be saved for retry."),
                ),
            )

    def _send_heartbeat(self) -> None:
        self._cancel_heartbeat()
        if not self.active_entry and not self.break_resume_project_id:
            return

        threading.Thread(target=self._heartbeat_worker, daemon=True).start()

    def _heartbeat_worker(self) -> None:
        delay_ms = HEARTBEAT_INTERVAL_MS
        heartbeat_at = datetime.now(timezone.utc)
        try:
            self.api.record_heartbeat(self.device.install_id, __version__, self._health_payload())
            runtime_state = self.api.get_agent_runtime_state()
            self.last_heartbeat_success_at = heartbeat_at
            self.root.after(0, lambda: (self._persist_session_state(force=True), self._apply_runtime_state(runtime_state)))
        except Exception as error:
            message = str(error)
            if self._is_auth_session_error(message):
                self.root.after(0, lambda: self._handle_auth_session_failure(message))
                delay_ms = HEARTBEAT_INTERVAL_MS
                return
            if self.active_entry and not self.is_connectivity_stopping:
                heartbeat_anchor = self.last_heartbeat_success_at or self.active_entry.started_at
                grace_seconds = max(1, self.config.connectivity_grace_minutes) * 60
                if (heartbeat_at - heartbeat_anchor).total_seconds() >= grace_seconds:
                    self.root.after(0, self._pause_for_connectivity_loss)
            delay_ms = HEARTBEAT_RETRY_INTERVAL_MS
        finally:
            self.root.after(0, lambda: self._schedule_heartbeat(delay_ms))

    def _pause_for_connectivity_loss(self) -> None:
        if not self.active_entry or self.is_connectivity_stopping:
            return

        heartbeat_anchor = self.last_heartbeat_success_at or self.active_entry.started_at
        grace_seconds = max(1, self.config.connectivity_grace_minutes) * 60
        stopped_at = heartbeat_anchor + timedelta(seconds=grace_seconds)
        if datetime.now(timezone.utc) < stopped_at:
            return

        self.is_connectivity_stopping = True
        self._flush_pending_activity(self.active_entry.id)
        self.status_text.set("Connection lost")
        self.tracking_state_text.set("Stopping unreliable time")
        self.screenshot_text.set("Screenshots: paused")
        self.activity_text.set("Activity: paused")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()

        entry = self.active_entry
        self._set_busy(True, "Connection lost...")
        threading.Thread(target=self._connectivity_stop_worker, args=(entry, stopped_at), daemon=True).start()

    def _connectivity_stop_worker(self, entry: TimeEntry, stopped_at: datetime) -> None:
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        self.session_state.save_connectivity_pending_stop(
            entry_id=entry.id,
            project_id=entry.project_id,
            started_at=entry.started_at,
            stopped_at=stopped_at,
            last_heartbeat_at=self.last_heartbeat_success_at,
        )
        try:
            updated = self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason="connection_lost",
            )
            self.root.after(
                0,
                lambda: self._finish_connectivity_pause(
                    duration_seconds if updated else None,
                    queued=False,
                    resume_project_id=entry.project_id,
                ),
            )
        except Exception:
            queued = self._try_enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": "connection_lost",
                },
            )
            self.root.after(
                0,
                lambda: (
                    (self._update_queue_text() if queued else None),
                    self._finish_connectivity_pause(
                        duration_seconds,
                        queued=True,
                        resume_project_id=entry.project_id,
                    ),
                ),
            )

    def _finish_connectivity_pause(self, duration_seconds: int | None, queued: bool, resume_project_id: str | None) -> None:
        if duration_seconds is not None:
            self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.is_connectivity_stopping = False
        self.last_heartbeat_success_at = None
        self.last_runtime_tick_at = None
        self._clear_connectivity_resume_state()
        self.timer_text.set("00:00:00")
        self.status_text.set("Connection lost")
        self.tracking_state_text.set("Reconnect, then press Start")
        self.screenshot_text.set("Screenshots: stopped")
        self.activity_text.set("Activity: stopped")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        if duration_seconds is None:
            self.error_text.set("The session had already been closed before the connection-loss guard finished. Totals were refreshed.")
            self._clear_session_state()
            self._request_today_total_sync()
        else:
            self.connectivity_resume_project_id = resume_project_id
            project = next((item for item in self.projects if item.id == resume_project_id), None)
            if project:
                self.project_var.set(project.name)
            grace_label = format_duration(max(60, self.config.connectivity_grace_minutes * 60))
            if queued:
                self.error_text.set(
                    f"The app stopped counting time after {grace_label} without server contact. The stop will sync when the internet returns."
                )
            else:
                self.error_text.set(
                    f"The app stopped counting time after {grace_label} without server contact. Reconnect and press Start to continue."
                )
                self._clear_session_state()
            self._schedule_connectivity_restore_check(delay_ms=1000)
            self._update_queue_text()
        self._update_today_text()
        self._set_busy(False)
        self._set_tray_state("attention")
        self._set_tray_resume_ready(False)
        self._notify_user(
            "Your timer was stopped after losing connection. Reconnect and press Start when ready.",
            "ThriveTracker",
        )

    def _schedule_heartbeat(self, delay_ms: int = HEARTBEAT_INTERVAL_MS) -> None:
        if not self.active_entry and not self.break_resume_project_id:
            return
        self.heartbeat_after_id = self.root.after(delay_ms, self._send_heartbeat)

    def _cancel_heartbeat(self) -> None:
        if self.heartbeat_after_id:
            self.root.after_cancel(self.heartbeat_after_id)
            self.heartbeat_after_id = None

    def _schedule_connectivity_restore_check(self, delay_ms: int = CONNECTIVITY_RESTORE_CHECK_MS) -> None:
        if self.connectivity_restore_after_id:
            self.root.after_cancel(self.connectivity_restore_after_id)
        if not self.connectivity_resume_project_id or self.connectivity_resume_ready or self.active_entry or self.break_resume_project_id:
            self.connectivity_restore_after_id = None
            return
        self.connectivity_restore_after_id = self.root.after(delay_ms, self._check_connectivity_restore)

    def _cancel_connectivity_restore_check(self) -> None:
        if self.connectivity_restore_after_id:
            self.root.after_cancel(self.connectivity_restore_after_id)
            self.connectivity_restore_after_id = None

    def _check_connectivity_restore(self) -> None:
        self.connectivity_restore_after_id = None
        if (
            self.is_checking_connectivity_restore
            or not self.connectivity_resume_project_id
            or self.connectivity_resume_ready
            or self.active_entry
            or self.break_resume_project_id
        ):
            return

        self.is_checking_connectivity_restore = True
        threading.Thread(target=self._check_connectivity_restore_worker, daemon=True).start()

    def _check_connectivity_restore_worker(self) -> None:
        restored = False
        try:
            snapshot = self.api.get_session_snapshot()
            restored = snapshot.active_entry is None
        except Exception:
            restored = False
        self.root.after(0, lambda: self._finish_connectivity_restore_check(restored))

    def _finish_connectivity_restore_check(self, restored: bool) -> None:
        self.is_checking_connectivity_restore = False
        if not self.connectivity_resume_project_id or self.active_entry or self.break_resume_project_id:
            self._set_tray_resume_ready(False)
            return

        if not restored:
            self._schedule_connectivity_restore_check()
            return

        self.connectivity_resume_ready = True
        project = next((item for item in self.projects if item.id == self.connectivity_resume_project_id), None)
        if not project:
            self._clear_connectivity_resume_state()
            self.error_text.set("Connection is back, but the previous project is no longer available.")
            return

        self.project_var.set(project.name)
        self.status_text.set("Connection restored")
        self.tracking_state_text.set("Resume when ready")
        self.button_text.set("Resume")
        self.error_text.set("Connection is back. Resume tracking when you are ready.")
        self._set_tray_state("attention")
        self._set_tray_resume_ready(True)
        self._notify_user(
            "Connection restored. Use Resume Tracking in the tray or open ThriveTracker to continue.",
            "ThriveTracker",
        )
        if self._is_window_visible():
            should_resume = messagebox.askyesno(
                "Resume tracking?",
                f"Connection is back. Resume tracking on {project.name} now?",
                parent=self.root,
            )
            if should_resume:
                self._resume_after_connectivity_loss()

    def _is_window_visible(self) -> bool:
        try:
            return self.root.state() != "withdrawn"
        except tk.TclError:
            return False

    def _clear_connectivity_resume_state(self) -> None:
        self.connectivity_resume_project_id = None
        self.connectivity_resume_ready = False
        self.is_checking_connectivity_restore = False
        self._cancel_connectivity_restore_check()
        self._set_tray_resume_ready(False)

    def _schedule_queue_retry(self) -> None:
        if self.queue_after_id:
            self.root.after_cancel(self.queue_after_id)
        self.queue_after_id = self.root.after(30 * 1000, self._retry_queue)

    def _retry_queue(self) -> None:
        self.queue_after_id = None
        if self.is_retrying_queue:
            self._schedule_queue_retry()
            return

        self.is_retrying_queue = True
        threading.Thread(target=self._retry_queue_worker, daemon=True).start()

    def _retry_queue_worker(self) -> None:
        replayed_any = False
        replayed_screenshot = False
        try:
            items = sorted(
                self.offline_queue.oldest(limit=20),
                key=lambda item: {
                    "time_entry_stop": 0,
                    "activity_log": 1,
                    "agent_event": 1,
                    "screenshot_upload": 2,
                }.get(item.operation_type, 3),
            )
            for item in items:
                try:
                    operation = self._replay_queue_item(item)
                    self.offline_queue.delete(item.id)
                    replayed_any = True
                    if operation == "screenshot_upload":
                        replayed_screenshot = True
                except Exception as error:
                    attempts = self.offline_queue.mark_failed(item.id, str(error))
                    if self._should_skip_failed_queue_item(item, attempts):
                        self.offline_queue.delete(item.id)
                        continue
                    break
        finally:
            self.root.after(0, lambda: self._finish_queue_retry(replayed_any, replayed_screenshot))

    def _should_skip_failed_queue_item(self, item: QueueItem, attempts: int) -> bool:
        return item.operation_type == "screenshot_upload" and attempts >= QUEUE_SKIP_RETRY_LIMIT

    def _replay_queue_item(self, item: QueueItem) -> str:
        if item.operation_type == "time_entry_stop":
            self.api.update_time_entry_stop(
                entry_id=item.payload["entry_id"],
                stopped_at=item.payload["stopped_at"],
                duration_seconds=int(item.payload["duration_seconds"]),
                reason=item.payload["reason"],
            )
            return item.operation_type

        if item.operation_type == "activity_log":
            self.api.insert_activity_log_payload(item.payload)
            return item.operation_type

        if item.operation_type == "agent_event":
            self.api.record_agent_event(
                install_id=item.payload.get("install_id"),
                hostname=item.payload.get("hostname"),
                app_version=item.payload.get("app_version") or __version__,
                event_type=item.payload["event_type"],
                message=item.payload["message"],
                occurred_at=item.payload.get("occurred_at"),
                severity=item.payload.get("severity") or "info",
                details=item.payload.get("details") or {},
            )
            return item.operation_type

        if item.operation_type == "screenshot_upload":
            if not item.file_path or not item.file_path.exists():
                raise RuntimeError("Queued screenshot file is missing from disk and cannot be replayed.")

            self.api.upload_screenshot_file(
                bucket_name=item.payload["bucket_name"],
                file_path=item.file_path,
                storage_key=item.payload["storage_key"],
                captured_at=item.payload["captured_at"],
                file_size_bytes=int(item.payload["file_size_bytes"]),
                time_entry_id=item.payload["time_entry_id"],
                project_id=item.payload["project_id"],
                activity_percent=item.payload.get("activity_percent"),
            )
            item.file_path.unlink(missing_ok=True)
            return item.operation_type

        raise RuntimeError(f"Unknown queue operation: {item.operation_type}")

    def _finish_queue_retry(self, replayed_any: bool, replayed_screenshot: bool) -> None:
        self.is_retrying_queue = False
        self._update_queue_text()
        if replayed_screenshot:
            self._mark_screenshot_upload_recovered()
        if replayed_any:
            self._request_today_total_sync()
        if replayed_any and self.connectivity_resume_project_id and not self.connectivity_resume_ready:
            self._schedule_connectivity_restore_check(delay_ms=1000)
        self._schedule_queue_retry()

    def _update_queue_text(self) -> None:
        self.queue_text.set(f"Queue: {self.offline_queue.count()} pending")

    def _try_enqueue(self, operation_type: str, payload: dict, file_path=None) -> bool:
        try:
            self.offline_queue.enqueue(operation_type, payload, file_path=file_path)
            return True
        except Exception:
            return False

    def _sync_settings(self) -> None:
        threading.Thread(target=self._sync_settings_worker, daemon=True).start()

    def _sync_settings_worker(self) -> None:
        try:
            settings = self.api.get_settings()
            schedule = self.api.get_va_schedule()
            runtime_state = self.api.get_agent_runtime_state()
            self.root.after(0, lambda: self._finish_settings_sync(settings, schedule, runtime_state))
        except Exception as error:
            message = str(error)
            if self._is_auth_session_error(message):
                self.root.after(0, lambda: self._handle_auth_session_failure(message))
                return
            self.root.after(0, self._finish_settings_sync_error)

    def _finish_settings_sync(self, settings: dict[str, str], schedule: VaSchedule, runtime_state: AgentRuntimeState) -> None:
        previous_timezone = self.config.timezone
        self.config = self.config.with_settings(settings)
        self.va_schedule = schedule
        self.screenshots.quality = max(1, min(100, self.config.screenshot_quality))
        self.settings_text.set("Settings: synced")
        self._apply_runtime_state(runtime_state)
        self._refresh_update_button()
        if not self.winfo_exists():
            return
        if self.config.timezone != previous_timezone:
            self._request_today_total_sync()
        self._schedule_shift_reminder_check()
        self._schedule_settings_sync()

    def _finish_settings_sync_error(self) -> None:
        self.settings_text.set("Settings: using last synced values")
        self._schedule_settings_sync()

    def _schedule_settings_sync(self) -> None:
        if self.settings_after_id:
            self.root.after_cancel(self.settings_after_id)
        self.settings_after_id = self.root.after(15 * 60 * 1000, self._sync_settings)

    def _cancel_settings_sync(self) -> None:
        if self.settings_after_id:
            self.root.after_cancel(self.settings_after_id)
            self.settings_after_id = None

    def _today_range_bounds(self) -> tuple[datetime, datetime]:
        try:
            local_zone = ZoneInfo(self.config.timezone)
        except ZoneInfoNotFoundError:
            local_zone = timezone.utc

        now_local = datetime.now(local_zone)
        start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        return start_local.astimezone(timezone.utc), now_local.astimezone(timezone.utc)

    def _today_range_iso(self) -> tuple[str, str]:
        start_at, end_at = self._today_range_bounds()
        return start_at.isoformat(), end_at.isoformat()

    def _set_today_total_from_entries(
        self,
        entries: list[RangeTimeEntry],
        exclude_entry_id: str | None = None,
    ) -> None:
        range_start, range_end = self._today_range_bounds()
        total_seconds = 0

        for entry in entries:
            if exclude_entry_id and entry.id == exclude_entry_id and entry.stopped_at is None:
                continue
            if entry.stopped_at is None:
                continue

            clamped_start = max(entry.started_at, range_start)
            clamped_end = min(entry.stopped_at, range_end)
            total_seconds += max(0, int((clamped_end - clamped_start).total_seconds()))

        self.today_total_seconds = total_seconds

    def _current_active_today_seconds(self) -> int:
        if not self.active_entry:
            return 0

        range_start, range_end = self._today_range_bounds()
        clamped_start = max(self.active_entry.started_at, range_start)
        clamped_end = min(datetime.now(timezone.utc), range_end)
        return max(0, int((clamped_end - clamped_start).total_seconds()))

    def _request_today_total_sync(self) -> None:
        threading.Thread(target=self._refresh_today_total_worker, daemon=True).start()

    def _refresh_today_total_worker(self) -> None:
        try:
            entries = self.api.get_time_entries_in_range(*self._today_range_iso())
            active_entry_id = self.active_entry.id if self.active_entry else None
            self.root.after(0, lambda: self._finish_today_total_sync(entries, active_entry_id))
        except Exception:
            return

    def _finish_today_total_sync(self, entries: list[RangeTimeEntry], active_entry_id: str | None) -> None:
        self._set_today_total_from_entries(entries, active_entry_id)
        self._update_today_text()

    def _persist_session_state(self, force: bool = False) -> None:
        now = datetime.now(timezone.utc)
        if not force and self.last_state_persisted_at and (now - self.last_state_persisted_at).total_seconds() < SESSION_STATE_PERSIST_SECONDS:
            return

        if self.active_entry:
            self.session_state.save_tracking(
                entry_id=self.active_entry.id,
                project_id=self.active_entry.project_id,
                started_at=self.active_entry.started_at,
                last_runtime_at=now,
                last_heartbeat_at=self.last_heartbeat_success_at,
            )
            self.last_state_persisted_at = now
            return

        if self.break_resume_project_id and self.break_started_at:
            self.session_state.save_break(
                project_id=self.break_resume_project_id,
                break_started_at=self.break_started_at,
                last_runtime_at=now,
                last_heartbeat_at=self.last_heartbeat_success_at,
            )
            self.last_state_persisted_at = now
            return

        self._clear_session_state()

    def _clear_session_state(self) -> None:
        self.session_state.clear()
        self.last_state_persisted_at = None

    def _restore_tracking_session(self, entry: TimeEntry, notice: str) -> None:
        self._activate_tracking_session(entry, notice)
        if notice:
            self._notify_user("Recovered your last session after restart. Open ThriveTracker if you want to review it.", "ThriveTracker")

    def _restore_break_state(self, project_id: str, break_started_at: datetime, notice: str) -> None:
        self.active_entry = None
        self.break_resume_project_id = project_id
        self.break_started_at = break_started_at
        self.last_heartbeat_success_at = datetime.now(timezone.utc)
        project = next((item for item in self.projects if item.id == project_id), None)
        if project:
            self.project_var.set(project.name)

        self.error_text.set(notice)
        self.status_text.set("On break")
        self.tracking_state_text.set("On break")
        self.screenshot_text.set("Screenshots: paused")
        self.activity_text.set("Activity: paused")
        self.timer_text.set(f"On break: {format_duration(max(0, int((datetime.now(timezone.utc) - break_started_at).total_seconds())), show_seconds=True)}")
        self.button_text.set("Stop")
        self.break_button_text.set("Resume")
        self.break_button.configure(state="normal")
        self.project_combo.configure(state="disabled")
        self._set_busy(False)
        self._send_heartbeat()
        self._persist_session_state(force=True)
        self._set_tray_state("paused")

    def _reconcile_startup_state(
        self,
        session_snapshot: SessionSnapshot,
        persisted_state: PersistedSessionState | None,
    ) -> StartupState:
        now = datetime.now(timezone.utc)
        restore_cutoff = now - timedelta(minutes=SESSION_RECOVERY_GRACE_MINUTES)
        stale_cutoff = now - timedelta(minutes=SESSION_STALE_CLOSE_MINUTES)

        active_entry = session_snapshot.active_entry
        if active_entry:
            if active_entry.device_fingerprint and active_entry.device_fingerprint != self.device.fingerprint_hash:
                self._clear_session_state()
                return StartupState(notice=f"Tracking is already running on {active_entry.device_hostname or 'another device'}.")

            runtime_at = (
                persisted_state.last_runtime_at
                if persisted_state and persisted_state.entry_id == active_entry.id
                else None
            )

            if persisted_state and runtime_at and self._is_pending_stop_mode(persisted_state.mode):
                return StartupState(notice=self._recover_pending_stop_state(active_entry, persisted_state.mode, runtime_at))

            if runtime_at and runtime_at >= restore_cutoff:
                return StartupState(restored_entry=active_entry, notice="Recovered your active session after restart.")

            if (runtime_at and runtime_at < stale_cutoff) or (session_snapshot.last_seen_at and session_snapshot.last_seen_at < stale_cutoff):
                stopped_at = runtime_at or session_snapshot.last_seen_at or now
                if stopped_at < active_entry.started_at:
                    stopped_at = active_entry.started_at
                duration_seconds = max(0, int((stopped_at - active_entry.started_at).total_seconds()))
                self.api.update_time_entry_stop(
                    entry_id=active_entry.id,
                    stopped_at=stopped_at.isoformat(),
                    duration_seconds=duration_seconds,
                    reason="crash",
                )
                self._clear_session_state()
                return StartupState(notice="Recovered a session that ended while the app was closed.")

            if persisted_state:
                return StartupState(restored_entry=active_entry, notice="Recovered your active session after restart.")

            return StartupState(notice="An open session is still attached to this device. Press Start to reconnect if you are still working.")

        if persisted_state and persisted_state.mode == "break" and persisted_state.project_id and persisted_state.last_runtime_at >= restore_cutoff:
            return StartupState(
                break_project_id=persisted_state.project_id,
                break_started_at=persisted_state.break_started_at or persisted_state.last_runtime_at,
                notice="Restored your break after restart.",
            )

        if persisted_state:
            self._clear_session_state()
        return StartupState()

    def _selected_project(self) -> Project | None:
        selected_name = self.project_var.get()
        for project in self.projects:
            if project.name == selected_name:
                return project
        return None

    def _tick(self) -> None:
        now = datetime.now(timezone.utc)
        if self._handle_runtime_gap(now):
            self.root.after(1000, self._tick)
            return

        if self.active_entry:
            elapsed = max(0, int((now - self.active_entry.started_at).total_seconds()))
            self.timer_text.set(format_duration(elapsed, show_seconds=True))
            self._persist_session_state()
        elif self.break_started_at:
            elapsed = max(0, int((now - self.break_started_at).total_seconds()))
            self.timer_text.set(f"On break: {format_duration(elapsed, show_seconds=True)}")
            self._persist_session_state()

        if self.active_entry or self.break_started_at:
            self._update_today_text()

        self.last_runtime_tick_at = now
        self.root.after(1000, self._tick)

    def _handle_runtime_gap(self, now: datetime) -> bool:
        if not self.last_runtime_tick_at:
            return False

        gap_seconds = (now - self.last_runtime_tick_at).total_seconds()
        if gap_seconds < SLEEP_GAP_SECONDS:
            return False

        if self.active_entry and not self.is_sleep_stopping:
            self._pause_for_sleep_resume(self.last_runtime_tick_at)
            self.last_runtime_tick_at = now
            return True

        self.last_runtime_tick_at = now
        return False

    def _pause_for_sleep_resume(self, stopped_at: datetime) -> None:
        if not self.active_entry or self.is_sleep_stopping:
            return

        self.is_sleep_stopping = True
        self._flush_pending_activity(self.active_entry.id)
        self.status_text.set("Sleep detected")
        self.tracking_state_text.set("Stopping unreliable time")
        self.screenshot_text.set("Screenshots: paused")
        self.activity_text.set("Activity: paused")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()

        entry = self.active_entry
        self._set_busy(True, "Sleep detected...")
        threading.Thread(target=self._sleep_stop_worker, args=(entry, stopped_at), daemon=True).start()

    def _sleep_stop_worker(self, entry: TimeEntry, stopped_at: datetime) -> None:
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        self.session_state.save_sleep_pending_stop(
            entry_id=entry.id,
            project_id=entry.project_id,
            started_at=entry.started_at,
            stopped_at=stopped_at,
            last_heartbeat_at=self.last_heartbeat_success_at,
        )
        try:
            updated = self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason="crash",
            )
            self.root.after(0, lambda: self._finish_sleep_pause(duration_seconds if updated else None, queued=False))
        except Exception:
            queued = self._try_enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": "crash",
                },
            )
            self.root.after(0, lambda: ((self._update_queue_text() if queued else None), self._finish_sleep_pause(duration_seconds, queued=True)))

    def _finish_sleep_pause(self, duration_seconds: int | None, queued: bool) -> None:
        if duration_seconds is not None:
            self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.is_sleep_stopping = False
        self.last_heartbeat_success_at = None
        self.last_runtime_tick_at = None
        self.timer_text.set("00:00:00")
        self.status_text.set("Sleep detected")
        self.tracking_state_text.set("Press Start when ready")
        self.screenshot_text.set("Screenshots: stopped")
        self.activity_text.set("Activity: stopped")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        if duration_seconds is None:
            self._clear_session_state()
            self.error_text.set("The session had already been closed before sleep recovery finished. Totals were refreshed.")
            self._request_today_total_sync()
        elif queued:
            self.error_text.set("Your timer was stopped because the computer slept. The stop will sync when the internet returns.")
        else:
            self._clear_session_state()
            self.error_text.set("Your timer was stopped because the computer slept. Press Start when you are back to work.")
        self._update_today_text()
        self._set_busy(False)
        self._set_tray_state("attention")
        self._notify_user(
            "Your timer was stopped because the computer slept. Open ThriveTracker and press Start when you are back.",
            "ThriveTracker",
        )

    def _is_pending_stop_mode(self, mode: str) -> bool:
        return mode in {"shutdown_pending", "connectivity_pending_stop", "idle_pending_stop", "sleep_pending_stop"}

    def _recover_pending_stop_state(self, active_entry: TimeEntry, mode: str, runtime_at: datetime) -> str:
        stopped_at = runtime_at if runtime_at >= active_entry.started_at else active_entry.started_at
        duration_seconds = max(0, int((stopped_at - active_entry.started_at).total_seconds()))
        reason, notice = {
            "shutdown_pending": ("app_close", "Recovered a session that was stopping while the app was offline."),
            "connectivity_pending_stop": ("connection_lost", "Recovered a session that had already stopped after connection loss."),
            "idle_pending_stop": ("idle", "Recovered a session that had already paused after idle."),
            "sleep_pending_stop": ("crash", "Recovered a session that had already stopped after the computer slept."),
        }[mode]
        self.api.update_time_entry_stop(
            entry_id=active_entry.id,
            stopped_at=stopped_at.isoformat(),
            duration_seconds=duration_seconds,
            reason=reason,
        )
        self._clear_session_state()
        return notice

    def _set_busy(self, is_busy: bool, status: str | None = None) -> None:
        if status:
            self.status_text.set(status)
        self.toggle_button.configure(state="disabled" if is_busy else "normal")
        if self.active_entry or self.break_resume_project_id:
            self.break_button.configure(state="disabled" if is_busy else "normal")

    def _finish_error(self, message: str) -> None:
        if self._is_auth_session_error(message):
            self._handle_auth_session_failure(message)
            return
        self.error_text.set(message)
        self._set_busy(False)
        if self.active_entry:
            self.button_text.set("Stop")
            self.break_button_text.set("Take Break")
        elif self.break_resume_project_id:
            self.button_text.set("Stop")
            self.break_button_text.set("Resume")
        elif self.connectivity_resume_project_id and self.connectivity_resume_ready:
            self.button_text.set("Resume")
            self.break_button_text.set("Take Break")
        else:
            self.button_text.set("Start")
            self.break_button_text.set("Take Break")
        if self._is_update_required() and not self.active_entry:
            self.toggle_button.configure(state="disabled")
        self.refresh_external_state()

    def _update_today_text(self) -> None:
        self.today_text.set(f"Today: {format_duration(self.today_total_seconds + self._current_active_today_seconds())}")

    def _save_refreshed_session(self, user: AuthenticatedUser) -> None:
        if not user.remember_session:
            return

        self._save_local_config_tokens()


def format_duration(total_seconds: int, show_seconds: bool = False) -> str:
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60

    if show_seconds:
        return f"{hours:02}:{minutes:02}:{seconds:02}"

    return f"{hours}h {minutes:02}m"


def _is_valid_time(value: str | None) -> bool:
    return bool(value and len(value) == 5 and value[2] == ":" and value[:2].isdigit() and value[3:].isdigit())


class ToolTip:
    def __init__(self, widget, text: str) -> None:
        self.widget = widget
        self.text = text
        self.tip_window: tk.Toplevel | None = None
        widget.bind("<Enter>", self.show)
        widget.bind("<Leave>", self.hide)

    def show(self, _event=None) -> None:
        if self.tip_window:
            return
        x = self.widget.winfo_rootx() + 20
        y = self.widget.winfo_rooty() - 28
        self.tip_window = tk.Toplevel(self.widget)
        self.tip_window.wm_overrideredirect(True)
        self.tip_window.wm_geometry(f"+{x}+{y}")
        label = tk.Label(
            self.tip_window,
            text=self.text,
            background="#111827",
            foreground="white",
            borderwidth=0,
            padx=8,
            pady=4,
            font=("Segoe UI", 9),
        )
        label.pack()

    def hide(self, _event=None) -> None:
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None
