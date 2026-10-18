"""Создает адаптивную страницу с расписанием на текущий день в Москве."""

from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from random import choice
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


try:
    MOSCOW_TZ = ZoneInfo("Europe/Moscow")
except ZoneInfoNotFoundError:
    # У Москвы UTC+3 без сезонного перевода часов. Этот резерв нужен, например,
    # для Windows, где база часовых поясов может быть не установлена.
    MOSCOW_TZ = timezone(timedelta(hours=3), "Europe/Moscow")


WEEKDAYS = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)

MONTHS = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)

TUTOR_LESSONS = {
    0: ("18:00", "🇬🇧", "Репетитор по английскому", "Занятие по расписанию."),
    2: ("18:00", "🇬🇧", "Репетитор по английскому", "Занятие по расписанию."),
    1: ("19:30", "📐", "Репетитор по математике", "Занятие по расписанию."),
    3: ("20:30", "📐", "Репетитор по математике", "Занятие по расписанию."),
}

FOCUS_TIPS = (
    "Стабильный режим помогает легче включаться в учебу. Постарайся ложиться и вставать примерно в одно время.",
    "Попробуй Pomodoro: 25 минут сосредоточенной работы, затем 5 минут отдыха. После четырех циклов сделай длинный перерыв.",
    "Выбери три главные задачи дня. Если выполнишь их, день уже продвинет тебя к цели.",
    "В конце дня спокойно оцени невыполненные задачи: перенеси важные на конкретное время, а лишние убери из списка.",
)


def build_tasks(day_index: int) -> tuple[str, bool]:
    """Возвращает HTML задач и признак буднего дня."""
    is_weekday = day_index < 5

    if is_weekday:
        tasks = [
            ("07:20", "☀️", "Подъем", "Начни день без спешки."),
            ("08:00", "🚏", "Выход к остановке", "Автобус отправляется в 08:06."),
            ("08:06", "🚌", "Автобус", "Дорога на работу."),
            ("09:00–17:00", "🛍️", "Работа продавцом", "Рабочий день."),
        ]

        if day_index in TUTOR_LESSONS:
            tasks.append(TUTOR_LESSONS[day_index])

        tasks.extend(
            [
                (
                    "Вечером",
                    "🏃",
                    "Физическая активность",
                    "Один час движения: тренировка, прогулка или другой подходящий вариант.",
                ),
                (
                    "После активности",
                    "🎬",
                    "Личная карьера",
                    "Видеомонтаж, стримы и работа над трейд-ботом.",
                ),
            ]
        )
    else:
        tasks = [
            ("10:00", "☀️", "Подъем", "Спокойное начало выходного дня."),
            (
                "Первая половина дня",
                "📚",
                "Домашние задания репетиторам",
                "Закрой задания по английскому и математике.",
            ),
            (
                "Днем",
                "🎬",
                "Личная карьера",
                "Видеомонтаж, стримы и работа над трейд-ботом.",
            ),
        ]

    task_cards = "\n".join(
        f"""<article class="task">
          <div class="task-time">{escape(time_label)}</div>
          <div class="task-icon" aria-hidden="true">{escape(icon)}</div>
          <div class="task-copy">
            <h3>{escape(title)}</h3>
            <p>{escape(description)}</p>
          </div>
        </article>"""
        for time_label, icon, title, description in tasks
    )

    return task_cards, is_weekday


