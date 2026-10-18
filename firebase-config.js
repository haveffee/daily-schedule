/*
 * Публичная конфигурация Firebase для веб-приложения.
 * Значения можно получить в Firebase Console → Настройки проекта → Ваши приложения.
 * Это не секретные ключи. Доступ к пользовательским данным ограничивают firestore.rules.
 */
window.SCHEDULE_FIREBASE_CONFIG = Object.freeze({
  apiKey: "REPLACE_WITH_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "REPLACE_WITH_FIREBASE_APP_ID",
});
