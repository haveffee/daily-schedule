"""Создает адаптивное расписание на текущий день по московскому времени."""

import json
from datetime import date, datetime, timedelta, timezone
from html import escape
from pathlib import Path
from random import choice
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


try:
    MOSCOW_TZ = ZoneInfo("Europe/Moscow")
except ZoneInfoNotFoundError:
    # Москва круглый год живет в UTC+3; резерв нужен для Windows без tzdata.
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

MONTH_TITLES = (
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)

FOCUS_TIPS = (
    "Стабильный режим помогает легче включаться в учебу. Постарайся ложиться и вставать примерно в одно время.",
    "Попробуй Pomodoro: 25 минут сосредоточенной работы, затем 5 минут отдыха. После четырех циклов сделай длинный перерыв.",
    "Выбери три главные задачи дня. Если выполнишь их, день уже продвинет тебя к цели.",
    "В конце дня спокойно оцени невыполненные задачи: перенеси важные на конкретное время, а лишние убери из списка.",
)

WEEKLY_HABITS = (
    ("📝", "План из трех приоритетов", "Запиши три главные задачи: учеба, обязательное дело и забота о себе."),
    ("🧠", "Активное вспоминание", "Пять минут вспомни одну тему ЦЭ/ЦТ без конспекта, затем проверь себя."),
    ("🇬🇧", "Пять английских слов", "Повтори пять слов и составь с одним из них короткое предложение."),
    ("📐", "Один шаг по математике", "Реши один небольшой пример или восстанови формулу по памяти."),
    ("📖", "Пять минут чтения", "Прочитай пару страниц полезной книги без уведомлений."),
    ("🧹", "Пять минут порядка", "Приведи в порядок рабочее место или убери одну небольшую вещь."),
    ("🎒", "Подготовить нужное заранее", "Проверь, что нужные материалы и вещи готовы к сегодняшним делам."),
    ("🌿", "Спокойное начало дня", "Сделай несколько медленных вдохов и выбери, с чего начнешь день."),
    ("✍️", "Короткая запись", "Запиши одну мысль или вопрос, который хочешь прояснить сегодня."),
    ("🔕", "Первые пять минут без телефона", "Начни день без ленты и уведомлений; сразу перейди к утреннему плану."),
    ("✅", "Сначала маленький шаг", "Начни одну важную задачу с самого простого действия на пять минут."),
    ("🌙", "Итог и следующий шаг", "Вспомни один сделанный шаг и выбери первый шаг на завтра."),
)

HABIT_EPOCH = date(2026, 1, 5)  # понедельник; привычка меняется раз в неделю


def minutes(time_label: str) -> int:
    """Преобразует время HH:MM в количество минут от начала суток."""
    hour, minute = (int(part) for part in time_label.split(":"))
    return hour * 60 + minute


def make_event(
    start: str,
    end: str,
    icon: str,
    title: str,
    description: str,
    category: str = "fixed",
) -> dict[str, int | str]:
    return {
        "start": minutes(start),
        "end": minutes(end),
        "icon": icon,
        "title": title,
        "description": description,
        "category": category,
    }


