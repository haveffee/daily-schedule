# daily-schedule

Персональное расписание публикуется на GitHub Pages. `generate.py` создаёт `index.html`, а GitHub Actions обновляет страницу каждый день.

## ИИ-помощник

Помощник использует Firebase AI Logic с Gemini Developer API. Он учитывает сегодняшнее расписание и дополнительные дела, но ничего не меняет без пользователя. Перед отправкой вопроса сайт показывает, что текст и названия сегодняшних задач будут переданы Google Gemini через Firebase.

Чтобы включить помощника:

1. В Firebase Console открой проект `daily-schedule-sync-fc374` и в разделе **AI Logic** нажми **Get started**. Выбери **Gemini Developer API** и бесплатный уровень без подключения Cloud Billing.
2. В **App Check** зарегистрируй веб-приложение с провайдером **reCAPTCHA Enterprise** для домена `haveffee.github.io` и включи защиту для **Firebase AI Logic**.
3. Добавь выданный публичный site key в поле `appCheckSiteKey` файла `firebase-config.js`. Это публичный ключ reCAPTCHA для сайта, не секрет Gemini API key.
4. Сохрани изменения и отправь их в `main`; GitHub Actions обновит Pages.

Без App Check модель не принимает запросы с опубликованного сайта. Не добавляй в репозиторий приватные API keys, debug tokens или другие секреты.
