import os

try:
    from . import company_config
except ImportError:
    company_config = None


def _company_value(name: str, default: str) -> str:
    if not company_config:
        return default

    return getattr(company_config, name, default)


__app_name__ = os.getenv("APP_INTERNAL_NAME") or _company_value("APP_INTERNAL_NAME", "ThriveTracker")
__version__ = "1.2.0"
