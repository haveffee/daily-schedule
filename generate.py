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
    .task {
      display: grid; grid-template-columns: 112px 38px minmax(0,1fr); align-items: start;
      gap: 13px; padding: 17px 26px; border-top: 1px solid var(--line);
    }
    .task-time { padding-top: 2px; color: var(--blue); font-size: 14px; font-weight: 700; line-height: 1.45; white-space: nowrap; }
    .task-icon { font-size: 22px; line-height: 1.1; }
    .task-copy h3 { margin: 0; font-size: 15px; font-weight: 680; letter-spacing: -.015em; }
    .task-copy p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .task--personal .task-time { color: var(--green); }
    .task--custom .task-time { color: #8a4baf; }
    .task--habit { background: linear-gradient(90deg, rgba(0,113,227,.035), transparent 75%); }
    .task--habit .task-time { color: #7752a8; }
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
      .schedule { border-radius: 22px; }
      .schedule-heading { padding: 20px 17px 14px; }
      .task { grid-template-columns: 78px 27px minmax(0,1fr); gap: 8px; padding: 15px 13px; }
      .task-time { font-size: 11px; }
      .task-icon { font-size: 19px; }
      .task-copy h3 { font-size: 14px; }
      .task-copy p { font-size: 12px; }
      .focus { padding: 20px; border-radius: 20px; }
    }
    @media (max-width: 360px) {
      .task { grid-template-columns: 69px 23px minmax(0,1fr); gap: 6px; padding-right: 10px; padding-left: 10px; }
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
      <p class="storage-note">Без времени дело поставится в ближайшее свободное окно. Если окно занято — поиск продолжится позже. Дела и отметки хранятся в этом браузере на этом устройстве и не синхронизируются между устройствами.</p>
      <p class="message" id="message" aria-live="polite"></p>
      <ul class="my-tasks" id="myTasks"></ul>
    </section>
    <section class="schedule" aria-labelledby="schedule-title">
      <div class="schedule-heading">
        <h2 id="schedule-title">Расписание дня</h2>
        <span>Время с точностью до минуты</span>
      </div>
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
  <script>
    "use strict";
    const baseEvents = __EVENTS_JSON__;
    const dateKey = "__DATE_ISO__";
    const dayStart = __DAY_START__;
    const flexStart = __FLEX_START__;
    const dayEnd = __DAY_END__;
    const storageKey = "daily-schedule-" + dateKey;
    const timeline = document.getElementById("timeline");
    const taskList = document.getElementById("myTasks");
    const message = document.getElementById("message");
    const waitlist = document.getElementById("waitlist");
    const form = document.getElementById("taskForm");

    function readTasks() {
      try {
        const saved = localStorage.getItem(storageKey);
        const parsed = saved ? JSON.parse(saved) : [];
        return Array.isArray(parsed) ? parsed.filter((task) =>
          task && typeof task.id === "string" && typeof task.title === "string"
        ) : [];
      } catch (error) {
        message.textContent = "Не удалось прочитать сохраненные дела в этом браузере.";
        return [];
      }
    }

    let userTasks = readTasks();

    function saveTasks() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(userTasks));
        return true;
      } catch (error) {
        message.textContent = "Браузер не разрешил сохранить дела. Проверь настройки приватности.";
        return false;
      }
    }

    function timeLabel(value) {
      const hour = Math.floor(value / 60).toString().padStart(2, "0");
      const minute = (value % 60).toString().padStart(2, "0");
      return hour + ":" + minute;
    }

    function addCard(parent, item, start, end, extraClass) {
      const article = document.createElement("article");
      article.className = "task" + (extraClass ? " " + extraClass : "");
      const time = document.createElement("time");
      time.className = "task-time";
      time.textContent = timeLabel(start) + "–" + timeLabel(end);
      const icon = document.createElement("div");
      icon.className = "task-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.icon;
      const copy = document.createElement("div");
      copy.className = "task-copy";
      const title = document.createElement("h3");
      title.textContent = item.title;
      const description = document.createElement("p");
      description.textContent = item.description;
      copy.append(title, description);
      article.append(time, icon, copy);
      parent.append(article);
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
      const blocks = baseEvents.concat(placed).slice().sort((a, b) => a.start - b.start);
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
        const classes = [];
        if (item.category === "personal") classes.push("task--personal");
        if (item.category === "custom") classes.push("task--custom");
        if (item.category === "habit") classes.push("task--habit");
        if (item.done) classes.push("task--done");
        addCard(timeline, item, item.start, item.end, classes.join(" "));
      }
      renderUserTasks(placed);
      waitlist.replaceChildren();
      if (waiting.length) {
        const heading = document.createElement("h3");
        heading.textContent = "Эти дела пока не поместились в расписание";
        const list = document.createElement("ul");
        for (const task of waiting) {
          const row = document.createElement("li");
          row.textContent = task.title + " — " + task.duration + " мин. Уменьши длительность или удали другое дело.";
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
      userTasks.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        title,
        duration,
        time,
        done: false,
      });
      if (saveTasks()) {
        message.textContent = "Дело добавлено и расписание пересчитано.";
        form.reset();
        form.elements.duration.value = "30";
        render();
      }
    });

    render();
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
    weekly_habit = habit_for_week(now.date())
    events, is_weekday, day_start, flex_start, day_end = build_schedule(day_index, weekly_habit)
    day_type = "Будний день" if is_weekday else "Выходной день"
    habit_title = escape(weekly_habit[1])
    focus_tip = escape(choice(FOCUS_TIPS))
    static_tasks = "\n".join(render_static_event(event) for event in events)
    events_json = json.dumps(events, ensure_ascii=False).replace("<", "\\u003c")

    # f-строка подставляет актуальную дату, день недели и список дел.
    page = f"{PAGE_TEMPLATE.replace('__DATE__', escape(date_label)).replace('__DATE_ISO__', date_iso).replace('__WEEKDAY__', escape(weekday.capitalize())).replace('__DAY_TYPE__', escape(day_type)).replace('__STATIC_TASKS__', static_tasks).replace('__EVENTS_JSON__', events_json).replace('__DAY_START__', str(day_start)).replace('__FLEX_START__', str(flex_start)).replace('__DAY_END__', str(day_end)).replace('__HABIT_TITLE__', habit_title).replace('__FOCUS_TIP__', focus_tip).replace('__UPDATED__', now.strftime('%H:%M'))}"

    output_path = Path(__file__).with_name("index.html")
    output_path.write_text(page, encoding="utf-8")
    print(f"Создан файл {output_path} для {weekday}, {date_label} (Москва, UTC+3).")


if __name__ == "__main__":
    main()
