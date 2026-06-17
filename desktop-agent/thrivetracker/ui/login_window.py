import threading
import tkinter as tk
from tkinter import ttk
from typing import Callable

from ..app_paths import AppPaths
from ..auth_service import AuthError, AuthenticatedUser, SupabaseAuthService
from ..config import AppConfig, save_local_config


LoginCallback = Callable[[AuthenticatedUser], None]


class LoginWindow(ttk.Frame):
    def __init__(
        self,
        root: tk.Tk,
        paths: AppPaths,
        config: AppConfig,
        on_login_success: LoginCallback,
    ) -> None:
        super().__init__(root, padding=28)
        self.root = root
        self.paths = paths
        self.config = config
        self.on_login_success = on_login_success
        self.auth_service = SupabaseAuthService()

        self.server_url = tk.StringVar(value=config.supabase_url)
        self.email = tk.StringVar(value=config.remembered_email)
        self.password = tk.StringVar()
        self.remember_me = tk.BooleanVar(value=bool(config.remembered_refresh_token or config.remembered_email))
        self.status_text = tk.StringVar(value="")
        self.show_server_url = not bool(config.supabase_url.strip())

        self._build()
        self.root.bind("<Return>", self._submit_from_enter)
        if config.remembered_refresh_token:
            self._restore_saved_session()

    def _build(self) -> None:
        self.pack(fill="both", expand=True)

        ttk.Label(self, text=self.config.company_name, style="Muted.TLabel").pack(anchor="w")
        ttk.Label(self, text="Sign in", style="Title.TLabel").pack(anchor="w", pady=(8, 18))

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
        self._submit()

    def _submit(self) -> None:
        if str(self.login_button["state"]) == "disabled":
            return

        self.status_text.set("Signing in...")
        self.login_button.configure(state="disabled")

        thread = threading.Thread(target=self._sign_in_worker, daemon=True)
        thread.start()

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
