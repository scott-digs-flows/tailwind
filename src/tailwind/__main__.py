"""Development entrypoint: `python -m tailwind`."""

from __future__ import annotations

from tailwind.app import create_app
from tailwind.config import settings
from tailwind.logging import configure_logging


def main() -> None:
    configure_logging(settings.log_level)
    app = create_app()
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug,
    )


if __name__ == "__main__":
    main()
