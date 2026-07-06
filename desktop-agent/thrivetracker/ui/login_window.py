from datetime import datetime, timezone
import threading
import tkinter as tk
from tkinter import ttk
from typing import Callable

from .. import __app_name__, __version__
from ..app_paths import AppPaths
from ..auth_service import AuthError, AuthenticatedUser, SupabaseAuthService
from ..config import AppConfig, save_local_config
from ..install_manager import get_install_context, install_self, queue_launch_installed_copy
from ..device_identity import get_device_identity
from ..offline_queue import OfflineQueue


LoginCallback = Callable[[AuthenticatedUser], None]


class LoginWindow(ttk.Frame):
    def __init__(
        self,
        root: tk.Tk,
        paths: AppPaths,
        config: AppConfig,
        on_login_success: LoginCallback,
        initial_notice: str = "",
    ) -> None:
        super().__init__(root, padding=28)
        self.root = root
        self.paths = paths
        self.config = config
        self.on_login_success = on_login_success
        self.initial_notice = initial_notice
        self.auth_service = SupabaseAuthService()
        self.device = get_device_identity(paths)
        self.offline_queue = OfflineQueue(paths.queue_dir / "offline_queue.sqlite3")
        self.install_context = get_install_context(__app_name__)
        self.install_required = self.install_context.needs_installation

        self.server_url = tk.StringVar(value=config.supabase_url)
        self.email = tk.StringVar(value=config.remembered_email)
        self.password = tk.StringVar()
        self.remember_me = tk.BooleanVar(value=bool(config.remembered_refresh_token or config.remembered_email))
        self.status_text = tk.StringVar(value=initial_notice)
        self.show_server_url = not bool(config.supabase_url.strip())

        self._build()
        self.root.bind("<Return>", self._submit_from_enter)
        if config.remembered_refresh_token and not self.install_required:
            self._restore_saved_session()

    def _build(self) -> None:
        self.pack(fill="both", expand=True)

        ttk.Label(self, text=self.config.company_name, style="Muted.TLabel").pack(anchor="w")
        ttk.Label(self, text=f"Desktop Agent v{__version__}", style="Muted.TLabel").pack(anchor="w", pady=(2, 0))
        ttk.Label(self, text="Install on this PC" if self.install_required else "Sign in", style="Title.TLabel").pack(anchor="w", pady=(8, 18))

        if self.install_required:
            action_label = "Update installed app" if self.install_context.installed_executable.exists() else "Install now"
            ttk.Label(
                self,
                text="This is the one-time setup step for this computer. After install, the tracker can open from Windows and future updates can be installed from inside the app.",
                style="Muted.TLabel",
                wraplength=340,
            ).pack(anchor="w", pady=(0, 16))
            self.login_button = ttk.Button(self, text=action_label, command=self._install_self)
            self.login_button.pack(fill="x", pady=(4, 10))
            ttk.Label(self, textvariable=self.status_text, style="Error.TLabel", wraplength=330).pack(anchor="w")
            return

        if self.show_server_url:
            self._field("Server URL", self.server_url)

        email_entry = self._field("Email", self.email)
        password_entry = self._field("Password", self.password, show="*")

        ttk.Checkbutton(self, text="Remember me", variable=self.remember_me).pack(anchor="w", pady=(2, 12))

        self.login_button = ttk.Button(self, text="Login", command=self._submit)
        self.login_button.pack(fill="x", pady=(4, 10))

        ttk.Label(self, textvariable=self.status_text, style="Error.TLabel", wraplength=330).pack(anchor="w")
        (email_entry if not self.email.get() else password_entry).focus_set()

    def _field(self, label: str, variable: tk.StringVar, show: str | None = None) -> ttk.Entry:
        ttk.Label(self, text=label).pack(anchor="w", pady=(0, 4))
        entry = ttk.Entry(self, textvariable=variable, show=show)
        entry.pack(fill="x", pady=(0, 12))
        return entry

    def _submit_from_enter(self, _event) -> None:
        if self.install_required:
            self._install_self()
            return
        self._submit()

    def _submit(self) -> None:
        if str(self.login_button["state"]) == "disabled":
            return

        self.status_text.set("Signing in...")
        self.login_button.configure(state="disabled")

        thread = threading.Thread(target=self._sign_in_worker, daemon=True)
        thread.start()

    def _install_self(self) -> None:
        if str(self.login_button["state"]) == "disabled":
            return

        self.status_text.set("Installing ThriveTracker...")
        self.login_button.configure(state="disabled")
        threading.Thread(target=self._install_self_worker, daemon=True).start()

    def _install_self_worker(self) -> None:
        try:
            context = install_self(__app_name__)
            queue_launch_installed_copy(context.installed_executable)
            self.root.after(0, self._finish_install_success)
        except Exception as error:
            self.root.after(0, lambda: self._finish_error(f"Could not install the desktop app. {error}"))

    def _finish_install_success(self) -> None:
        self.status_text.set("Installed. The app will reopen in a moment.")
        self.root.after(350, self.root.destroy)

    def _sign_in_worker(self) -> None:
        try:
            user = self.auth_service.sign_in(
                supabase_url=self.config.supabase_url or self.server_url.get().strip(),
                anon_key=self.config.supabase_anon_key,
                email=self.email.get().strip(),
                password=self.password.get(),
            )
            self.root.after(0, lambda: self._finish_success(user))
        except Exception as error:
            message = str(error) if isinstance(error, AuthError) else "Login failed. Please try again."
            self._queue_agent_event(
                event_type="login_failed",
                severity="error",
                message=message,
                details={"email": self.email.get().strip()},
            )
            self.root.after(0, lambda: self._finish_error(message))

    def _finish_success(self, user: AuthenticatedUser) -> None:
        user.remember_session = self.remember_me.get()
        self._save_login_preference(user if self.remember_me.get() else None)

        self.status_text.set("")
        self.login_button.configure(state="normal")
        self.on_login_success(user)

    def _finish_error(self, message: str) -> None:
        self.status_text.set(message)
        self.login_button.configure(state="normal")

    def _restore_saved_session(self) -> None:
        self.status_text.set("Restoring saved login...")
        self.login_button.configure(state="disabled")
        threading.Thread(target=self._restore_saved_session_worker, daemon=True).start()

    def _restore_saved_session_worker(self) -> None:
        try:
            user = self.auth_service.restore_session(
                supabase_url=self.config.supabase_url or self.server_url.get().strip(),
                anon_key=self.config.supabase_anon_key,
                access_token=self.config.remembered_access_token,
                refresh_token=self.config.remembered_refresh_token,
            )
            self.root.after(0, lambda: self._finish_success(user))
        except Exception as error:
            message = str(error) if isinstance(error, AuthError) else "Saved login expired. Please sign in again."
            self._clear_saved_session()
            self._queue_agent_event(
                event_type="saved_session_restore_failed",
                severity="warning",
                message=message,
                details={"email": self.email.get().strip()},
            )
            self.root.after(0, lambda: self._finish_error(message))

    def _save_login_preference(self, user: AuthenticatedUser | None) -> None:
        config_data = {
            "supabase_url": self.config.supabase_url or self.server_url.get().strip(),
            "email": self.email.get().strip() or (user.email if user else ""),
            "storage_bucket": self.config.storage_bucket,
        }
        if user:
            config_data["access_token"] = user.access_token
            config_data["refresh_token"] = user.refresh_token

        save_local_config(self.paths, config_data)

    def _clear_saved_session(self) -> None:
        save_local_config(
            self.paths,
            {
                "supabase_url": self.config.supabase_url or self.server_url.get().strip(),
                "email": self.email.get().strip() or self.config.remembered_email,
                "storage_bucket": self.config.storage_bucket,
                "acknowledged_force_reauth_nonce": self.config.acknowledged_force_reauth_nonce,
            },
        )

    def _queue_agent_event(self, event_type: str, severity: str, message: str, details: dict | None = None) -> None:
        try:
            self.offline_queue.enqueue(
                "agent_event",
                {
                    "install_id": self.device.install_id,
                    "hostname": self.device.hostname,
                    "app_version": __version__,
                    "event_type": event_type,
                    "severity": severity,
                    "message": message,
                    "details": details or {},
                    "occurred_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            return
