(function () {
  "use strict";

  const APPLE_HELP = "https://support.apple.com/guide/iphone/iph42ab2f3a7/ios";
  const INSTALL_HELP = "https://support.google.com/chrome/answer/9658361";
  const serviceWorker = navigator.serviceWorker;
  const secure = window.isSecureContext === true;
  const displayMode = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)") : null;
  let promptEvent = null;
  let registration = null;
  const state = {
    supported: secure && !!serviceWorker,
    installed: !!navigator.standalone || !!(displayMode && displayMode.matches),
    canInstall: false,
    offlineReady: false,
    updateReady: false,
    error: ""
  };

  function getStatus() { return { ...state }; }

  function publish() {
    window.dispatchEvent(new CustomEvent("hvf-pwa-status", { detail: getStatus() }));
  }

  function getInstallInstructions() {
    const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);
    if (appleMobile) {
      return {
        title: "Установить на iPhone или iPad",
        steps: [
          "Открой постоянную ссылку приложения в Safari.",
          "Открой меню «Поделиться» и выбери «На экран Домой».",
          "Если есть переключатель «Открывать как веб-приложение», включи его, затем нажми «Добавить»."
        ],
        sourceUrl: APPLE_HELP
      };
    }
    return {
      title: "Установить приложение",
      steps: [
        "Открой постоянную ссылку приложения в Chrome или Edge.",
        "Нажми значок установки в адресной строке либо открой меню браузера и выбери установку приложения.",
        "После установки HVF можно запускать отдельным окном с рабочего стола или главного экрана."
      ],
      sourceUrl: INSTALL_HELP
    };
  }

  async function requestInstall() {
    if (state.installed) return { outcome: "installed" };
    if (!promptEvent) return { outcome: "unavailable" };
    const event = promptEvent;
    promptEvent = null;
    state.canInstall = false;
    publish();
    try {
      // Only called from the user's install action; never on page load.
      await event.prompt();
      const choice = await event.userChoice;
      return { outcome: choice.outcome };
    } catch (_) {
      return { outcome: "error" };
    }
  }

  async function checkForUpdate() {
    if (!registration) return false;
    try {
      await registration.update();
      return true;
    } catch (_) {
      return false;
    }
  }

  window.HVFPWA = Object.freeze({ getStatus, getInstallInstructions, requestInstall, checkForUpdate });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    promptEvent = event;
    state.canInstall = !state.installed;
    publish();
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    state.installed = true;
    state.canInstall = false;
    publish();
  });
  if (displayMode && typeof displayMode.addEventListener === "function") {
    displayMode.addEventListener("change", () => {
      state.installed = !!navigator.standalone || displayMode.matches;
      state.canInstall = !!promptEvent && !state.installed;
      publish();
    });
  }

  async function register() {
    if (!state.supported) { publish(); return; }
    try {
      // Relative URLs retain a GitHub Pages project subpath.
      registration = await serviceWorker.register("./service-worker.js", {
        scope: "./", updateViaCache: "none"
      });
      state.updateReady = !!registration.waiting;
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") {
            state.updateReady = !!serviceWorker.controller;
            publish();
          }
        });
      });
      // An installed shell can launch offline. Cloud sign-in/sync still
      // requires connectivity and stays under the existing store's control.
      serviceWorker.ready.then(() => {
        state.offlineReady = true;
        publish();
      }).catch(() => {});
      publish();
    } catch (_) {
      state.error = "Не удалось подготовить запуск без интернета. При подключении приложение продолжает работать.";
      publish();
    }
  }

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
})();
