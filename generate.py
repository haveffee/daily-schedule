"""Проверяет статическое приложение HVF перед публикацией.

Имя сохранено для совместимости со старой командой запуска. Скрипт ничего
не генерирует и не изменяет: цели, дела и финансы задаёт только пользователь.
"""

import json
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
REQUIRED = (
    "index.html",
    "assistant.css",
    "assistant-navigation.css",
    "assistant-finance.css",
    "assistant-planner.css",
    "assistant-reminders.css",
    "assistant-focus.css",
    "assistant-limits.css",
    "assistant-update.css",
    "assistant-sales.css",
    "assistant-membership.css",
    "assistant-motion.css",
    "assistant-onboarding.css",
    "assistant-mobile.css",
    "app-config.js",
    "assistant-billing.js",
    "assistant-ui.js",
    "assistant-navigation.js",
    "assistant-motion.js",
    "assistant-core.js",
    "assistant-forecast.js",
    "assistant-categories.js",
    "assistant-backup.js",
    "assistant-planner.js",
    "assistant-weekly.js",
    "assistant-store.js",
    "assistant-focus.js",
    "assistant-limits.js",
    "assistant-extras.js",
    "assistant-reminders.js",
    "reminders-config.js",
    "pwa.js",
    "service-worker.js",
    "firebase-config.js",
    "favicon.svg",
    "apple-touch-icon.png",
    "apple-touch-icon-v2.png",
    "icon-192.png",
    "icon-512.png",
    "manifest.webmanifest",
    "privacy.html",
    "terms.html",
)


def main() -> None:
    missing = [name for name in REQUIRED if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Missing application files: " + ", ".join(missing))

    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    for icon in manifest.get("icons", []):
        if not (ROOT / urlsplit(icon["src"]).path).is_file():
            raise SystemExit("Missing manifest icon: " + icon["src"])

    print("HVF static application validated. No user data or HTML was modified.")


if __name__ == "__main__":
    main()
