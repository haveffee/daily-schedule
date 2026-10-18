# daily-schedule

Персональное расписание публикуется на GitHub Pages. `generate.py` создаёт `index.html`, а GitHub Actions обновляет страницу каждый день.

## ИИ-помощник

Помощник использует Firebase AI Logic с Gemini Developer API. Он учитывает сегодняшнее расписание и дополнительные дела, но ничего не меняет без пользователя. Перед отправкой вопроса сайт показывает, что текст и названия сегодняшних задач будут переданы Google Gemini через Firebase.

Чтобы включить помощника:

1. В Firebase Console открой проект `daily-schedule-sync-fc374` и в разделе **AI Logic** нажми **Get started**. Выбери **Gemini Developer API** и бесплатный уровень без подключения Cloud Billing.
2. Для App Check создай в Google Cloud Console ключ reCAPTCHA Enterprise типа **Web** и укажи домен `haveffee.github.io` (без галочки challenge). Затем в Firebase Console → **App Check** зарегистрируй веб-приложение с этим ключом и включи защиту **Firebase AI Logic**.
3. Скопируй публичный site key из настроек reCAPTCHA и добавь его в поле `appCheckSiteKey` файла `firebase-config.js`. Это публичный ключ сайта, не секрет Gemini API key.
4. Сохрани изменения и отправь их в `main`; GitHub Actions обновит Pages.

Gemini Developer API работает на бесплатном уровне без платёжного метода и имеет квоты; reCAPTCHA Enterprise включает до 10 000 оценок в месяц без оплаты. Не подключай Cloud Billing ради помощника.
Без App Check модель не принимает запросы с опубликованного сайта. Не добавляй в репозиторий приватные API keys, debug tokens или другие секреты.