def habit_for_week(current_date: date) -> tuple[str, str, str]:
    """Выбирает одну небольшую привычку, одинаковую на протяжении всей недели."""
    week_index = max(0, (current_date - HABIT_EPOCH).days // 7)
    return WEEKLY_HABITS[week_index % len(WEEKLY_HABITS)]


def build_schedule(
    day_index: int,
    weekly_habit: tuple[str, str, str],
) -> tuple[list[dict[str, int | str]], bool, int, int, int]:
    """Возвращает фиксированные события, границы дня и начало гибкого времени."""
    is_weekday = day_index < 5
    habit_icon, habit_title, habit_description = weekly_habit

    if not is_weekday:
        events = [
            make_event("10:00", "10:15", "☀️", "Подъем", "Спокойное начало выходного дня."),
            make_event("10:15", "10:45", "🥣", "Завтрак", "Позавтракай и подготовься к учебе."),
            make_event(
                "10:45",
                "10:50",
                habit_icon,
                "Микропривычка недели",
                f"{habit_title}: {habit_description}",
                "habit",
            ),
            make_event(
                "10:50",
                "12:50",
                "📚",
                "Домашние задания репетиторам",
                "Выдели время на задания по английскому и математике.",
            ),
            make_event("12:50", "13:30", "🍽️", "Обед и отдых", "Перерыв перед второй половиной дня."),
        ]
        return events, False, minutes("10:00"), minutes("13:30"), minutes("22:00")

    events = [
        make_event("07:20", "07:30", "☀️", "Подъем", "Начни день без спешки."),
        make_event("07:30", "07:45", "🥣", "Завтрак", "Завтрак перед дорогой."),
        make_event(
            "07:45",
            "07:50",
            habit_icon,
            "Микропривычка недели",
            f"{habit_title}: {habit_description}",
            "habit",
        ),
        make_event("07:50", "08:00", "🎒", "Сборы", "Подготовься к выходу."),
        make_event("08:00", "08:06", "🚶", "Дорога до остановки", "Выйди к автобусу заранее."),
        make_event("08:06", "09:00", "🚌", "Автобус и дорога", "Автобус отправляется в 08:06."),
        make_event("09:00", "17:00", "🛍️", "Работа продавцом", "Рабочий день."),
        make_event("17:00", "17:30", "🚶", "Дорога домой и пауза", "Переключись после работы."),
    ]

    if day_index in (0, 2):
        events.extend(
            [
                make_event("18:00", "19:00", "🇬🇧", "Английский с репетитором", "Продолжительность заложена как 60 минут."),
                make_event("19:00", "19:15", "🧘", "Переход к тренировке", "Небольшая пауза и подготовка."),
                make_event("19:15", "20:15", "🏃", "Физическая активность", "Один час тренировки, прогулки или движения."),
                make_event("20:15", "20:45", "🍽️", "Ужин и отдых", "Восстановись после рабочего дня."),
            ]
        )
    elif day_index == 1:
        events.extend(
            [
                make_event("17:30", "18:30", "🏃", "Физическая активность", "Один час тренировки, прогулки или движения."),
                make_event("18:30", "19:15", "🍽️", "Ужин", "Перерыв перед занятием."),
                make_event("19:15", "19:30", "📐", "Подготовка к занятию", "Подготовь материалы по математике."),
                make_event("19:30", "20:30", "📐", "Математика с репетитором", "Продолжительность заложена как 60 минут."),
                make_event("20:30", "20:45", "🧘", "Пауза после занятия", "Небольшой отдых."),
            ]
        )
    elif day_index == 3:
        events.extend(
            [
                make_event("17:30", "18:30", "🏃", "Физическая активность", "Один час тренировки, прогулки или движения."),
                make_event("18:30", "19:00", "🍽️", "Ужин", "Перерыв после тренировки."),
                make_event("20:20", "20:30", "📐", "Подготовка к занятию", "Подготовь материалы по математике."),
                make_event("20:30", "21:30", "📐", "Математика с репетитором", "Продолжительность заложена как 60 минут."),
                make_event("21:30", "21:45", "🧘", "Пауза после занятия", "Небольшой отдых."),
            ]
        )
    else:
        events.extend(
            [
                make_event("17:30", "18:30", "🏃", "Физическая активность", "Один час тренировки, прогулки или движения."),
                make_event("18:30", "19:00", "🍽️", "Ужин и отдых", "Восстановись после тренировки."),
            ]
        )

    return events, True, minutes("07:20"), minutes("17:30"), minutes("22:30")


def render_static_event(event: dict[str, int | str]) -> str:
    """HTML-версия базового расписания для отображения до запуска JavaScript."""
    start = int(event["start"])
    end = int(event["end"])
    task_class = " task--habit" if event["category"] == "habit" else ""
    time_label = f"{start // 60:02d}:{start % 60:02d}–{end // 60:02d}:{end % 60:02d}"
    return f"""<article class="task{task_class}">
      <time class="task-time">{escape(time_label)}</time>
      <div class="task-icon" aria-hidden="true">{escape(str(event["icon"]))}</div>
      <div class="task-copy">
        <h3>{escape(str(event["title"]))}</h3>
        <p>{escape(str(event["description"]))}</p>
      </div>
    </article>"""


PAGE_TEMPLATE = r"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f7">
  <meta name="description" content="Персональное расписание на сегодня по московскому времени.">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Твой план">
  <link rel="icon" type="image/svg+xml" href="./favicon.svg">
  <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png">
  <title>Расписание на __DATE__</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --blue: #0071e3;
      --line: rgba(29, 29, 31, .08);
      --surface: rgba(255, 255, 255, .88);
      --green: #248a3d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 30px 18px 48px;
      background:
        radial-gradient(ellipse at 50% -20%, rgba(0, 113, 227, .13), transparent 55%),
        #f5f5f7;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main { width: min(100%, 780px); margin: 0 auto; }
    .topline {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 30px; color: var(--muted); font-size: 13px;
    }
    .brand { color: var(--ink); font-weight: 700; }
    .timezone {
      padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px;
      background: rgba(255, 255, 255, .65); white-space: nowrap;
    }
    .hero { margin: 0 0 24px; text-align: center; }
    .eyebrow {
      margin: 0 0 10px; color: var(--blue); font-size: 13px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase;
    }
    h1 {
      margin: 0; font-size: clamp(38px, 8vw, 60px); font-weight: 720;
      letter-spacing: -.055em; line-height: 1.04;
    }
    .date { margin: 12px 0 0; color: var(--muted); font-size: 18px; }
    .goal, .panel {
      margin: 22px 0; padding: 21px 24px; border: 1px solid rgba(0, 113, 227, .10);
      border-radius: 22px; background: linear-gradient(135deg, rgba(0, 113, 227, .09), rgba(255,255,255,.9) 70%);
      box-shadow: 0 12px 36px rgba(31, 65, 110, .06);
    }
    .goal-label, .section-label {
      margin: 0 0 7px; color: var(--blue); font-size: 12px; font-weight: 750;
      letter-spacing: .07em; text-transform: uppercase;
    }
    .goal p:last-child { margin: 0; font-size: 16px; line-height: 1.5; }
    .habit-banner {
      display: grid; gap: 5px; margin: 0 0 22px; padding: 16px 20px;
      border: 1px solid rgba(119,82,168,.13); border-radius: 18px;
      background: linear-gradient(120deg, rgba(119,82,168,.09), rgba(255,255,255,.86));
    }
    .habit-banner strong { color: #7752a8; font-size: 14px; }
    .habit-banner span { color: var(--muted); font-size: 12px; }
    .habit-banner p { margin: 2px 0 0; font-size: 15px; line-height: 1.45; }
    .panel { background: var(--surface); border-color: rgba(29,29,31,.06); }
    .panel h2, .schedule-heading h2 { margin: 0; font-size: 20px; letter-spacing: -.025em; }
    .panel-intro { margin: 7px 0 17px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .task-form { display: grid; grid-template-columns: minmax(0, 1fr) 135px 145px auto; align-items: end; gap: 10px; }
    label { display: grid; gap: 7px; color: #424245; font-size: 12px; font-weight: 650; }
    input {
      width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #d2d2d7;
      border-radius: 12px; background: #fff; color: var(--ink); font: inherit; font-size: 14px;
    }
    input:focus { outline: 3px solid rgba(0,113,227,.17); border-color: var(--blue); }
    button {
      min-height: 44px; padding: 0 16px; border: 0; border-radius: 12px;
      background: var(--blue); color: #fff; font: inherit; font-size: 14px;
      font-weight: 650; cursor: pointer; transition: transform .15s, opacity .15s;
    }
    button:hover { opacity: .9; } button:active { transform: scale(.98); }
    button:focus-visible, input:focus-visible { outline: 3px solid rgba(0,113,227,.24); outline-offset: 2px; }
    .storage-note, .message { margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .message { min-height: 17px; color: var(--green); }
    .sync-row {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      margin-top: 18px; padding: 15px 16px; border: 1px solid var(--line);
      border-radius: 16px; background: rgba(245,245,247,.65);
    }
    .sync-copy { min-width: 0; }
    .sync-copy strong { display: block; font-size: 14px; }
    .sync-copy p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .sync-status { overflow-wrap: anywhere; }
    .sync-button { flex: 0 0 auto; white-space: nowrap; }
    .sync-button:disabled { cursor: not-allowed; opacity: .55; }
    .task-form button:disabled { cursor: wait; opacity: .55; }
    .goals-panel { border-color: rgba(119,82,168,.15); background: linear-gradient(145deg, rgba(119,82,168,.055), rgba(255,255,255,.94) 42%); }
    .goals-topline { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .goal-period { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .goal-form { display: grid; grid-template-columns: 1fr 1.2fr 160px; gap: 12px; align-items: end; margin-top: 18px; }
    .goal-form label { display: grid; gap: 7px; font-size: 12px; font-weight: 650; }
    .goal-form input, .goal-form select {
      width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #d2d2d7;
      border-radius: 13px; background: #fff; color: var(--ink); font: inherit; font-size: 14px;
    }
    .goal-form input:focus, .goal-form select:focus { outline: 3px solid rgba(119,82,168,.16); border-color: #7752a8; }
    .goal-form button { grid-column: 1 / -1; justify-self: start; background: #7752a8; }
    .goal-list { display: grid; gap: 8px; margin: 15px 0 0; padding: 0; list-style: none; }
    .goal-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: rgba(255,255,255,.75); }
    .goal-row strong { display: block; font-size: 14px; }
    .goal-row span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .goal-remove { min-height: 34px; padding: 0 10px; background: #f2f2f7; color: #c0392b; font-size: 12px; }
    .ai-privacy { margin: 14px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .goal-plan-controls { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 17px; }
    .goal-plan-controls button { background: #7752a8; }
    .goal-plan-controls button:disabled { cursor: not-allowed; opacity: .55; }
    .goal-status { min-height: 18px; margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .goal-status.error { color: #b42318; }
    .goal-roadmap { margin-top: 14px; }
    .goal-week { margin-top: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 15px; background: rgba(255,255,255,.68); }
    .goal-week h3 { margin: 0 0 8px; font-size: 14px; }
    .goal-plan-task { display: grid; grid-template-columns: 20px minmax(0,1fr) auto; gap: 9px; align-items: start; padding: 10px 0; border-top: 1px solid var(--line); }
    .goal-plan-task input { width: 17px; min-height: 17px; height: 17px; margin: 2px 0 0; accent-color: #34a853; }
    .goal-plan-task strong { display: block; font-size: 13px; line-height: 1.4; }
    .goal-plan-task p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .goal-plan-task[data-done="true"] strong { color: var(--muted); text-decoration: line-through; }
    .goal-task-meta { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .goal-resource, .task-resource { display: inline-block; margin-top: 5px; color: var(--blue); font-size: 12px; font-weight: 600; text-decoration: none; }
    .goal-resource:hover, .task-resource:hover { text-decoration: underline; }
    .goal-empty { color: var(--muted); font-size: 13px; }
    .my-tasks { margin-top: 12px; padding: 0; list-style: none; }
    .my-task {
      display: grid; grid-template-columns: 22px minmax(0,1fr) auto; align-items: center;
      gap: 9px; padding: 11px 0; border-top: 1px solid var(--line);
    }
    .my-task input { width: 18px; min-height: 18px; height: 18px; accent-color: var(--blue); }
    .my-task-copy { min-width: 0; }
    .my-task-title { display: block; overflow-wrap: anywhere; font-size: 14px; font-weight: 600; }
    .my-task-meta { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; }
    .my-task.done .my-task-title { color: var(--muted); text-decoration: line-through; }
    .remove-task { min-height: 34px; padding: 0 10px; background: #f2f2f7; color: #c0392b; font-size: 12px; }
    .empty-tasks { color: var(--muted); font-size: 13px; }
    .schedule {
      overflow: hidden; border: 1px solid rgba(29,29,31,.06); border-radius: 26px;
      background: var(--surface); box-shadow: 0 18px 55px rgba(31,35,41,.08);
      backdrop-filter: blur(18px);
    }
    .schedule-heading {
      display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
      padding: 22px 26px 16px;
    }
    .schedule-heading span { color: var(--muted); font-size: 13px; }
    .completion-note { margin: 0; padding: 0 26px 13px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .task {
      display: grid; grid-template-columns: 112px 38px 22px minmax(0,1fr); align-items: start;
      gap: 13px; padding: 17px 26px; border-top: 1px solid var(--line);
    }
    .task-time { padding-top: 2px; color: var(--blue); font-size: 14px; font-weight: 700; line-height: 1.45; white-space: nowrap; }
    .task-icon { font-size: 22px; line-height: 1.1; }
    .task-toggle {
      width: 18px; min-height: 18px; height: 18px; margin: 2px 0 0; padding: 0;
      border: 0; border-radius: 4px; background: transparent; accent-color: #34a853;
      cursor: pointer;
    }
    .task-copy h3 { margin: 0; font-size: 15px; font-weight: 680; letter-spacing: -.015em; }
    .task-copy p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .task--personal .task-time { color: var(--green); }
    .task--custom .task-time { color: #8a4baf; }
    .task--goal .task-time { color: #7752a8; }
    .task--habit { background: linear-gradient(90deg, rgba(0,113,227,.035), transparent 75%); }
    .task--habit .task-time { color: #7752a8; }
    .task--current {
      position: relative;
      background: linear-gradient(100deg, rgba(52,199,89,.16), rgba(52,199,89,.055));
      box-shadow: inset 4px 0 0 #34a853;
    }
    .task--current .task-time, .task--current h3 { color: #187a35; }
    .current-badge {
      display: inline-flex; align-items: center; gap: 5px; margin: 0 0 6px;
      color: #187a35; font-size: 10px; font-weight: 750; letter-spacing: .06em;
      text-transform: uppercase;
    }
    .current-badge[hidden] { display: none; }
    .current-badge::before {
      width: 7px; height: 7px; border-radius: 50%; background: #34a853; content: "";
      box-shadow: 0 0 0 3px rgba(52,199,89,.15);
    }
    .task--done { opacity: .58; }
    .task--done h3 { text-decoration: line-through; }
    .waitlist {
      margin: 14px 0 0; padding: 15px 18px; border: 1px solid #f1d19a;
      border-radius: 16px; background: #fff9ed; color: #624819; font-size: 13px;
    }
    .waitlist h3 { margin: 0 0 8px; font-size: 14px; }
    .waitlist ul { margin: 0; padding-left: 19px; }
    .focus {
      margin-top: 24px; padding: 23px 25px; border-radius: 23px; background: #1d1d1f;
      color: #fff; box-shadow: 0 16px 38px rgba(29,29,31,.15);
    }
    .focus h2 { margin: 0 0 9px; font-size: 18px; letter-spacing: -.02em; }
    .focus p { margin: 0; color: rgba(255,255,255,.78); font-size: 15px; line-height: 1.55; }
    footer { margin-top: 22px; color: #8a8a8e; text-align: center; font-size: 12px; }
    @media (max-width: 620px) {
      body { padding: 21px 13px 32px; }
      .topline { margin-bottom: 26px; font-size: 12px; }
      .timezone { padding: 7px 9px; }
      .date { font-size: 16px; }
      .goal, .panel, .habit-banner { padding: 18px; border-radius: 19px; }
      .task-form { grid-template-columns: 1fr 1fr; }
      .task-form label:first-child { grid-column: 1 / -1; }
      .task-form button { grid-column: 1 / -1; }
      .sync-row { align-items: stretch; flex-direction: column; }
      .sync-button { width: 100%; }
      .goal-form { grid-template-columns: 1fr 1fr; }
      .goal-form label:first-child, .goal-form button { grid-column: 1 / -1; }
      .goal-form button { width: 100%; }
      .goal-plan-controls button { width: 100%; }
      .goal-plan-task { grid-template-columns: 20px minmax(0,1fr); }
      .goal-task-meta { grid-column: 2; }
      .schedule { border-radius: 22px; }
      .schedule-heading { padding: 20px 17px 14px; }
      .task { grid-template-columns: 78px 27px 20px minmax(0,1fr); gap: 8px; padding: 15px 13px; }
      .task-time { font-size: 11px; }
      .task-icon { font-size: 19px; }
      .completion-note { padding: 0 17px 12px; }
      .task-copy h3 { font-size: 14px; }
      .task-copy p { font-size: 12px; }
      .focus { padding: 20px; border-radius: 20px; }
    }
    @media (max-width: 360px) {
      .task { grid-template-columns: 69px 23px 19px minmax(0,1fr); gap: 6px; padding-right: 10px; padding-left: 10px; }
      .task-time { font-size: 10px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="topline">
      <span class="brand">Твой план</span>
      <span class="timezone">Москва · UTC+3</span>
    </div>
    <header class="hero">
      <p class="eyebrow">__DAY_TYPE__</p>
      <h1>План на сегодня</h1>
      <p class="date">__WEEKDAY__, __DATE__</p>
    </header>
    <section class="goal" aria-label="Главная цель">
      <p class="goal-label">Цель на ближайшие 8 месяцев</p>
      <p>Подготовка к ЦЭ/ЦТ для поступления в университет. Каждый учебный шаг приближает к цели.</p>
    </section>
    <section class="habit-banner" aria-label="Привычка недели">
      <strong>Небольшой шаг этой недели</strong>
      <span>Одна полезная привычка · 5 минут в день</span>
      <p>__HABIT_TITLE__</p>
    </section>
    <section class="panel goals-panel" aria-labelledby="goals-title">
      <div class="goals-topline">
        <p class="section-label">Цели и развитие</p>
        <span class="goal-period">__MONTH_TITLE__</span>
      </div>
      <h2 id="goals-title">Цели на месяц</h2>
      <p class="panel-intro">Добавь до трёх конкретных целей на этот месяц. Qwen предложит поэтапный план и поставит занятия в свободные окна, сохраняя работу, репетиторов и отдых. Войди через Google, чтобы видеть те же цели на телефоне и компьютере.</p>
      <form class="goal-form" id="goalForm">
        <label>Цель
          <input name="title" maxlength="90" placeholder="Например, научиться видеомонтажу" required>
        </label>
        <label>Результат к концу месяца
          <input name="outcome" maxlength="160" placeholder="Смонтировать и опубликовать ролик" required>
        </label>
        <label>Время на цель · мин/неделю
          <select name="weeklyMinutes"><option value="60">60</option><option value="90" selected>90</option><option value="120">120</option></select>
        </label>
        <button type="submit">Добавить цель</button>
      </form>
      <ul class="goal-list" id="goalList"></ul>
      <div class="goal-plan-controls">
        <button id="generatePlanButton" type="button" disabled>Составить план на месяц</button>
      </div>
      <p class="goal-status" id="goalStatus" aria-live="polite">Планировщик готов. Добавь цель и создай план.</p>
      <div class="goal-roadmap" id="goalRoadmap"></div>
      <p class="ai-privacy">План формирует локальная Qwen-модель: цели не отправляются AI-провайдеру. На совместимом компьютере с WebGPU и 8 ГБ памяти доступна более крупная модель (около 1,43 ГБ); на телефоне используется компактная (около 570 МБ). Для обучающих шагов добавляется ссылка на поиск видеоуроков в YouTube — конкретный ролик ты выберешь сам. При первом построении нужен интернет для загрузки модели с Hugging Face.</p>
    </section>
    <section class="panel" aria-labelledby="custom-title">
      <p class="section-label">Планировщик</p>
      <h2 id="custom-title">Добавить дело на сегодня</h2>
      <p class="panel-intro">Укажи название и длительность. Задача встанет в свободное окно, не перекрывая работу, репетитора и другие фиксированные блоки.</p>
      <form class="task-form" id="taskForm">
        <label>Дело
          <input name="title" maxlength="100" placeholder="Например, разобрать конспект" required>
        </label>
        <label>Длительность, мин
          <input name="duration" type="number" min="5" max="480" step="5" value="30" required>
        </label>
        <label>Начать после
          <input name="time" type="time" aria-label="Желаемое время начала">
        </label>
        <button type="submit">Добавить дело</button>
      </form>
      <div class="sync-row" aria-label="Синхронизация между устройствами">
        <div class="sync-copy">
          <strong>Синхронизация между устройствами</strong>
          <p class="sync-status" id="syncStatus" aria-live="polite">Проверяю настройки синхронизации…</p>
          <p id="syncAccount" hidden></p>
        </div>
        <button class="sync-button" id="syncButton" type="button">Подключить Google</button>
      </div>
      <p class="storage-note">Без времени дело поставится в ближайшее свободное окно. Если окно занято — поиск продолжится позже. Для общего списка войди в один Google-аккаунт на компьютере и iPhone.</p>
      <p class="message" id="message" aria-live="polite"></p>
      <ul class="my-tasks" id="myTasks"></ul>
    </section>
    <section class="schedule" aria-labelledby="schedule-title">
      <div class="schedule-heading">
        <h2 id="schedule-title">Расписание дня</h2>
        <span>Время с точностью до минуты</span>
      </div>
      <p class="completion-note">Отмечай выполненное галочкой — дела зачеркнутся, а при входе через Google синхронизируются.</p>
      <div id="timeline">
        __STATIC_TASKS__
      </div>
    </section>
    <section class="waitlist" id="waitlist" hidden aria-live="polite"></section>
    <section class="focus" aria-labelledby="focus-title">
      <h2 id="focus-title">💡 Фокус дня</h2>
      <p>__FOCUS_TIP__</p>
    </section>
    <footer>Обновлено __UPDATED__ по московскому времени · Длительность занятий с репетиторами принята за 60 минут</footer>
  </main>
  <script src="./firebase-config.js?v=fc374-plan1"></script>
  <script>
    "use strict";
    const baseEvents = __EVENTS_JSON__;
    const dateKey = "__DATE_ISO__";
    const monthKey = "__MONTH_ISO__";
    const dayStart = __DAY_START__;
    const flexStart = __FLEX_START__;
    const dayEnd = __DAY_END__;
    const localStorageKey = "daily-schedule-" + dateKey;
    const migrationKey = localStorageKey + "-cloud-migrated";
    const scheduleCompletionPrefix = "__schedule_done__";
    const localCompletionStorageKey = localStorageKey + "-schedule-completions";
    let storageKey = localStorageKey;
    let completionStorageKey = localCompletionStorageKey;
    const timeline = document.getElementById("timeline");
    const taskList = document.getElementById("myTasks");
    const message = document.getElementById("message");
    const waitlist = document.getElementById("waitlist");
    const form = document.getElementById("taskForm");
    const goalForm = document.getElementById("goalForm");
    const goalList = document.getElementById("goalList");
    const goalStatus = document.getElementById("goalStatus");
    const goalRoadmap = document.getElementById("goalRoadmap");
    const generatePlanButton = document.getElementById("generatePlanButton");
    const weeklyMinutesOptions = new Set([60, 90, 120]);
    const localPlanningKey = "daily-schedule-planning-" + monthKey;
    let planningStorageKey = localPlanningKey;

    function readTasks(key = storageKey) {
      try {
        const saved = localStorage.getItem(key);
        const parsed = saved ? JSON.parse(saved) : [];
        return Array.isArray(parsed) ? parsed.filter((task) =>
          task && typeof task.id === "string" && typeof task.title === "string"
        ) : [];
      } catch (error) {
        message.textContent = "Не удалось прочитать сохраненные дела в этом браузере.";
        return [];
      }
    }

    function readScheduleCompletions(key = completionStorageKey) {
      try {
        const saved = localStorage.getItem(key);
        const parsed = saved ? JSON.parse(saved) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter(([id, done]) =>
          id.startsWith(scheduleCompletionPrefix) && typeof done === "boolean"
        ));
      } catch (error) {
        message.textContent = "Не удалось прочитать отметки выполненных дел.";
        return {};
      }
    }

    let userTasks = readTasks();
    let completedScheduleItems = readScheduleCompletions();
    function normalizePlanning(value) {
      try {
        const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
        if (!parsed || typeof parsed !== "object") return { goals: [], tasks: [], generatedAt: "" };
        const goals = Array.isArray(parsed.goals) ? parsed.goals.filter((goal) =>
          goal && typeof goal.id === "string" && typeof goal.title === "string" &&
          typeof goal.outcome === "string" && weeklyMinutesOptions.has(Number(goal.weeklyMinutes))
        ).slice(0, 3) : [];
        const goalIds = new Set(goals.map((goal) => goal.id));
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter((task) =>
          task && typeof task.id === "string" && goalIds.has(task.goalId) &&
          /^\d{4}-\d{2}-\d{2}$/.test(task.date) && typeof task.title === "string" &&
          Number.isFinite(Number(task.duration))
        ).map((task) => ({ ...task, done: Boolean(task.done) })) : [];
        return { goals, tasks, generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "" };
      } catch (error) {
        return { goals: [], tasks: [], generatedAt: "" };
      }
    }
    function readPlanning(key = planningStorageKey) {
      try {
        return normalizePlanning(localStorage.getItem(key));
      } catch (error) {
        return { goals: [], tasks: [], generatedAt: "" };
      }
    }
    let planning = readPlanning();
    let planningCloudReady = false;
    let planningLoading = false;
    let planningDirty = false;
    let stopPlanningListener = null;
    let planningSaveQueue = Promise.resolve();
    let plannerModel = null;
    let plannerModelLoading = null;
    let planGenerationRunning = false;

    const syncButton = document.getElementById("syncButton");
    const syncStatus = document.getElementById("syncStatus");
    const syncAccount = document.getElementById("syncAccount");
    const addButton = form.querySelector('button[type="submit"]');
    const firebaseConfig = window.SCHEDULE_FIREBASE_CONFIG || {};
    const firebaseConfigured = Boolean(
      firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REPLACE_") &&
      firebaseConfig.authDomain && !firebaseConfig.authDomain.includes("YOUR_PROJECT_ID") &&
      firebaseConfig.projectId && !firebaseConfig.projectId.includes("YOUR_PROJECT_ID") &&
      firebaseConfig.appId && !firebaseConfig.appId.startsWith("REPLACE_")
    );
    let firebaseApi = null;
    let firebaseAuth = null;
    let firebaseApp = null;
    let currentUser = null;
    let cloudReady = false;
    let syncLoading = false;
    let stopCloudListener = null;
    let syncGeneration = 0;

    function setSyncMessage(text, isError = false) {
      syncStatus.textContent = text;
      syncStatus.style.color = isError ? "#b42318" : "";
    }

    async function loadPlannerModel() {
      if (plannerModel) return plannerModel;
      if (plannerModelLoading) return plannerModelLoading;
      plannerModelLoading = (async () => {
        goalStatus.classList.remove("error");
        goalStatus.textContent = "Загружаю локальный планировщик Qwen…";
        const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
        const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        const largeDesktop = !mobile && Boolean(navigator.gpu) && Number(navigator.deviceMemory || 0) >= 8;
        const device = navigator.gpu ? "webgpu" : "wasm";
        const modelId = largeDesktop ? "onnx-community/Qwen3-1.7B-ONNX" : "onnx-community/Qwen3-0.6B-ONNX";
        const dtype = device === "webgpu" ? "q4f16" : "q4";
        goalStatus.textContent = largeDesktop
          ? "Загружаю Qwen 1.7B (около 1,43 ГБ). Не закрывай страницу."
          : (device === "webgpu"
            ? "Загружаю компактную Qwen (около 570 МБ). Не закрывай страницу."
            : "WebGPU недоступен: загружаю Qwen 0.6B для CPU (около 919 МБ). Генерация может быть медленной.");
        plannerModel = await pipeline("text-generation", modelId, {
          device,
          dtype,
          progress_callback: (progress) => {
            if (progress?.status === "progress" && Number.isFinite(progress.progress)) {
              const file = String(progress.file || "модель").split("/").pop();
              goalStatus.textContent = `Загружаю ${file}: ${Math.round(progress.progress)}%. Не закрывай страницу…`;
            }
          },
        });
        return plannerModel;
      })().catch((error) => {
        plannerModel = null;
        throw error;
      }).finally(() => {
        plannerModelLoading = null;
      });
      return plannerModelLoading;
    }

    function updateSyncControls() {
      syncButton.textContent = !firebaseConfigured
        ? "Синхронизация не настроена"
        : (currentUser ? "Выйти" : "Подключить Google");
      syncButton.disabled = !firebaseConfigured || syncLoading;
      addButton.disabled = syncLoading;
      syncAccount.hidden = !currentUser;
      syncAccount.textContent = currentUser ? (currentUser.email || "Вход через Google") : "";
      updateGoalControls();
    }

    function updateGoalControls() {
      const waitingForCloud = Boolean(currentUser) && planningLoading;
      for (const control of goalForm.elements) control.disabled = waitingForCloud || planGenerationRunning;
      generatePlanButton.disabled = waitingForCloud || planGenerationRunning || planning.goals.length === 0;
    }

    function planningDocument(userId) {
      return firebaseApi.doc(firebaseApi.db, "users", userId, "planning", monthKey);
    }

    function storePlanningLocally() {
      try {
        localStorage.setItem(planningStorageKey, JSON.stringify(planning));
        return true;
      } catch (error) {
        goalStatus.textContent = "Не удалось сохранить цели в браузере. Проверь настройки хранилища.";
        goalStatus.classList.add("error");
        return false;
      }
    }

    function persistPlanning() {
      if (!storePlanningLocally()) return;
      planningDirty = true;
      if (!currentUser || !planningCloudReady) return;
      const userId = currentUser.uid;
      const serialized = JSON.stringify(planning);
      planningSaveQueue = planningSaveQueue.catch(() => {}).then(() =>
        firebaseApi.setDoc(planningDocument(userId), {
          ...JSON.parse(serialized),
          updatedAt: firebaseApi.serverTimestamp(),
        })
      ).then(() => {
        if (currentUser?.uid === userId && JSON.stringify(planning) === serialized) {
          planningDirty = false;
          goalStatus.textContent = "Цели и план сохранены и синхронизированы.";
          goalStatus.classList.remove("error");
        }
      }).catch((error) => {
        goalStatus.textContent = "Сохранено на устройстве, но синхронизация не удалась. Проверь правила Firestore и интернет.";
        goalStatus.classList.add("error");
        console.error("Firestore planning update error:", error);
      });
    }

    function mergePlanning(localPlan, remotePlan) {
      const goals = [...remotePlan.goals];
      for (const goal of localPlan.goals) {
        if (goals.length >= 3) break;
        if (!goals.some((candidate) => candidate.id === goal.id)) goals.push(goal);
      }
      const goalIds = new Set(goals.map((goal) => goal.id));
      const tasks = new Map(remotePlan.tasks.filter((task) => goalIds.has(task.goalId)).map((task) => [task.id, task]));
      for (const task of localPlan.tasks) {
        if (goalIds.has(task.goalId) && !tasks.has(task.id)) tasks.set(task.id, task);
      }
      return { goals, tasks: [...tasks.values()], generatedAt: remotePlan.generatedAt || localPlan.generatedAt };
    }

    async function connectMonthlyPlanning(user, generation) {
      planningLoading = true;
      updateGoalControls();
      const accountKey = localPlanningKey + "-user-" + user.uid;
      const hasAccountCache = localStorage.getItem(accountKey) !== null;
      const migrationKeyForUser = localPlanningKey + "-cloud-migrated-" + user.uid;
      const migrationDone = localStorage.getItem(migrationKeyForUser) === "yes";
      const anonymousPlan = readPlanning(localPlanningKey);
      planningStorageKey = accountKey;
      planning = hasAccountCache
        ? readPlanning(accountKey)
        : (migrationDone ? { goals: [], tasks: [], generatedAt: "" } : anonymousPlan);
      planningDirty = false;
      storePlanningLocally();
      renderPlanning();
      render();
      goalStatus.textContent = "Загружаю цели и план из общего хранилища…";
      try {
        const reference = planningDocument(user.uid);
        const snapshot = await firebaseApi.getDoc(reference);
        if (generation !== syncGeneration) return;
        if (snapshot.exists()) {
          const remote = normalizePlanning(snapshot.data());
          planning = (!hasAccountCache && !migrationDone)
            ? mergePlanning(anonymousPlan, remote)
            : remote;
          storePlanningLocally();
          if (!hasAccountCache && !migrationDone && anonymousPlan.goals.length) planningDirty = true;
        } else if (planning.goals.length || planning.tasks.length) {
          planningDirty = true;
        }
        if (!migrationDone) localStorage.setItem(migrationKeyForUser, "yes");
        planningCloudReady = true;
        planningLoading = false;
        updateGoalControls();
        renderPlanning();
        render();
        if (planningDirty) persistPlanning();
        else goalStatus.textContent = planning.goals.length
          ? "Цели и план загружены из общего хранилища."
          : "Добавь цели на месяц и составь первый план.";
        if (stopPlanningListener) stopPlanningListener();
        stopPlanningListener = firebaseApi.onSnapshot(reference, (remoteSnapshot) => {
          if (generation !== syncGeneration) return;
          if (!remoteSnapshot.exists()) {
            if (planningDirty) persistPlanning();
            return;
          }
          if (planningDirty) {
            persistPlanning();
            return;
          }
          planning = normalizePlanning(remoteSnapshot.data());
          storePlanningLocally();
          renderPlanning();
          render();
        }, (error) => {
          goalStatus.textContent = "Не удалось обновить план из Firestore. Локальная копия доступна.";
          goalStatus.classList.add("error");
          console.error("Firestore planning listener error:", error);
        });
      } catch (error) {
        if (generation !== syncGeneration) return;
        planningCloudReady = false;
        planningLoading = false;
        updateGoalControls();
        goalStatus.textContent = "Не удалось подключить облачный план. Цели пока остаются на этом устройстве.";
        goalStatus.classList.add("error");
        console.error("Firestore planning initialization error:", error);
      }
    }

    function validTask(task) {
      return task && typeof task.id === "string" && typeof task.title === "string" &&
        typeof task.duration === "number" && task.duration >= 5 && task.duration <= 480;
    }

    function taskCollection(userId) {
      return firebaseApi.collection(
        firebaseApi.db, "users", userId, "days", dateKey, "tasks"
      );
    }

    function cloudTaskData(task, includeCreatedAt = false) {
      const data = {
        title: task.title.slice(0, 100),
        duration: Math.round(task.duration),
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(task.time || "") ? task.time : "",
        done: Boolean(task.done),
      };
      if (includeCreatedAt) data.createdAt = firebaseApi.serverTimestamp();
      return data;
    }

    function scheduleCompletionData(done) {
      return {
        title: "Отметка расписания",
        duration: 5,
        time: "",
        done: Boolean(done),
        createdAt: firebaseApi.serverTimestamp(),
      };
    }

    function scheduleCompletionId(item) {
      const key = [item.start, item.end, item.title].join("|");
      return scheduleCompletionPrefix + encodeURIComponent(key);
    }

    async function connectFirebase() {
      if (!firebaseConfigured) {
        syncButton.disabled = true;
        syncButton.textContent = "Синхронизация не настроена";
        setSyncMessage("Сначала добавь параметры Firebase в firebase-config.js. Пока дела сохраняются в этом браузере.");
        return;
      }

      try {
        const [appModule, authModule, storeModule] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js"),
          import("https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js"),
        ]);
        firebaseApp = appModule.initializeApp(firebaseConfig);
        firebaseAuth = authModule.getAuth(firebaseApp);
        firebaseApi = {
          ...storeModule,
          db: storeModule.getFirestore(firebaseApp),
          auth: authModule,
        };
        await authModule.setPersistence(firebaseAuth, authModule.browserLocalPersistence);

        authModule.onAuthStateChanged(firebaseAuth, async (user) => {
          const generation = ++syncGeneration;
          currentUser = user;
          cloudReady = false;
          syncLoading = Boolean(user);
          if (stopCloudListener) stopCloudListener();
          if (stopPlanningListener) stopPlanningListener();
          stopCloudListener = null;
          stopPlanningListener = null;
          planningCloudReady = false;
          planningLoading = Boolean(user);
          updateSyncControls();

          if (!user) {
            storageKey = localStorageKey;
            userTasks = readTasks(localStorageKey);
            completionStorageKey = localCompletionStorageKey;
            completedScheduleItems = readScheduleCompletions(localCompletionStorageKey);
            planningStorageKey = localPlanningKey;
            planning = readPlanning(localPlanningKey);
            planningDirty = false;
            planningLoading = false;
            renderPlanning();
            updateGoalControls();
            render();
            setSyncMessage("Пока дела доступны только в этом браузере. Войди в тот же Google-аккаунт на втором устройстве.");
            return;
          }

          setSyncMessage("Подключаю общий список дел…");
          const accountStorageKey = localStorageKey + "-user-" + user.uid;
          const accountCompletionStorageKey = accountStorageKey + "-schedule-completions";
          const hasAccountCache = localStorage.getItem(accountStorageKey) !== null;
          const hasAccountCompletionCache = localStorage.getItem(accountCompletionStorageKey) !== null;
          const migrationDone = localStorage.getItem(migrationKey) === "yes";
          const localTasks = hasAccountCache
            ? readTasks(accountStorageKey)
            : (migrationDone ? [] : readTasks(localStorageKey));
          storageKey = accountStorageKey;
          userTasks = localTasks;
          completionStorageKey = accountCompletionStorageKey;
          completedScheduleItems = readScheduleCompletions(
            hasAccountCompletionCache ? accountCompletionStorageKey : localCompletionStorageKey
          );
          saveTasks();
          saveScheduleCompletions();
          render();
          void connectMonthlyPlanning(user, generation);

          try {
            const collectionRef = taskCollection(user.uid);
            const firstSnapshot = await firebaseApi.getDocs(collectionRef);
            if (generation !== syncGeneration) return;
            const remoteIds = new Set(firstSnapshot.docs.map((item) => item.id));
            for (const task of localTasks.filter(validTask)) {
              if (!remoteIds.has(task.id)) {
                await firebaseApi.setDoc(
                  firebaseApi.doc(collectionRef, task.id), cloudTaskData(task, true)
                );
              }
            }
            for (const [completionId, done] of Object.entries(completedScheduleItems)) {
              if (!remoteIds.has(completionId)) {
                await firebaseApi.setDoc(
                  firebaseApi.doc(collectionRef, completionId), scheduleCompletionData(done)
                );
              }
            }
            if (!migrationDone) localStorage.setItem(migrationKey, "yes");

            stopCloudListener = firebaseApi.onSnapshot(collectionRef, (snapshot) => {
              if (generation !== syncGeneration) return;
              completedScheduleItems = Object.fromEntries(snapshot.docs
                .filter((item) => item.id.startsWith(scheduleCompletionPrefix))
                .map((item) => [item.id, Boolean(item.data().done)]));
              saveScheduleCompletions();
              userTasks = snapshot.docs.filter((item) =>
                !item.id.startsWith(scheduleCompletionPrefix)
              ).map((item) => ({ id: item.id, ...item.data() }))
                .filter(validTask)
                .sort((a, b) => {
                  const aTime = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
                  const bTime = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
                  return aTime - bTime;
                });
              cloudReady = true;
              syncLoading = false;
              saveTasks();
              updateSyncControls();
              setSyncMessage("Синхронизация включена · дела обновляются на всех устройствах.");
              render();
            }, (error) => {
              if (generation !== syncGeneration) return;
              cloudReady = false;
              syncLoading = false;
              updateSyncControls();
              setSyncMessage("Не удалось прочитать общий список. Проверь правила Firestore и интернет.", true);
              console.error("Firestore listener error:", error);
            });
          } catch (error) {
            if (generation !== syncGeneration) return;
            syncLoading = false;
            updateSyncControls();
            setSyncMessage("Не удалось подключить Firestore. Проверь настройки Firebase и правила доступа.", true);
            console.error("Firestore initialization error:", error);
          }
        });

        syncButton.addEventListener("click", async () => {
          try {
            if (currentUser) {
              await authModule.signOut(firebaseAuth);
            } else {
              await authModule.signInWithPopup(firebaseAuth, new authModule.GoogleAuthProvider());
            }
          } catch (error) {
            const messages = {
              "auth/popup-blocked": "Safari заблокировал окно Google. Разреши всплывающие окна или открой сайт в обычном Safari.",
              "auth/popup-closed-by-user": "Окно Google закрылось до завершения входа. Нажми «Подключить Google» и закончи вход.",
              "auth/cancelled-popup-request": "Запрос входа был прерван другим окном. Подожди немного и попробуй ещё раз.",
              "auth/unauthorized-domain": "Firebase не разрешает этот адрес сайта. В Firebase → Authentication → Settings → Authorized domains добавь haveffee.github.io.",
              "auth/operation-not-allowed": "В Firebase выключен вход через Google. В Authentication → Sign-in method включи провайдер Google.",
              "auth/network-request-failed": "Не удалось связаться с Google. Проверь интернет, VPN и блокировщики контента.",
              "auth/web-storage-unsupported": "Safari не разрешил хранилище для входа. Попробуй обычную вкладку Safari, не приватный режим.",
              "auth/operation-not-supported-in-this-environment": "Этот способ входа не поддерживается текущим окном. Открой сайт непосредственно в Safari.",
              "auth/invalid-api-key": "Firebase отклонил ключ приложения. Проверь конфигурацию Firebase сайта.",
            };
            const text = messages[error.code]
              ? `${messages[error.code]} (код: ${error.code})`
              : `Вход через Google не выполнен (${error.code || "неизвестный код"}). Открой сайт в Safari и пришли этот код.`;
            setSyncMessage(text, true);
            console.error("Firebase authentication error:", error);
          }
        });
      } catch (error) {
        syncButton.disabled = true;
        setSyncMessage("Не удалось загрузить Firebase. Проверь подключение к интернету.", true);
        console.error("Firebase SDK loading error:", error);
      }
    }

    function saveTasks() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(userTasks));
        return true;
      } catch (error) {
        message.textContent = "Браузер не разрешил сохранить дела. Проверь настройки приватности.";
        return false;
      }
    }

    function saveScheduleCompletions() {
      try {
        localStorage.setItem(completionStorageKey, JSON.stringify(completedScheduleItems));
        return true;
      } catch (error) {
        message.textContent = "Браузер не разрешил сохранить отметки выполненных дел.";
        return false;
      }
    }

    function goalResourceUrl(goal, task) {
      const query = `${goal.title} ${task.title} обучение урок`;
      return "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
    }

    function renderPlanning() {
      goalList.replaceChildren();
      generatePlanButton.disabled = Boolean(currentUser && planningLoading) ||
        planGenerationRunning || planning.goals.length === 0;
      if (planning.goals.length === 0) {
        const empty = document.createElement("li");
        empty.className = "goal-empty";
        empty.textContent = "Добавь конкретную цель и результат, которого хочешь достичь к концу месяца.";
        goalList.append(empty);
      } else {
        for (const goal of planning.goals) {
          const row = document.createElement("li");
          row.className = "goal-row";
          const copy = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = goal.title;
          const outcome = document.createElement("span");
          outcome.textContent = `${goal.outcome} · ${goal.weeklyMinutes} мин/неделю`;
          copy.append(title, outcome);
          const remove = document.createElement("button");
          remove.className = "goal-remove";
          remove.type = "button";
          remove.textContent = "Удалить";
          remove.addEventListener("click", () => {
            planning.goals = planning.goals.filter((item) => item.id !== goal.id);
            planning.tasks = planning.tasks.filter((task) => task.goalId !== goal.id);
            planning.generatedAt = "";
            persistPlanning();
            renderPlanning();
            render();
          });
          row.append(copy, remove);
          goalList.append(row);
        }
      }

      goalRoadmap.replaceChildren();
      if (planning.tasks.length === 0) {
        const empty = document.createElement("p");
        empty.className = "goal-empty";
        empty.textContent = planning.goals.length
          ? "Пока нет плана. Нажми «Составить план на месяц»."
          : "План появится здесь после добавления цели.";
        goalRoadmap.append(empty);
        updateGoalControls();
        return;
      }

      const goalsById = new Map(planning.goals.map((goal) => [goal.id, goal]));
      const groups = new Map();
      for (const task of planning.tasks.slice().sort((a, b) =>
        a.date.localeCompare(b.date) || String(a.time || "00:00").localeCompare(String(b.time || "00:00")))) {
        if (!goalsById.has(task.goalId)) continue;
        if (!groups.has(task.week)) groups.set(task.week, []);
        groups.get(task.week).push(task);
      }
      const completed = planning.tasks.filter((task) => task.done).length;
      const summary = document.createElement("p");
      summary.className = "goal-empty";
      summary.textContent = `${completed} из ${planning.tasks.length} шагов выполнено${planning.generatedAt ? ` · план создан ${planning.generatedAt}` : ""}.`;
      goalRoadmap.append(summary);
      for (const [week, tasks] of [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const weekCard = document.createElement("section");
        weekCard.className = "goal-week";
        const heading = document.createElement("h3");
        const firstTask = tasks[0];
        const range = firstTask?.weekStart && firstTask?.weekEnd
          ? { from: firstTask.weekStart, to: firstTask.weekEnd }
          : planWeeksRemaining().find((item) => item.number === Number(week));
        const rangeLabel = range
          ? `${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" }).format(new Date(`${range.from}T00:00:00Z`))}–${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" }).format(new Date(`${range.to}T00:00:00Z`))}`
          : "";
        heading.textContent = `Неделя ${week}${rangeLabel ? ` · ${rangeLabel}` : ""}`;
        weekCard.append(heading);
        for (const task of tasks) {
          const goal = goalsById.get(task.goalId);
          const row = document.createElement("div");
          row.className = "goal-plan-task";
          row.dataset.done = String(Boolean(task.done));
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = Boolean(task.done);
          checkbox.setAttribute("aria-label", `${task.done ? "Снять отметку" : "Отметить выполненным"}: ${task.title}`);
          checkbox.addEventListener("change", () => toggleGoalTask(task.id, checkbox.checked));
          const copy = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = task.title;
          const description = document.createElement("p");
          description.textContent = `${goal.title} · ${task.description}`;
          copy.append(title, description);
          const resource = document.createElement("a");
          resource.className = "goal-resource";
          resource.href = goalResourceUrl(goal, task);
          resource.target = "_blank";
          resource.rel = "noopener noreferrer";
          resource.textContent = "Найти видеоурок ↗";
          copy.append(resource);
          const meta = document.createElement("span");
          meta.className = "goal-task-meta";
          meta.textContent = `${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" }).format(new Date(`${task.date}T00:00:00Z`))} · ${task.time} · ${task.duration} мин`;
          row.append(checkbox, copy, meta);
          weekCard.append(row);
        }
        goalRoadmap.append(weekCard);
      }
      updateGoalControls();
    }

    function toggleGoalTask(taskId, done) {
      const task = planning.tasks.find((item) => item.id === taskId);
      if (!task) return;
      task.done = Boolean(done);
      persistPlanning();
      renderPlanning();
      render();
    }

    function utcDateKey(date) {
      return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")].join("-");
    }

    function planWeeksRemaining() {
      const [year, month, day] = dateKey.split("-").map(Number);
      const first = new Date(Date.UTC(year, month - 1, 1));
      const today = new Date(Date.UTC(year, month - 1, day));
      const last = new Date(Date.UTC(year, month, 0));
      let cursor = today > first ? today : first;
      const weeks = [];
      while (cursor <= last) {
        const monday = new Date(cursor);
        const weekday = monday.getUTCDay() || 7;
        monday.setUTCDate(monday.getUTCDate() - weekday + 1);
        const sunday = new Date(monday);
        sunday.setUTCDate(sunday.getUTCDate() + 6);
        const end = sunday < last ? sunday : last;
        const start = cursor > monday ? cursor : monday;
        const dates = [];
        const candidateWeekdays = [2, 5, 0, 3, 6, 1, 4];
        for (const preferredDay of candidateWeekdays) {
          const candidate = new Date(start);
          const offset = (preferredDay - candidate.getUTCDay() + 7) % 7;
          candidate.setUTCDate(candidate.getUTCDate() + offset);
          if (candidate <= end && candidate >= today && !dates.includes(utcDateKey(candidate))) {
            dates.push(utcDateKey(candidate));
          }
        }
        weeks.push({
          number: weeks.length + 1,
          from: utcDateKey(start),
          to: utcDateKey(end),
          dates,
        });
        cursor = new Date(end);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return weeks;
    }

    function preferredGoalTime(date, sessionIndex) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) return sessionIndex === 0 ? "14:00" : "15:00";
      if (day === 1 || day === 3) return "20:45";
      if (day === 2) return "20:45";
      if (day === 4) return "21:45";
      return sessionIndex === 0 ? "19:00" : "20:00";
    }

    function generatedText(result) {
      const generated = result?.[0]?.generated_text;
      const lastMessage = Array.isArray(generated) ? generated[generated.length - 1] : null;
      let output = (typeof generated === "string" ? generated : lastMessage?.content || "").trim();
      if (output.includes("</think>")) output = output.split("</think>").at(-1).trim();
      return output.replace(/^<think>[\s\S]*?<\/think>\s*/i, "").trim();
    }

    function parseGoalSteps(text, weeks) {
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) return new Map();
        const parsed = JSON.parse(text.slice(start, end + 1));
        const map = new Map();
        for (const week of Array.isArray(parsed.weeks) ? parsed.weeks : []) {
          const number = Number(week.week);
          const sessions = Array.isArray(week.sessions) ? week.sessions : [];
          map.set(number, sessions.slice(0, 2).map((session) => ({
            title: String(session.title || "").trim().slice(0, 100),
            description: String(session.description || "").trim().slice(0, 220),
          })).filter((session) => session.title && session.description));
        }
        for (const week of weeks) if (!map.has(week.number)) map.set(week.number, []);
        return map;
      } catch (error) {
        return new Map();
      }
    }

    function fallbackGoalStep(goal, weekNumber, sessionIndex) {
      const stages = [
        ["Разобраться в основах", "Посмотри вводный материал, выпиши три ключевые идеи и выбери один навык для практики."],
        ["Потренировать один навык", "Повтори прием из урока на небольшом примере и сохрани результат."],
        ["Сделать мини-проект", "Примени изученное к части результата, который хочешь получить к концу месяца."],
        ["Проверить и улучшить", "Сравни результат с целью, исправь одну слабую часть и запиши следующий шаг."],
      ];
      const stage = stages[(weekNumber - 1 + sessionIndex) % stages.length];
      return { title: `${stage[0]}: ${goal.title}`, description: stage[1] };
    }

    async function createMonthPlan() {
      if (!planning.goals.length || planGenerationRunning) return;
      const weeks = planWeeksRemaining();
      if (!weeks.some((week) => week.dates.length)) {
        goalStatus.textContent = "В этом месяце больше не осталось дней для планирования.";
        return;
      }
      planGenerationRunning = true;
      generatePlanButton.textContent = "Составляю план…";
      updateGoalControls();
      const previousDone = new Map(planning.tasks.map((task) => [task.id, Boolean(task.done)]));
      const planned = [];
      let usedFallback = false;
      try {
        const model = await loadPlannerModel();
        for (let goalIndex = 0; goalIndex < planning.goals.length; goalIndex += 1) {
          const goal = planning.goals[goalIndex];
          goalStatus.textContent = `Продумываю шаги для цели ${goalIndex + 1} из ${planning.goals.length}…`;
          const monthSchedule = weeks.map((week) => ({
            week: week.number,
            dates: week.dates,
            minutesPerSession: Math.round(Number(goal.weeklyMinutes) / 2 / 5) * 5,
          }));
          const prompt = `На русском спланируй цель на оставшуюся часть месяца. Цель: ${goal.title}. Итог месяца: ${goal.outcome}. Для каждой недели верни ровно два последовательных занятия; каждое занятие должно занимать ${Math.round(Number(goal.weeklyMinutes) / 2 / 5) * 5} минут. Упражнения должны быть конкретными, разные занятия продолжать друг друга и вести к указанному итогу. В ответе дай только JSON: корневой объект, поле weeks — массив; внутри каждой записи поле week с номером недели и поле sessions — массив из двух объектов с короткими полями title и description. Недели, которые нужно заполнить: ${JSON.stringify(monthSchedule)}. Не добавляй разметку, пояснения или Markdown. /no_think`;
          let stepsByWeek = new Map();
          try {
            const result = await model([
              { role: "system", content: "Ты — практичный планировщик навыков. Предлагай небольшие измеримые действия, от простого к сложному. Не утверждай, что искал материалы в интернете. Выдавай только валидный JSON по формату пользователя." },
              { role: "user", content: prompt },
            ], { max_new_tokens: 520, do_sample: false });
            stepsByWeek = parseGoalSteps(generatedText(result), weeks);
          } catch (error) {
            console.error("Qwen goal planning error:", error);
          }
          for (const week of weeks) {
            if (!week.dates.length) continue;
            const sessions = stepsByWeek.get(week.number) || [];
            for (let sessionIndex = 0; sessionIndex < 2; sessionIndex += 1) {
              const fallback = fallbackGoalStep(goal, week.number, sessionIndex);
              const content = sessions[sessionIndex] || fallback;
              if (!sessions[sessionIndex]) usedFallback = true;
              const dateIndex = (goalIndex * 2 + sessionIndex) % week.dates.length;
              const date = week.dates[dateIndex];
              const id = `goal-${goal.id}-w${week.number}-s${sessionIndex + 1}`;
              planned.push({
                id,
                goalId: goal.id,
                week: week.number,
                weekStart: week.from,
                weekEnd: week.to,
                date,
                time: preferredGoalTime(date, sessionIndex),
                duration: Math.round(Number(goal.weeklyMinutes) / 2 / 5) * 5,
                title: content.title,
                description: content.description,
                done: previousDone.get(id) || false,
              });
            }
          }
        }
        planning.tasks = planned;
        planning.generatedAt = new Intl.DateTimeFormat("ru-RU", {
          day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
        }).format(new Date());
        persistPlanning();
        renderPlanning();
        render();
        goalStatus.classList.remove("error");
        goalStatus.textContent = usedFallback
          ? "План готов. Для части шагов Qwen вернула неполный формат, поэтому добавлены практичные базовые задания."
          : "План готов и распределён по оставшимся неделям месяца.";
      } catch (error) {
        const fallbackPlan = [];
        for (let goalIndex = 0; goalIndex < planning.goals.length; goalIndex += 1) {
          const goal = planning.goals[goalIndex];
          for (const week of weeks) {
            if (!week.dates.length) continue;
            for (let sessionIndex = 0; sessionIndex < 2; sessionIndex += 1) {
              const content = fallbackGoalStep(goal, week.number, sessionIndex);
              const date = week.dates[(goalIndex * 2 + sessionIndex) % week.dates.length];
              const id = `goal-${goal.id}-w${week.number}-s${sessionIndex + 1}`;
              fallbackPlan.push({ id, goalId: goal.id, week: week.number,
                weekStart: week.from, weekEnd: week.to, date,
                time: preferredGoalTime(date, sessionIndex),
                duration: Math.round(Number(goal.weeklyMinutes) / 2 / 5) * 5,
                title: content.title, description: content.description,
                done: previousDone.get(id) || false });
            }
          }
        }
        planning.tasks = fallbackPlan;
        planning.generatedAt = new Intl.DateTimeFormat("ru-RU", {
          day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
        }).format(new Date());
        persistPlanning();
        renderPlanning();
        render();
        goalStatus.textContent = "Qwen не запустилась, поэтому создан базовый поэтапный план. Проверь интернет и попробуй пересоставить его позже.";
        goalStatus.classList.add("error");
        console.error("Planner generation error:", error);
      } finally {
        planGenerationRunning = false;
        generatePlanButton.textContent = "Составить план на месяц";
        updateGoalControls();
      }
    }

    function toggleScheduleItem(item, done) {
      if (item.goalId) {
        toggleGoalTask(item.id, done);
        return;
      } else if (item.id) {
        const task = userTasks.find((candidate) => candidate.id === item.id);
        if (!task) return;
        task.done = Boolean(done);
        saveTasks();
        if (currentUser && cloudReady) {
          firebaseApi.updateDoc(
            firebaseApi.doc(taskCollection(currentUser.uid), task.id), { done: task.done }
          ).catch((error) => {
            setSyncMessage("Отметка сохранена на устройстве, но не отправлена в облако.", true);
            console.error("Firestore task completion error:", error);
          });
        }
      } else {
        const completionId = scheduleCompletionId(item);
        completedScheduleItems[completionId] = Boolean(done);
        saveScheduleCompletions();
        if (currentUser && cloudReady) {
          firebaseApi.setDoc(
            firebaseApi.doc(taskCollection(currentUser.uid), completionId),
            scheduleCompletionData(done)
          ).catch((error) => {
            setSyncMessage("Отметка сохранена на устройстве, но не отправлена в облако.", true);
            console.error("Firestore schedule completion error:", error);
          });
        }
      }
      render();
    }

    function timeLabel(value) {
      const hour = Math.floor(value / 60).toString().padStart(2, "0");
      const minute = (value % 60).toString().padStart(2, "0");
      return hour + ":" + minute;
    }

    function addCard(parent, item, start, end, extraClass) {
      const article = document.createElement("article");
      article.className = "task" + (extraClass ? " " + extraClass : "");
      article.dataset.start = String(start);
      article.dataset.end = String(end);
      if (item.done) article.dataset.done = "true";
      const time = document.createElement("time");
      time.className = "task-time";
      time.textContent = timeLabel(start) + "–" + timeLabel(end);
      const icon = document.createElement("div");
      icon.className = "task-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.icon;
      const checkbox = document.createElement("input");
      checkbox.className = "task-toggle";
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(item.done);
      checkbox.setAttribute("aria-label", (item.done ? "Снять отметку" : "Отметить выполненным") + ": " + item.title);
      checkbox.addEventListener("change", () => toggleScheduleItem(item, checkbox.checked));
      const copy = document.createElement("div");
      copy.className = "task-copy";
      const currentBadge = document.createElement("span");
      currentBadge.className = "current-badge";
      currentBadge.textContent = "Сейчас";
      currentBadge.hidden = true;
      const title = document.createElement("h3");
      title.textContent = item.title;
      const description = document.createElement("p");
      description.textContent = item.description;
      copy.append(currentBadge, title, description);
      if (item.guideUrl) {
        const resource = document.createElement("a");
        resource.className = "task-resource";
        resource.href = item.guideUrl;
        resource.target = "_blank";
        resource.rel = "noopener noreferrer";
        resource.textContent = "Найти видеоурок ↗";
        copy.append(resource);
      }
      article.append(time, icon, checkbox, copy);
      parent.append(article);
    }

    function moscowMinutesNow() {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const hour = Number(parts.find((part) => part.type === "hour").value);
      const minute = Number(parts.find((part) => part.type === "minute").value);
      return hour * 60 + minute;
    }

    function highlightCurrentTask() {
      const now = moscowMinutesNow();
      for (const card of timeline.querySelectorAll(".task")) {
        const current = now >= Number(card.dataset.start) && now < Number(card.dataset.end) &&
          card.dataset.done !== "true";
        card.classList.toggle("task--current", current);
        card.setAttribute("aria-current", current ? "time" : "false");
        const badge = card.querySelector(".current-badge");
        if (badge) badge.hidden = !current;
      }
    }

    function findSlot(task, placed) {
      const preferred = task.time ? Number(task.time.slice(0, 2)) * 60 + Number(task.time.slice(3, 5)) : flexStart;
      let cursor = Math.max(flexStart, preferred);
      const blockers = baseEvents.concat(placed).slice().sort((a, b) => a.start - b.start);
      for (const blocker of blockers) {
        if (blocker.end <= cursor) continue;
        if (blocker.start >= dayEnd) break;
        if (cursor + task.duration <= blocker.start) {
          return cursor + task.duration <= dayEnd ? cursor : null;
        }
        if (cursor < blocker.end && cursor + task.duration > blocker.start) {
          cursor = blocker.end;
          if (cursor + task.duration > dayEnd) return null;
        }
      }
      return cursor + task.duration <= dayEnd ? cursor : null;
    }

    function renderUserTasks(assignments) {
      taskList.replaceChildren();
      if (userTasks.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-tasks";
        empty.textContent = "Пока нет дополнительных дел.";
        taskList.append(empty);
        return;
      }
      for (const task of userTasks) {
        const assignment = assignments.find((item) => item.id === task.id);
        const row = document.createElement("li");
        row.className = "my-task" + (task.done ? " done" : "");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(task.done);
        checkbox.setAttribute("aria-label", "Отметить выполненным: " + task.title);
        checkbox.addEventListener("change", () => {
          task.done = checkbox.checked;
          saveTasks();
          if (currentUser && cloudReady) {
            firebaseApi.updateDoc(
              firebaseApi.doc(taskCollection(currentUser.uid), task.id), { done: task.done }
            ).catch((error) => {
              setSyncMessage("Изменение сохранено на устройстве, но не удалось отправить его в облако.", true);
              console.error("Firestore update error:", error);
            });
          }
          render();
        });
        const copy = document.createElement("span");
        copy.className = "my-task-copy";
        const title = document.createElement("span");
        title.className = "my-task-title";
        title.textContent = task.title;
        const meta = document.createElement("span");
        meta.className = "my-task-meta";
        if (assignment) {
          meta.textContent = timeLabel(assignment.start) + " · " + task.duration + " мин";
        } else {
          meta.textContent = "Не поместилось в оставшееся время · " + task.duration + " мин";
        }
        copy.append(title, meta);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-task";
        remove.textContent = "Удалить";
        remove.setAttribute("aria-label", "Удалить дело: " + task.title);
        remove.addEventListener("click", () => {
          userTasks = userTasks.filter((item) => item.id !== task.id);
          saveTasks();
          if (currentUser && cloudReady) {
            firebaseApi.deleteDoc(firebaseApi.doc(taskCollection(currentUser.uid), task.id))
              .catch((error) => {
                setSyncMessage("Не удалось удалить дело из облака. Проверь подключение.", true);
                console.error("Firestore delete error:", error);
              });
          }
          message.textContent = "Дело удалено.";
          render();
        });
        row.append(checkbox, copy, remove);
        taskList.append(row);
      }
    }

    function render() {
      const placed = [];
      const waiting = [];
      for (const task of userTasks) {
        const start = findSlot(task, placed);
        if (start === null) {
          waiting.push(task);
        } else {
          placed.push({
            id: task.id,
            start,
            end: start + task.duration,
            icon: "✅",
            title: task.title,
            description: "Твое дополнительное дело · " + task.duration + " мин",
            category: "custom",
            done: Boolean(task.done),
          });
        }
      }
      const goalPlaced = [];
      const goalWaiting = [];
      const currentGoalTasks = planning.tasks.filter((task) => task.date === dateKey);
      for (const task of currentGoalTasks) {
        let preferred = Number(task.time.slice(0, 2)) * 60 + Number(task.time.slice(3, 5));
        if (task.date === dateKey) {
          const now = moscowMinutesNow();
          if (preferred < now) preferred = Math.ceil(now / 5) * 5;
        }
        const scheduledTask = { ...task, time: timeLabel(preferred) };
        const start = findSlot(scheduledTask, placed.concat(goalPlaced));
        if (start === null) {
          goalWaiting.push(task);
        } else {
          const goal = planning.goals.find((candidate) => candidate.id === task.goalId);
          goalPlaced.push({
            id: task.id,
            goalId: task.goalId,
            start,
            end: start + Number(task.duration),
            icon: "🎯",
            title: task.title,
            description: `${goal?.title || "Цель месяца"} · ${task.description}`,
            guideUrl: goal ? goalResourceUrl(goal, task) : "",
            category: "goal",
            done: Boolean(task.done),
          });
        }
      }
      const blocks = baseEvents.concat(placed, goalPlaced).slice().sort((a, b) => a.start - b.start);
      const items = [];
      let cursor = dayStart;
      for (const block of blocks) {
        if (block.start > cursor) {
          const personalTime = cursor >= flexStart;
          items.push({
            start: cursor,
            end: block.start,
            icon: personalTime ? "🎬" : "🌿",
            title: personalTime ? "Личная карьера" : "Свободное время",
            description: personalTime
              ? "Видеомонтаж, стримы или работа над трейд-ботом. Выбери один фокус."
              : "Отдых и личные дела.",
            category: personalTime ? "personal" : "fixed",
          });
        }
        items.push(block);
        cursor = Math.max(cursor, block.end);
      }
      if (cursor < dayEnd) {
        const personalTime = cursor >= flexStart;
        items.push({
          start: cursor,
          end: dayEnd,
          icon: personalTime ? "🎬" : "🌿",
          title: personalTime ? "Личная карьера" : "Свободное время",
          description: personalTime
            ? "Видеомонтаж, стримы или работа над трейд-ботом. Выбери один фокус."
            : "Отдых и личные дела.",
          category: personalTime ? "personal" : "fixed",
        });
      }
      timeline.replaceChildren();
      for (const item of items) {
        const cardItem = item.id
          ? item
          : { ...item, done: Boolean(completedScheduleItems[scheduleCompletionId(item)]) };
        const classes = [];
        if (cardItem.category === "personal") classes.push("task--personal");
        if (cardItem.category === "custom") classes.push("task--custom");
        if (cardItem.category === "habit") classes.push("task--habit");
        if (cardItem.category === "goal") classes.push("task--goal");
        if (cardItem.done) classes.push("task--done");
        addCard(timeline, cardItem, cardItem.start, cardItem.end, classes.join(" "));
      }
      highlightCurrentTask();
      renderUserTasks(placed);
      waitlist.replaceChildren();
      if (waiting.length || goalWaiting.length) {
        const heading = document.createElement("h3");
        heading.textContent = "Эти дела пока не поместились в расписание";
        const list = document.createElement("ul");
        for (const task of waiting) {
          const row = document.createElement("li");
          row.textContent = task.title + " — " + task.duration + " мин. Уменьши длительность или удали другое дело.";
          list.append(row);
        }
        for (const task of goalWaiting) {
          const row = document.createElement("li");
          row.textContent = `${task.title} — шаг месячной цели. В расписании на сегодня не осталось подходящего окна.`;
          list.append(row);
        }
        waitlist.append(heading, list);
        waitlist.hidden = false;
      } else {
        waitlist.hidden = true;
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const title = String(data.get("title") || "").trim();
      const duration = Number(data.get("duration"));
      const time = String(data.get("time") || "");
      if (!title || !Number.isFinite(duration) || duration < 5 || duration > 480) return;
      const task = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        title,
        duration,
        time,
        done: false,
      };
      userTasks.push(task);
      if (saveTasks()) {
        message.textContent = "Дело добавлено и расписание пересчитано.";
        if (currentUser && cloudReady) {
          firebaseApi.setDoc(
            firebaseApi.doc(taskCollection(currentUser.uid), task.id), cloudTaskData(task, true)
          ).catch((error) => {
            setSyncMessage("Дело сохранено на устройстве, но пока не отправлено в облако.", true);
            console.error("Firestore create error:", error);
          });
        }
        form.reset();
        form.elements.duration.value = "30";
        render();
      }
    });

    goalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (planning.goals.length >= 3) {
        goalStatus.textContent = "Можно добавить не больше трёх целей на месяц.";
        goalStatus.classList.add("error");
        return;
      }
      const data = new FormData(goalForm);
      const title = String(data.get("title") || "").trim();
      const outcome = String(data.get("outcome") || "").trim();
      const weeklyMinutes = Number(data.get("weeklyMinutes"));
      if (!title || !outcome || !weeklyMinutesOptions.has(weeklyMinutes)) return;
      const goal = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: title.slice(0, 90),
        outcome: outcome.slice(0, 160),
        weeklyMinutes,
      };
      planning.goals.push(goal);
      planning.generatedAt = "";
      persistPlanning();
      goalForm.reset();
      goalForm.elements.weeklyMinutes.value = "90";
      goalStatus.textContent = "Цель добавлена. Составь план, чтобы распределить шаги по месяцу.";
      goalStatus.classList.remove("error");
      renderPlanning();
    });

    generatePlanButton.addEventListener("click", () => { void createMonthPlan(); });

    renderPlanning();
    render();
    window.setInterval(highlightCurrentTask, 30_000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) highlightCurrentTask();
    });
    void connectFirebase();
  </script>
</body>
</html>
"""


def main() -> None:
    now = datetime.now(MOSCOW_TZ)
    day_index = now.weekday()
    weekday = WEEKDAYS[day_index]
    date_label = f"{now.day} {MONTHS[now.month - 1]} {now.year}"
    date_iso = now.date().isoformat()
    month_iso = now.strftime("%Y-%m")
    month_title = f"{MONTH_TITLES[now.month - 1].capitalize()} {now.year}"
    weekly_habit = habit_for_week(now.date())
    events, is_weekday, day_start, flex_start, day_end = build_schedule(day_index, weekly_habit)
    day_type = "Будний день" if is_weekday else "Выходной день"
    habit_title = escape(weekly_habit[1])
    focus_tip = escape(choice(FOCUS_TIPS))
    static_tasks = "\n".join(render_static_event(event) for event in events)
    events_json = json.dumps(events, ensure_ascii=False).replace("<", "\\u003c")

    # f-строка подставляет актуальную дату, день недели и список дел.
    page = f"{PAGE_TEMPLATE.replace('__DATE__', escape(date_label)).replace('__DATE_ISO__', date_iso).replace('__MONTH_ISO__', month_iso).replace('__MONTH_TITLE__', escape(month_title)).replace('__WEEKDAY__', escape(weekday.capitalize())).replace('__DAY_TYPE__', escape(day_type)).replace('__STATIC_TASKS__', static_tasks).replace('__EVENTS_JSON__', events_json).replace('__DAY_START__', str(day_start)).replace('__FLEX_START__', str(flex_start)).replace('__DAY_END__', str(day_end)).replace('__HABIT_TITLE__', habit_title).replace('__FOCUS_TIP__', focus_tip).replace('__UPDATED__', now.strftime('%H:%M'))}"

    output_path = Path(__file__).with_name("index.html")
    output_path.write_text(page, encoding="utf-8")
    print(f"Создан файл {output_path} для {weekday}, {date_label} (Москва, UTC+3).")


if __name__ == "__main__":
    main()
