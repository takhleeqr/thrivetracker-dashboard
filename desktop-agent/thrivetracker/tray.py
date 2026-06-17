from collections.abc import Callable
import threading

from PIL import Image, ImageDraw
import pystray


class TrayController:
    def __init__(
        self,
        on_toggle_tracking: Callable[[], None],
        on_show_window: Callable[[], None],
        on_quit: Callable[[], None],
    ) -> None:
        self.on_toggle_tracking = on_toggle_tracking
        self.on_show_window = on_show_window
        self.on_quit = on_quit
        self.icon = pystray.Icon(
            "ThriveTracker",
            self._create_icon_image(),
            "ThriveTracker",
            pystray.Menu(
                pystray.MenuItem("Start/Stop", self._toggle_tracking),
                pystray.MenuItem("Show Window", self._show_window),
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

    def _toggle_tracking(self) -> None:
        self.on_toggle_tracking()

    def _show_window(self) -> None:
        self.on_show_window()

    def _quit(self) -> None:
        self.on_quit()

    def _create_icon_image(self) -> Image.Image:
        image = Image.new("RGBA", (64, 64), (248, 250, 252, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((8, 8, 56, 56), radius=12, fill=(37, 99, 235, 255))
        draw.polygon([(28, 22), (28, 42), (44, 32)], fill=(255, 255, 255, 255))
        return image