def main() -> None:
    now = datetime.now(MOSCOW_TZ)
    weekday = WEEKDAYS[now.weekday()]
    date_label = f"{now.day} {MONTHS[now.month - 1]} {now.year}"
    task_cards, is_weekday = build_tasks(now.weekday())
    day_type = "Будний день" if is_weekday else "Выходной день"
    focus_tip = escape(choice(FOCUS_TIPS))

    page = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f5f5f7">
  <meta name="description" content="Персональное расписание на сегодня по московскому времени.">
  <title>Расписание на {escape(date_label)}</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --blue: #0071e3;
      --line: rgba(29, 29, 31, .08);
      --surface: rgba(255, 255, 255, .86);
    }}

    * {{ box-sizing: border-box; }}

    body {{
      margin: 0;
      min-height: 100vh;
      padding: 36px 20px 48px;
      background:
        radial-gradient(ellipse at 50% -20%, rgba(0, 113, 227, .12), transparent 54%),
        #f5f5f7;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }}

    main {{ width: min(100%, 760px); margin: 0 auto; }}

    .topline {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 30px;
      color: var(--muted);
      font-size: 13px;
      letter-spacing: .01em;
    }}

    .brand {{ color: var(--ink); font-weight: 650; }}

    .timezone {{
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, .6);
      white-space: nowrap;
    }}

    .hero {{ margin: 0 0 26px; text-align: center; }}

    .eyebrow {{
      margin: 0 0 10px;
      color: var(--blue);
      font-size: 13px;
      font-weight: 650;
      letter-spacing: .04em;
      text-transform: uppercase;
    }}

    h1 {{
      margin: 0;
      font-size: clamp(38px, 8vw, 60px);
      font-weight: 700;
      letter-spacing: -.055em;
      line-height: 1.04;
    }}

    .date {{ margin: 12px 0 0; color: var(--muted); font-size: 18px; }}

    .goal {{
      margin: 28px 0;
      padding: 21px 24px;
      border: 1px solid rgba(0, 113, 227, .10);
      border-radius: 22px;
      background: linear-gradient(135deg, rgba(0, 113, 227, .09), rgba(255, 255, 255, .85) 70%);
      box-shadow: 0 12px 36px rgba(31, 65, 110, .06);
    }}

    .goal-label {{
      margin: 0 0 6px;
      color: var(--blue);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .07em;
      text-transform: uppercase;
    }}

    .goal p:last-child {{ margin: 0; font-size: 16px; line-height: 1.5; }}

    .schedule {{
      overflow: hidden;
      border: 1px solid rgba(29, 29, 31, .06);
      border-radius: 26px;
      background: var(--surface);
      box-shadow: 0 18px 55px rgba(31, 35, 41, .08);
      backdrop-filter: blur(18px);
    }}

    .schedule-heading {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 26px 16px;
    }}

    .schedule-heading h2 {{ margin: 0; font-size: 20px; letter-spacing: -.025em; }}
    .schedule-heading span {{ color: var(--muted); font-size: 13px; }}

    .task {{
      display: grid;
      grid-template-columns: 132px 40px minmax(0, 1fr);
      align-items: start;
      gap: 14px;
      padding: 18px 26px;
      border-top: 1px solid var(--line);
    }}

    .task-time {{
      padding-top: 2px;
      color: var(--blue);
      font-size: 14px;
      font-weight: 650;
      line-height: 1.45;
    }}

    .task-icon {{ font-size: 23px; line-height: 1.1; }}
    .task-copy h3 {{ margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.015em; }}
    .task-copy p {{ margin: 5px 0 0; color: var(--muted); font-size: 14px; line-height: 1.45; }}

    .focus {{
      margin-top: 24px;
      padding: 23px 25px;
      border-radius: 23px;
      background: #1d1d1f;
      color: #fff;
      box-shadow: 0 16px 38px rgba(29, 29, 31, .15);
    }}

    .focus h2 {{ margin: 0 0 9px; font-size: 18px; letter-spacing: -.02em; }}
    .focus p {{ margin: 0; color: rgba(255, 255, 255, .78); font-size: 15px; line-height: 1.55; }}

    footer {{ margin-top: 22px; color: #8a8a8e; text-align: center; font-size: 12px; }}

    @media (max-width: 520px) {{
      body {{ padding: 22px 14px 32px; }}
      .topline {{ margin-bottom: 28px; font-size: 12px; }}
      .timezone {{ padding: 7px 9px; }}
      .date {{ font-size: 16px; }}
      .goal {{ margin: 23px 0; padding: 18px 19px; border-radius: 19px; }}
      .schedule {{ border-radius: 22px; }}
      .schedule-heading {{ padding: 20px 18px 14px; }}
      .task {{ grid-template-columns: 74px 28px minmax(0, 1fr); gap: 9px; padding: 16px 17px; }}
      .task-time {{ font-size: 12px; }}
      .task-icon {{ font-size: 20px; }}
      .task-copy h3 {{ font-size: 15px; }}
      .task-copy p {{ font-size: 13px; }}
      .focus {{ padding: 20px; border-radius: 20px; }}
    }}
  </style>
</head>
<body>
  <main>
    <div class="topline">
      <span class="brand">Твой план</span>
      <span class="timezone">Москва · UTC+3</span>
    </div>

    <header class="hero">
      <p class="eyebrow">{escape(day_type)}</p>
      <h1>План на сегодня</h1>
      <p class="date">{escape(weekday.capitalize())}, {escape(date_label)}</p>
    </header>

    <section class="goal" aria-label="Главная цель">
      <p class="goal-label">Цель на ближайшие 8 месяцев</p>
      <p>Подготовка к ЦЭ/ЦТ для поступления в университет. Каждый учебный шаг приближает к цели.</p>
    </section>

    <section class="schedule" aria-labelledby="schedule-title">
      <div class="schedule-heading">
        <h2 id="schedule-title">Расписание дня</h2>
        <span>На сегодня</span>
      </div>
      {task_cards}
    </section>

    <section class="focus" aria-labelledby="focus-title">
      <h2 id="focus-title">💡 Фокус дня</h2>
      <p>{focus_tip}</p>
    </section>

    <footer>Обновлено {now:%H:%M} по московскому времени</footer>
  </main>
</body>
</html>
"""

    output_path = Path(__file__).with_name("index.html")
    output_path.write_text(page, encoding="utf-8")
    print(f"Создан файл {output_path} для {weekday}, {date_label} (Москва, UTC+3).")


if __name__ == "__main__":
    main()
