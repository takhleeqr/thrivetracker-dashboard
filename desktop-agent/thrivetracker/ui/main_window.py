from datetime import datetime, timezone
from collections.abc import Callable
import threading
import tkinter as tk
from tkinter import messagebox
from tkinter import ttk

from ..activity_tracker import ActivitySnapshot, ActivityTracker
from ..api_service import ApiError, Project, SupabaseApiService, TimeEntry
from ..app_paths import AppPaths
from ..device_identity import DeviceIdentity
from ..auth_service import AuthenticatedUser
from ..config import AppConfig, save_local_config
from ..offline_queue import OfflineQueue, QueueItem
from ..screenshot_service import CapturedScreenshot, ScreenshotService
from ..window_tracker import get_active_window_info


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
    ) -> None:
        super().__init__(root, padding=24)
        self.root = root
        self.config = config
        self.user = user
        self.paths = paths
        self.device = device
        self.on_minimize = on_minimize
        self.api = SupabaseApiService(
            config.supabase_url,
            config.supabase_anon_key,
            user,
            on_session_refresh=self._save_refreshed_session,
        )
        self.screenshots = ScreenshotService(temp_dir, config.screenshot_quality)
        self.offline_queue = OfflineQueue(queue_dir / "offline_queue.sqlite3")

        self.projects: list[Project] = []
        self.active_entry: TimeEntry | None = None
        self.today_total_seconds = 0
        self.screenshots_today = 0
        self.screenshot_after_id: str | None = None
        self.activity_tracker: ActivityTracker | None = None
        self.activity_after_id: str | None = None
        self.idle_after_id: str | None = None
        self.queue_after_id: str | None = None
        self.settings_after_id: str | None = None
        self.heartbeat_after_id: str | None = None
        self.is_retrying_queue = False
        self.last_activity_percent: float | None = None
        self.idle_resume_project_id: str | None = None
        self.break_resume_project_id: str | None = None
        self.break_started_at: datetime | None = None
        self.idle_minutes: int = 0

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

    def _build(self) -> None:
        self.pack(fill="both", expand=True)

        ttk.Label(self, text=self.user.full_name, style="Muted.TLabel").pack(anchor="w")
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
        minimize_button = ttk.Button(footer, text="Minimize", command=self.on_minimize)
        minimize_button.pack(side="right")
        ToolTip(minimize_button, "Minimize to Tray")

    def _load_initial_data(self) -> None:
        self._set_busy(True, "Loading projects...")
        threading.Thread(target=self._load_initial_data_worker, daemon=True).start()

    def _load_initial_data_worker(self) -> None:
        try:
            self.api.register_device(self.device)
            projects = self.api.get_assigned_projects()
            total_seconds = self.api.get_today_total_seconds()
            self.root.after(0, lambda: self._finish_initial_data(projects, total_seconds))
        except Exception as error:
            message = str(error) if isinstance(error, ApiError) else "Could not load your projects."
            self.root.after(0, lambda: self._finish_error(message))

    def _finish_initial_data(self, projects: list[Project], total_seconds: int) -> None:
        self.projects = projects
        self.today_total_seconds = total_seconds
        self.project_combo["values"] = [project.name for project in projects]

        if projects:
            self.project_combo.current(0)
            self.status_text.set("Stopped")
            self._set_busy(False)
        else:
            self.status_text.set("No assigned projects")
            self.toggle_button.configure(state="disabled")

        self._update_today_text()

    def _toggle_timer(self) -> None:
        if self.active_entry:
            self._stop_timer("manual")
        elif self.break_resume_project_id:
            self._stop_break_shift()
        else:
            self._start_timer()

    def toggle_tracking_from_tray(self) -> None:
        self._toggle_timer()

    def is_tracking(self) -> bool:
        return self.active_entry is not None

    def _start_timer(self) -> None:
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
        self.active_entry = entry
        active_project = next((project for project in self.projects if project.id == entry.project_id), None)
        self.idle_resume_project_id = None
        self.break_resume_project_id = None
        self.break_started_at = None
        self.last_activity_percent = None
        self.error_text.set("")
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
        self._start_activity_tracking()
        self._schedule_next_screenshot()
        self._schedule_idle_check()
        self._send_heartbeat()

    def _stop_timer(self, reason: str) -> None:
        if not self.active_entry:
            return

        entry = self.active_entry
        self._set_busy(True, "Stopping...")
        threading.Thread(target=self._stop_timer_worker, args=(entry, reason), daemon=True).start()

    def _stop_timer_worker(self, entry: TimeEntry, reason: str) -> None:
        stopped_at = datetime.now(timezone.utc)
        duration_seconds = max(0, int((stopped_at - entry.started_at).total_seconds()))
        try:
            self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason=reason,
            )
            self.root.after(0, lambda: self._finish_stop(duration_seconds))
        except Exception:
            self.offline_queue.enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": reason,
                },
            )
            self.root.after(0, lambda: (self._update_queue_text(), self._finish_stop(duration_seconds)))

    def _finish_stop(self, duration_seconds: int) -> None:
        self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.break_resume_project_id = None
        self.break_started_at = None
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()
        self.timer_text.set("00:00:00")
        self.status_text.set("Stopped")
        self.tracking_state_text.set("Ready")
        self.screenshot_text.set("Screenshots: stopped")
        self.activity_text.set("Activity: stopped")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        self._update_today_text()
        self._set_busy(False)

    def _toggle_break(self) -> None:
        if self.active_entry:
            self._take_break()
        elif self.break_resume_project_id:
            self._resume_after_break()

    def _take_break(self) -> None:
        if not self.active_entry:
            return

        self.break_resume_project_id = self.active_entry.project_id
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
            self.api.update_time_entry_stop(
                entry_id=entry.id,
                stopped_at=stopped_at.isoformat(),
                duration_seconds=duration_seconds,
                reason="break",
            )
            self.root.after(0, lambda: self._finish_break(duration_seconds))
        except Exception:
            self.offline_queue.enqueue(
                "time_entry_stop",
                {
                    "entry_id": entry.id,
                    "stopped_at": stopped_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "reason": "break",
                },
            )
            self.root.after(0, lambda: (self._update_queue_text(), self._finish_break(duration_seconds)))

    def _finish_break(self, duration_seconds: int) -> None:
        self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.break_started_at = datetime.now(timezone.utc)
        self.timer_text.set("On break: 00:00:00")
        self.status_text.set("On break")
        self.tracking_state_text.set("On break")
        self.button_text.set("Stop")
        self.break_button_text.set("Resume")
        self.break_button.configure(state="normal")
        self.project_combo.configure(state="disabled")
        self._update_today_text()
        self._set_busy(False)
        self._send_heartbeat()

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

    def _stop_break_shift(self) -> None:
        self.break_resume_project_id = None
        self.break_started_at = None
        self._cancel_heartbeat()
        self.timer_text.set("00:00:00")
        self.status_text.set("Stopped")
        self.tracking_state_text.set("Ready")
        self.button_text.set("Start")
        self.break_button_text.set("Take Break")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")

    def stop_for_app_close(self) -> None:
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_settings_sync()
        self._cancel_heartbeat()
        self._stop_activity_tracking()
        if self.active_entry:
            stopped_at = datetime.now(timezone.utc)
            duration_seconds = max(0, int((stopped_at - self.active_entry.started_at).total_seconds()))
            try:
                self.api.update_time_entry_stop(
                    entry_id=self.active_entry.id,
                    stopped_at=stopped_at.isoformat(),
                    duration_seconds=duration_seconds,
                    reason="app_close",
                )
            except ApiError:
                self.offline_queue.enqueue(
                    "time_entry_stop",
                    {
                        "entry_id": self.active_entry.id,
                        "stopped_at": stopped_at.isoformat(),
                        "duration_seconds": duration_seconds,
                        "reason": "app_close",
                    },
                )

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
        self.status_text.set("Idle - paused")
        self.tracking_state_text.set("Paused")
        self.screenshot_text.set("Screenshots: paused")
        self.activity_text.set("Activity: paused")
        self.button_text.set("Start")
        self.break_button.configure(state="disabled")
        self._cancel_screenshot_schedule()
        self._cancel_idle_check()
        self._cancel_heartbeat()
        self._stop_activity_tracking()

        entry = self.active_entry
        self._set_busy(True, "Idle - pausing...")
        threading.Thread(target=self._idle_stop_worker, args=(entry,), daemon=True).start()

    def _idle_stop_worker(self, entry: TimeEntry) -> None:
        try:
            duration_seconds = self.api.stop_time_entry(entry, "idle")
            self.root.after(0, lambda: self._finish_idle_pause(duration_seconds))
        except Exception:
            self.root.after(0, lambda: self._finish_error("Could not pause after idle."))

    def _finish_idle_pause(self, duration_seconds: int) -> None:
        self.today_total_seconds += duration_seconds
        self.active_entry = None
        self.timer_text.set("00:00:00")
        self.status_text.set("Idle - paused")
        self.tracking_state_text.set("Paused")
        self.button_text.set("Start")
        self.break_button.configure(state="disabled")
        self.project_combo.configure(state="readonly")
        self._update_today_text()
        self._set_busy(False)
        self._prompt_resume_after_idle()

    def _prompt_resume_after_idle(self) -> None:
        should_resume = messagebox.askyesno(
            "Resume timer?",
            f"You were idle for about {self.idle_minutes} minute(s). Resume tracking?",
            parent=self.root,
        )
        if should_resume:
            self._resume_after_idle()

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
            self.offline_queue.enqueue(
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
            self.root.after(0, lambda: (self._update_queue_text(), self._finish_screenshot_upload_error(screenshot)))

    def _finish_screenshot_upload(self, screenshot: CapturedScreenshot) -> None:
        if not self.active_entry:
            return

        self.screenshot_text.set(f"Screenshots: uploaded {screenshot.file_path.name}")
        self._schedule_next_screenshot()

    def _finish_screenshot_upload_error(self, screenshot: CapturedScreenshot) -> None:
        if not self.active_entry:
            return

        self.screenshot_text.set(f"Screenshots: upload failed, kept {screenshot.file_path.name}")
        self._schedule_next_screenshot()

    def _finish_screenshot_error(self) -> None:
        if not self.active_entry:
            return

        self.screenshot_text.set("Screenshots: capture failed")
        self._schedule_next_screenshot()

    def _start_activity_tracking(self) -> None:
        self._stop_activity_tracking()
        self.activity_tracker = ActivityTracker()

        try:
            self.activity_tracker.start()
        except Exception:
            self.activity_tracker = None
            self.activity_text.set("Activity: listener failed")
            return

        self.activity_text.set("Activity: recording")
        self._schedule_activity_log()

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
            self.offline_queue.enqueue("activity_log", payload)
            self.root.after(0, lambda: (self.activity_text.set("Activity: upload failed"), self._update_queue_text()))

    def _send_heartbeat(self) -> None:
        self._cancel_heartbeat()
        if not self.active_entry and not self.break_resume_project_id:
            return

        threading.Thread(target=self._heartbeat_worker, daemon=True).start()

    def _heartbeat_worker(self) -> None:
        try:
            self.api.record_heartbeat(self.device.install_id)
        except Exception:
            pass
        finally:
            self.root.after(0, self._schedule_heartbeat)

    def _schedule_heartbeat(self) -> None:
        if not self.active_entry and not self.break_resume_project_id:
            return
        self.heartbeat_after_id = self.root.after(2 * 60 * 1000, self._send_heartbeat)

    def _cancel_heartbeat(self) -> None:
        if self.heartbeat_after_id:
            self.root.after_cancel(self.heartbeat_after_id)
            self.heartbeat_after_id = None

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
        try:
            for item in self.offline_queue.oldest(limit=10):
                try:
                    self._replay_queue_item(item)
                    self.offline_queue.delete(item.id)
                except Exception as error:
                    self.offline_queue.mark_failed(item.id, str(error))
                    break
        finally:
            self.root.after(0, self._finish_queue_retry)

    def _replay_queue_item(self, item: QueueItem) -> None:
        if item.operation_type == "time_entry_stop":
            self.api.update_time_entry_stop(
                entry_id=item.payload["entry_id"],
                stopped_at=item.payload["stopped_at"],
                duration_seconds=int(item.payload["duration_seconds"]),
                reason=item.payload["reason"],
            )
            return

        if item.operation_type == "activity_log":
            self.api.insert_activity_log_payload(item.payload)
            return

        if item.operation_type == "screenshot_upload":
            if not item.file_path or not item.file_path.exists():
                return

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
            return

        raise RuntimeError(f"Unknown queue operation: {item.operation_type}")

    def _finish_queue_retry(self) -> None:
        self.is_retrying_queue = False
        self._update_queue_text()
        self._schedule_queue_retry()

    def _update_queue_text(self) -> None:
        self.queue_text.set(f"Queue: {self.offline_queue.count()} pending")

    def _sync_settings(self) -> None:
        threading.Thread(target=self._sync_settings_worker, daemon=True).start()

    def _sync_settings_worker(self) -> None:
        try:
            settings = self.api.get_settings()
            self.root.after(0, lambda: self._finish_settings_sync(settings))
        except Exception:
            self.root.after(0, self._finish_settings_sync_error)

    def _finish_settings_sync(self, settings: dict[str, str]) -> None:
        self.config = self.config.with_settings(settings)
        self.screenshots.quality = max(1, min(100, self.config.screenshot_quality))
        self.settings_text.set("Settings: synced")
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

    def _selected_project(self) -> Project | None:
        selected_name = self.project_var.get()
        for project in self.projects:
            if project.name == selected_name:
                return project
        return None

    def _tick(self) -> None:
        if self.active_entry:
            elapsed = max(0, int((datetime.now(timezone.utc) - self.active_entry.started_at).total_seconds()))
            self.timer_text.set(format_duration(elapsed, show_seconds=True))
        elif self.break_started_at:
            elapsed = max(0, int((datetime.now(timezone.utc) - self.break_started_at).total_seconds()))
            self.timer_text.set(f"On break: {format_duration(elapsed, show_seconds=True)}")

        self.root.after(1000, self._tick)

    def _set_busy(self, is_busy: bool, status: str | None = None) -> None:
        if status:
            self.status_text.set(status)
        self.toggle_button.configure(state="disabled" if is_busy else "normal")
        if self.active_entry or self.break_resume_project_id:
            self.break_button.configure(state="disabled" if is_busy else "normal")

    def _finish_error(self, message: str) -> None:
        self.error_text.set(message)
        self._set_busy(False)
        if self.active_entry:
            self.button_text.set("Stop")
            self.break_button_text.set("Take Break")
        elif self.break_resume_project_id:
            self.button_text.set("Stop")
            self.break_button_text.set("Resume")
        else:
            self.button_text.set("Start")
            self.break_button_text.set("Take Break")

    def _update_today_text(self) -> None:
        self.today_text.set(f"Today: {format_duration(self.today_total_seconds)}")

    def _save_refreshed_session(self, user: AuthenticatedUser) -> None:
        if not user.remember_session:
            return

        save_local_config(
            self.paths,
            {
                "supabase_url": self.config.supabase_url,
                "email": user.email,
                "storage_bucket": self.config.storage_bucket,
                "access_token": user.access_token,
                "refresh_token": user.refresh_token,
            },
        )


def format_duration(total_seconds: int, show_seconds: bool = False) -> str:
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60

    if show_seconds:
        return f"{hours:02}:{minutes:02}:{seconds:02}"

    return f"{hours}h {minutes:02}m"


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
