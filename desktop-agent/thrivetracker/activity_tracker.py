from dataclasses import dataclass
import threading
import time

from pynput import keyboard, mouse


@dataclass(frozen=True)
class ActivitySnapshot:
    keystrokes_count: int
    mouse_clicks_count: int
    mouse_moved: bool
    activity_percent: float
    seconds_since_last_input: float


class ActivityTracker:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.period_started_at = time.monotonic()
        self.last_input_time = time.monotonic()
        self.keystrokes_count = 0
        self.mouse_clicks_count = 0
        self.mouse_moved = False
        self.last_input_at = time.monotonic()
        self.active_slots = [False, False, False, False, False, False]
        self.keyboard_listener = keyboard.Listener(on_press=self._on_key_press)
        self.mouse_listener = mouse.Listener(on_click=self._on_click, on_move=self._on_move)

    def start(self) -> None:
        self.keyboard_listener.start()
        self.mouse_listener.start()

    def stop(self) -> None:
        self.keyboard_listener.stop()
        self.mouse_listener.stop()

    def get_idle_time_seconds(self) -> float:
        with self.lock:
            return time.monotonic() - self.last_input_time

    def snapshot_and_reset(self) -> ActivitySnapshot:
        with self.lock:
            active_slot_count = sum(1 for is_active in self.active_slots if is_active)
            snapshot = ActivitySnapshot(
                keystrokes_count=self.keystrokes_count,
                mouse_clicks_count=self.mouse_clicks_count,
                mouse_moved=self.mouse_moved,
                activity_percent=round((active_slot_count / 6) * 100, 2),
                seconds_since_last_input=max(0, time.monotonic() - self.last_input_at),
            )
            self.period_started_at = time.monotonic()
            self.keystrokes_count = 0
            self.mouse_clicks_count = 0
            self.mouse_moved = False
            self.active_slots = [False, False, False, False, False, False]
            return snapshot

    def _on_key_press(self, _key) -> None:
        with self.lock:
            self.last_input_time = time.monotonic()
            self.keystrokes_count += 1
            self._mark_active_slot()

    def _on_click(self, _x, _y, _button, pressed: bool) -> None:
        if not pressed:
            return

        with self.lock:
            self.last_input_time = time.monotonic()
            self.mouse_clicks_count += 1
            self._mark_active_slot()

    def _on_move(self, _x, _y) -> None:
        with self.lock:
            self.last_input_time = time.monotonic()
            self.mouse_moved = True
            self._mark_active_slot()

    def _mark_active_slot(self) -> None:
        self.last_input_at = time.monotonic()
        elapsed = max(0, time.monotonic() - self.period_started_at)
        slot_index = min(5, int(elapsed // 10))
        self.active_slots[slot_index] = True

    def seconds_since_last_input(self) -> float:
        with self.lock:
            return max(0, time.monotonic() - self.last_input_at)


class ResumeDetector:
    def __init__(self, on_resume_callback) -> None:
        self.on_resume_callback = on_resume_callback
        self.keyboard_listener = keyboard.Listener(on_press=self._on_input)
        self.mouse_listener = mouse.Listener(on_click=self._on_input, on_move=self._on_input)
        self.fired = False
        self.lock = threading.Lock()

    def start(self) -> None:
        self.keyboard_listener.start()
        self.mouse_listener.start()

    def stop(self) -> None:
        self.keyboard_listener.stop()
        self.mouse_listener.stop()

    def _on_input(self, *args, **kwargs) -> None:
        with self.lock:
            if self.fired:
                return
            self.fired = True
        
        self.stop()
        self.on_resume_callback()
