import tkinter as tk
from tkinter import ttk
from tkinter import messagebox
import logging

from . import __app_name__, __version__
from .app_lock import AppLock, AppLockError
from .app_paths import ensure_app_dirs, get_app_paths
from .config import get_config
from .device_identity import get_device_identity
from .logging_setup import configure_logging
from .auth_service import AuthenticatedUser
from .tray import TrayController
from .ui.login_window import LoginWindow
from .ui.main_window import MainWindow


LOGGER = logging.getLogger(__name__)


class DesktopApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.paths = get_app_paths()
        ensure_app_dirs(self.paths)
        self.app_lock = AppLock(self.paths.lock_file)
        self.app_lock.acquire()
        configure_logging(self.paths.logs_dir)
        self.config = get_config(self.paths)
        self.device = get_device_identity(self.paths)
        self.main_window: MainWindow | None = None
        self.tray: TrayController | None = None
        self._configure_root()
        self.show_login()

    def _configure_root(self) -> None:
        self.root.title(__app_name__)
        self.root.geometry("440x560")
        self.root.minsize(420, 440)
        self.root.configure(bg="#F8FAFC")

        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background="#F8FAFC")
        style.configure("TLabel", background="#F8FAFC", foreground="#0F172A", font=("Segoe UI", 10))
        style.configure("Title.TLabel", font=("Segoe UI", 18, "bold"), foreground="#111827")
        style.configure("Muted.TLabel", foreground="#64748B")
        style.configure("Error.TLabel", background="#F8FAFC", foreground="#B91C1C")
        style.configure("Status.TLabel", background="#F8FAFC", foreground="#166534", font=("Segoe UI", 10, "bold"))
        style.configure("Timer.TLabel", background="#F8FAFC", foreground="#111827", font=("Segoe UI", 28, "bold"))
        style.configure("TButton", font=("Segoe UI", 10), padding=(14, 8))
        style.configure("TCheckbutton", background="#F8FAFC", foreground="#0F172A", font=("Segoe UI", 10))
        style.configure("TCombobox", padding=(8, 6))
        style.configure("Link.TButton", font=("Segoe UI", 9, "underline"), padding=0, foreground="#2563EB", background="#F8FAFC", borderwidth=0)

    def clear(self) -> None:
        for child in self.root.winfo_children():
            child.destroy()

    def show_login(self, notice: str = "") -> None:
        self.clear()
        self.config = get_config(self.paths)
        LOGGER.info("Showing login window for desktop agent v%s", __version__)
        LoginWindow(self.root, self.paths, self.config, self.show_main, initial_notice=notice)

    def show_main(self, user: AuthenticatedUser) -> None:
        self.clear()
        LOGGER.info("User signed in: %s", user.email)
        self.main_window = MainWindow(
            self.root,
            self.config,
            user,
            self.paths,
            self.device,
            self.paths.temp_dir,
            self.paths.queue_dir,
            self.hide_to_tray,
            self.notify_user,
            self.set_tray_state,
            self.set_tray_resume_ready,
            self.logout_to_login,
            self.exit_app,
        )
        self._start_tray()
        self.main_window.refresh_external_state()
        self.root.protocol("WM_DELETE_WINDOW", self.hide_to_tray)

    def _start_tray(self) -> None:
        if self.tray:
            return

        self.tray = TrayController(
            on_toggle_tracking=lambda: self.root.after(0, self.toggle_tracking_from_tray),
            on_logout=lambda: self.root.after(0, self.logout_from_tray),
            on_show_window=lambda: self.root.after(0, self.show_window),
            on_quit=lambda: self.root.after(0, self.quit_from_tray),
        )
        self.tray.start()

    def hide_to_tray(self) -> None:
        self.root.withdraw()

    def show_window(self) -> None:
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def toggle_tracking_from_tray(self) -> None:
        if not self.main_window:
            self.show_window()
            return

        self.show_window()
        self.main_window.toggle_tracking_from_tray()

    def logout_from_tray(self) -> None:
        self.show_window()
        if self.main_window:
            self.main_window.request_logout()

    def logout_to_login(self, notice: str = "") -> None:
        self.main_window = None
        self.set_tray_resume_ready(False)
        self.set_tray_state("stopped")
        self.show_login(notice)
        self.show_window()

    def set_tray_state(self, state: str) -> None:
        if self.tray:
            self.tray.set_state(state)

    def set_tray_resume_ready(self, is_ready: bool) -> None:
        if self.tray:
            self.tray.set_resume_ready(is_ready)

    def notify_user(self, message: str, title: str | None = None) -> None:
        if self.tray:
            self.tray.notify(message, title)

    def exit_app(self) -> None:
        if self.tray:
            self.tray.stop()
            self.tray = None
        self.app_lock.release()
        self.root.destroy()

    def quit_from_tray(self) -> None:
        if self.main_window:
            self.main_window.stop_for_app_close()
        self.exit_app()


def main() -> int:
    root = tk.Tk()
    app: DesktopApp | None = None
    try:
        app = DesktopApp(root)
    except AppLockError as error:
        root.withdraw()
        messagebox.showerror(__app_name__, str(error), parent=root)
        root.destroy()
        return 1

    try:
        root.mainloop()
    finally:
        if app:
            app.app_lock.release()
        LOGGER.info("Desktop agent scaffold closed")

    return 0
