from dataclasses import dataclass, replace
from pathlib import Path
import json
import os

from .app_paths import AppPaths

try:
    from . import company_config
except ImportError:
    company_config = None


@dataclass(frozen=True)
class AppConfig:
    supabase_url: str
    supabase_anon_key: str
    storage_bucket: str
    company_name: str
    timezone: str
    minimum_desktop_version: str
    desktop_update_download_url: str
    desktop_update_required_message: str
    remembered_email: str
    remembered_access_token: str
    remembered_refresh_token: str
    acknowledged_force_reauth_nonce: int
    screenshot_interval_minutes: int
    screenshot_quality: int
    max_screenshots_per_day: int
    idle_timeout_minutes: int
    connectivity_grace_minutes: int
    shift_start_reminder_delay_minutes: int

    def with_settings(self, settings: dict[str, str]) -> "AppConfig":
        return replace(
            self,
            screenshot_interval_minutes=_int_from_mapping(
                settings,
                "screenshot_interval_minutes",
                self.screenshot_interval_minutes,
            ),
            screenshot_quality=_int_from_mapping(settings, "screenshot_quality", self.screenshot_quality),
            max_screenshots_per_day=_int_from_mapping(
                settings,
                "max_screenshots_per_day",
                self.max_screenshots_per_day,
            ),
            idle_timeout_minutes=_int_from_mapping(settings, "idle_timeout_minutes", self.idle_timeout_minutes),
            connectivity_grace_minutes=_int_from_mapping(
                settings,
                "connectivity_grace_minutes",
                self.connectivity_grace_minutes,
            ),
            shift_start_reminder_delay_minutes=_int_from_mapping(
                settings,
                "shift_start_reminder_delay_minutes",
                self.shift_start_reminder_delay_minutes,
            ),
            timezone=settings.get("timezone", self.timezone) or self.timezone,
            minimum_desktop_version=settings.get("minimum_desktop_version", self.minimum_desktop_version) or "",
            desktop_update_download_url=settings.get("desktop_update_download_url", self.desktop_update_download_url) or "",
            desktop_update_required_message=(
                settings.get("desktop_update_required_message", self.desktop_update_required_message)
                or self.desktop_update_required_message
            ),
        )


def load_project_env() -> None:
    project_env = Path(__file__).resolve().parents[2] / ".env"
    if not project_env.exists():
        return

    for raw_line in project_env.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def load_local_config(paths: AppPaths) -> dict:
    if not paths.config_file.exists():
        return {}

    try:
        return json.loads(paths.config_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_local_config(paths: AppPaths, data: dict) -> None:
    paths.config_file.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_config(paths: AppPaths) -> AppConfig:
    load_project_env()
    local_config = load_local_config(paths)

    return AppConfig(
        supabase_url=(
            local_config.get("supabase_url")
            or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
            or _company_value("NEXT_PUBLIC_SUPABASE_URL", "")
        ),
        supabase_anon_key=(
            local_config.get("supabase_anon_key")
            or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
            or _company_value("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
        ),
        storage_bucket=(
            local_config.get("storage_bucket")
            or os.getenv("SUPABASE_STORAGE_BUCKET")
            or _company_value("SUPABASE_STORAGE_BUCKET", "screenshots")
        ),
        company_name=os.getenv("APP_COMPANY_NAME") or _company_value("APP_COMPANY_NAME", "ThriveTracker"),
        timezone=os.getenv("APP_TIMEZONE") or _company_value("APP_TIMEZONE", "UTC"),
        minimum_desktop_version=local_config.get("minimum_desktop_version", ""),
        desktop_update_download_url=local_config.get("desktop_update_download_url", ""),
        desktop_update_required_message=local_config.get(
            "desktop_update_required_message",
            "A newer ThriveTracker version is required. Please install the latest build before continuing.",
        ),
        remembered_email=local_config.get("email", ""),
        remembered_access_token=local_config.get("access_token", ""),
        remembered_refresh_token=local_config.get("refresh_token", ""),
        acknowledged_force_reauth_nonce=_int_from_mapping(local_config, "acknowledged_force_reauth_nonce", 0),
        screenshot_interval_minutes=_int_from_env("SCREENSHOT_INTERVAL_MINUTES", 5),
        screenshot_quality=_int_from_env("SCREENSHOT_QUALITY", 60),
        max_screenshots_per_day=_int_from_env("MAX_SCREENSHOTS_PER_DAY", 200),
        idle_timeout_minutes=_int_from_env("IDLE_TIMEOUT_MINUTES", 5),
        connectivity_grace_minutes=_int_from_env("CONNECTIVITY_GRACE_MINUTES", 10),
        shift_start_reminder_delay_minutes=_int_from_env("SHIFT_START_REMINDER_DELAY_MINUTES", 10),
    )


def _int_from_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default

    try:
        return int(value)
    except ValueError:
        return default


def _company_value(name: str, default: str) -> str:
    if not company_config:
        return default

    return getattr(company_config, name, default)


def _int_from_mapping(settings: dict[str, str], key: str, default: int) -> int:
    value = settings.get(key)
    if value is None:
        return default

    try:
        return int(value)
    except ValueError:
        return default
