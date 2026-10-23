(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFExtras = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // These are short summaries of public financial education, available offline.
  // No account data is sent to the source websites or to a remote advice feed.
  var budgetSource = 'https://consumer.gov/your-money/making-budget';
  var savingsSource = 'https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/';
  var tips = Object.freeze([
    Object.freeze({
      title: 'Сначала — обязательное',
      text: 'В начале месяца выпиши обязательные платежи и их суммы. Учитывай их до необязательных покупок: так видно, сколько денег действительно остаётся свободным.',
      source: 'FTC · планирование бюджета',
      url: budgetSource
    }),
    Object.freeze({
      title: 'Подушка начинается с малого',
      text: 'Выбери посильную сумму и откладывай регулярно. Цель резерва можно оценить по прошлым неожиданным расходам. Храни его отдельно от денег на обычные покупки.',
      source: 'CFPB · резерв на непредвиденное',
      url: savingsSource
    }),
    Object.freeze({
      title: 'Подарок может приблизить цель',
      text: 'После подарка или разовой подработки реши, какую часть направить в резерв. Даже небольшое разовое пополнение помогает начать накопления.',
      source: 'CFPB · разовые поступления',
      url: savingsSource
    }),
    Object.freeze({
      title: 'Проверяй план по факту',
      text: 'Записывай расходы каждый день, а в конце месяца сравни их с планом. Скорректируй следующий месяц по реальным тратам и оставь место для накоплений.',
      source: 'FTC · учёт расходов',
      url: budgetSource
    })
  ]);

  function amount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    var number = Number(value);
    return Number.isFinite(number)
      ? Math.min(Number.MAX_SAFE_INTEGER / 100, Math.max(-Number.MAX_SAFE_INTEGER / 100, number))
      : 0;
  }

  function money(value, currency) {
    var code = /^(BYN|USD|RUB|EUR)$/.test(currency) ? currency : 'BYN';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency', currency: code, maximumFractionDigits: 2
    }).format(value);
  }

  // Local arithmetic hints describe the plan; an allocation is not a bank transfer.
  function insights(budget, currency, remainingDays) {
    var b = budget || {};
    var result = [];
    var income = Math.max(0, amount(b.income));
    var deficit = Math.max(0, amount(b.deficit));
    var mandatoryShortfall = Math.max(0, amount(b.mandatoryShortfall));
    var protectionShortfall = Math.max(0, amount(b.protectionShortfall));
    var free = Math.max(0, amount(b.freeToSpend));
    var days = Math.floor(amount(remainingDays));
    var additional = Math.max(0, amount(b.additionalIncome));

    if (deficit > 0) {
      result.push({
        title: 'Расходы превысили доход', tone: 'warning',
        text: 'Не хватает ' + money(deficit, currency) + '. Проверь записи и пересмотри необязательные траты, прежде чем планировать новые покупки.'
      });
    }
    if (mandatoryShortfall > 0) {
      result.push({
        title: 'На обязательное пока не хватает', tone: 'warning',
        text: 'В плане не покрыто ' + money(mandatoryShortfall, currency) + ' обязательных отложений. Проверь суммы и доступный доход. Пока обязательное не покрыто, отложи необязательные покупки.'
      });
    }
    if (protectionShortfall > 0) {
      result.push({
        title: 'Нужно восстановить отложения', tone: 'warning',
        text: 'После записанных расходов для защищённых отложений не хватает ' + money(protectionShortfall, currency) + '. Проверь траты и распределение перед новой покупкой: обязательные платежи и накопления требуют покрытия.'
      });
    }
    if (!income && !deficit && !mandatoryShortfall && !protectionShortfall) {
      result.push({
        title: 'Начни с поступлений', tone: 'neutral',
        text: 'Укажи зарплату или разовый доход за этот месяц, затем добавь обязательные отложения. Помощник покажет свободный остаток.'
      });
    }
    if (income > 0 && !deficit && !mandatoryShortfall && !protectionShortfall && free > 0 && days > 0 && days <= 366) {
      var cents = Math.min(Number.MAX_SAFE_INTEGER, Math.round(free * 100));
      var daily = Math.floor(cents / days) / 100;
      result.push({
        title: 'Ориентир на день', tone: 'positive',
        text: 'Свободные ' + money(free, currency) + ' на оставшиеся ' + days + ' дн. — примерно ' + money(daily, currency) + ' в день. Это ориентир по плану, его можно менять.'
      });
    }
    if (additional > 0 && result.length < 3) {
      result.push({
        title: 'Дополнительный доход учтён', tone: 'positive',
        text: 'Разовые поступления ' + money(additional, currency) + ' уже входят в бюджет месяца. Реши, какую часть оставить на покупки, а какую направить на цель или резерв.'
      });
    }
    if (!result.length) {
      result.push({
        title: 'Деньгам уже назначена роль', tone: 'neutral',
        text: 'Свободного остатка в плане нет. Перед новой покупкой проверь обязательные отложения, резерв и цели.'
      });
    }
    return result.slice(0, 3);
  }

  function tipForBudget(budget, currency, remainingDays) {
    return insights(budget, currency, remainingDays)[0];
  }

  return Object.freeze({ tips: tips, insights: insights, tipForBudget: tipForBudget });
}));
