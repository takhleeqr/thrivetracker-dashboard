from dataclasses import dataclass

import pygetwindow


@dataclass(frozen=True)
class ActiveWindowInfo:
    title: str | None
    app_name: str | None


def get_active_window_info() -> ActiveWindowInfo:
    try:
        active_window = pygetwindow.getActiveWindow()
    except Exception:
        return ActiveWindowInfo(title=None, app_name=None)

    if not active_window or not active_window.title:
        return ActiveWindowInfo(title=None, app_name=None)

    title = active_window.title.strip()
    if not title:
        return ActiveWindowInfo(title=None, app_name=None)

    return ActiveWindowInfo(title=title, app_name=extract_app_name(title))


def extract_app_name(title: str) -> str:
    separators = (" - ", " | ", " -- ")
    for separator in separators:
        if separator in title:
            candidate = title.split(separator)[-1].strip()
            if candidate:
                return candidate

    return title[:80]
