from logging.handlers import RotatingFileHandler
from pathlib import Path
import logging


def configure_logging(logs_dir: Path) -> None:
    log_file = logs_dir / "agent.log"
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=1_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    logging.basicConfig(
        level=logging.INFO,
        handlers=[file_handler],
    )
