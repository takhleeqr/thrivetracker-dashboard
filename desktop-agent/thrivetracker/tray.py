from collections.abc import Callable
import threading

from PIL import Image, ImageDraw
import pystray

from . import __app_name__


class TrayController:
    def __init__(
        self,
        on_toggle_tracking: Callable[[], None],
        on_logout: Callable[[], None],
        on_show_window: Callable[[], None],
        on_quit: Callable[[], None],
    ) -> None:
        self.on_toggle_tracking = on_toggle_tracking
        self.on_logout = on_logout
        self.on_show_window = on_show_window
        self.on_quit = on_quit
        self.state = "stopped"
        self.icon = pystray.Icon(
            __app_name__,
            self._create_icon_image(self.state),
            __app_name__,
            pystray.Menu(
                pystray.MenuItem(lambda _: "Stop Timer" if self.state == "tracking" else "Start Timer", self._toggle_tracking),
                pystray.MenuItem(lambda _: f"Status: {self._label_for_state()}", None, enabled=False),
                pystray.MenuItem("Show Window", self._show_window),
                pystray.MenuItem("Logout", self._logout),
                pystray.MenuItem("Quit", self._quit),
            ),
        )
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return

        self.thread = threading.Thread(target=self.icon.run, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.icon.stop()

    def set_state(self, state: str) -> None:
        self.state = state
        self.icon.icon = self._create_icon_image(state)
        self.icon.title = f"{__app_name__} - {self._label_for_state()}"
        self.icon.update_menu()

    def notify(self, message: str, title: str | None = None) -> None:
        try:
            self.icon.notify(message, title or __app_name__)
        except Exception:
            return

    def _toggle_tracking(self) -> None:
        self.on_toggle_tracking()

    def _show_window(self) -> None:
        self.on_show_window()

    def _logout(self) -> None:
        self.on_logout()

    def _quit(self) -> None:
        self.on_quit()

    def _label_for_state(self) -> str:
        labels = {
            "tracking": "Tracking",
            "paused": "Paused",
            "attention": "Needs attention",
            "stopped": "Stopped",
        }
        return labels.get(self.state, "Stopped")

    def _create_icon_image(self, state: str) -> Image.Image:
        colors = {
            "tracking": (34, 197, 94, 255),
            "paused": (245, 158, 11, 255),
            "attention": (220, 38, 38, 255),
            "stopped": (100, 116, 139, 255),
        }
        image = Image.new("RGBA", (64, 64), (248, 250, 252, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((8, 8, 56, 56), radius=12, fill=colors.get(state, colors["stopped"]))
        draw.polygon([(28, 22), (28, 42), (44, 32)], fill=(255, 255, 255, 255))
        return image
