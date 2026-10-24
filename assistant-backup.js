(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFBackup = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_BYTES = 5 * 1024 * 1024;
  var MAX_RECORDS = 5000;
  var KINDS = new Set(['task', 'routine', 'routine-skip', 'goal', 'budget', 'income', 'commitment', 'expense',
    'settings', 'finance-preferences', 'spending-limit', 'expense-category', 'income-plan', 'onboarding-preferences']);
  var FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
  var CREDENTIALS = new Set(['accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'authorization', 'apikey', 'clientsecret', 'vapidprivatekey', 'privatekey', 'password']);
  var own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };

  function issue(code, message, index, id) {
    var error = { code: code, message: message };
    if (index !== undefined) error.index = index;
    if (id !== undefined) error.id = id;
    return error;
  }

  function validMonth(value) {
    return typeof value === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) !== '0000';
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value) || value.slice(0, 4) === '0000') return false;
    var date = new Date(0);
    date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10) === value;
  }

  function recordArray(records) {
    if (Array.isArray(records)) return records;
    if (records && typeof records === 'object' && (Object.getPrototypeOf(records) === Object.prototype || Object.getPrototypeOf(records) === null)) return Object.values(records);
    return null;
  }

  // Validate before cloning. This rejects prototype keys and credentials at any
  // depth, and bounds nesting so even an untrusted file cannot exhaust the stack.
  function jsonSafety(value) {
    var work = [{ value: value, depth: 0 }], seen = new Set(), count = 0;
    while (work.length) {
      var node = work.pop(), item = node.value;
      count += 1;
      if (count > 250000 || node.depth > 40) return 'Файл содержит слишком сложные вложенные данные.';
      if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) return 'Числа в копии должны быть конечными.';
        continue;
      }
      if (typeof item !== 'object') return 'Копия должна содержать только данные JSON.';
      var prototype = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return 'В копии обнаружен недопустимый объект.';
      if (seen.has(item)) return 'Копия содержит повторную или циклическую ссылку.';
      seen.add(item);
      var keys = Object.keys(item);
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        if (FORBIDDEN.has(key)) return 'В копии обнаружено запрещённое имя поля: ' + key + '.';
        if (CREDENTIALS.has(key.toLowerCase().replace(/[_-]/g, ''))) return 'Копия содержит данные доступа. Используй экспорт HVF без паролей и токенов.';
        var descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !own(descriptor, 'value')) return 'Копия должна содержать обычные поля данных.';
        work.push({ value: descriptor.value, depth: node.depth + 1 });
      }
    }
    return '';
  }

  function present(value) { return value !== undefined && value !== null && value !== ''; }
  function numeric(value, minimum, maximum, integer) {
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    // Match decimal storage values, including scientific notation. Number()
    // alone also accepts hex/binary/octal strings which the money ledgers ignore.
    var text = String(value).trim();
    if (!/^\+?[0-9]+(?:\.[0-9]*)?(?:e[+-]?[0-9]+)?$/i.test(text)) return false;
    var number = Number(text);
    return Number.isFinite(number) && number >= minimum && number <= maximum && (!integer || Number.isInteger(number));
  }

  function validateRecord(record, index) {
    var errors = [], id = record && typeof record.id === 'string' ? record.id : undefined;
    function fail(code, message) { errors.push(issue(code, message, index, id)); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [issue('record', 'Запись должна быть объектом.', index)];
    if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 500 || FORBIDDEN.has(record.id)) fail('id', 'У записи должен быть безопасный непустой id длиной до 500 символов.');
    if (!KINDS.has(record.kind)) fail('kind', 'Неизвестный тип записи. Обнови приложение, если копия создана более новой версией.');
    if (!validMonth(record.month)) fail('month', 'У записи должен быть месяц в формате ГГГГ-ММ.');
    if (record.deleted === true) fail('deleted', 'Копия содержит удалённую запись вместо действующих данных.');
    if (present(record.currency) && ['BYN', 'USD', 'RUB'].indexOf(record.currency) < 0) fail('currency', 'Валюта записи должна быть BYN, USD или RUB.');
    if (present(record.date)) {
      if (!validDate(record.date)) fail('date', 'Дата записи не существует или имеет неверный формат.');
      else if (record.date.slice(0, 7) !== record.month) fail('date-month', 'Дата записи не совпадает с её месяцем.');
    }
    if (['task', 'routine', 'goal', 'commitment', 'expense-category'].indexOf(record.kind) >= 0 &&
        (typeof record.title !== 'string' || !record.title.trim())) fail('title', 'У дела, цели или категории должно быть название.');
    if (record.kind === 'task' && !validDate(record.date)) fail('task-date', 'У дела должна быть существующая дата.');
    if (record.kind === 'task' || record.kind === 'routine') {
      if (present(record.time) && (typeof record.time !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(record.time))) fail('time', 'Время дела должно иметь формат ЧЧ:ММ.');
      if (present(record.duration) && !numeric(record.duration, 1, 1440, true)) fail('duration', 'Длительность дела должна быть от 1 до 1440 минут.');
      if (present(record.reminderMinutes) && !numeric(record.reminderMinutes, 0, 1440, true)) fail('reminder', 'Некорректное время напоминания.');
      if (present(record.done) && typeof record.done !== 'boolean') fail('done', 'Отметка выполнения должна быть true или false.');
      if (present(record.occurrenceDate) && !validDate(record.occurrenceDate)) fail('occurrence-date', 'Некорректная дата исходного повторения.');
    }
    if (record.kind === 'routine') {
      if (!Array.isArray(record.weekdays) || !record.weekdays.length || record.weekdays.some(function (day) { return !Number.isInteger(day) || day < 1 || day > 7; })) fail('weekdays', 'У повторяющегося дела должны быть дни недели от 1 до 7.');
      if (!validDate(record.startDate)) fail('start-date', 'Некорректная дата начала повторяющегося дела.');
      if (present(record.untilDate) && (!validDate(record.untilDate) || record.untilDate < record.startDate)) fail('until-date', 'Некорректная дата окончания повторяющегося дела.');
      if (present(record.active) && typeof record.active !== 'boolean') fail('active', 'Активность повторения должна быть true или false.');
    }
    if (record.kind === 'routine-skip') {
      if (typeof record.routineId !== 'string' || !record.routineId) fail('routine-id', 'У пропуска должен быть id повторяющегося дела.');
      var occurrence = record.occurrenceDate || record.date;
      if (!validDate(occurrence) || occurrence.slice(0, 7) !== record.month || (record.date && record.date !== occurrence)) fail('skip-date', 'Некорректная дата пропущенного повторения.');
    }
    if (['income', 'commitment', 'expense', 'spending-limit'].indexOf(record.kind) >= 0 && !numeric(record.amount, 0, 1000000000, false)) fail('amount', 'Сумма записи должна быть числом от 0 до 1 000 000 000.');
    if (record.kind === 'goal') {
      ['target', 'saved'].forEach(function (field) {
        if (present(record[field]) && !numeric(record[field], 0, 1000000000, false)) fail(field, 'Сумма цели должна быть неотрицательным конечным числом.');
      });
    }
    if (record.kind === 'budget') {
      if (present(record.income) && !numeric(record.income, 0, 1000000000, false)) fail('income', 'Доход должен быть неотрицательным конечным числом.');
      ['reservePercent', 'goalsPercent'].forEach(function (field) {
        if (present(record[field]) && !numeric(record[field], 0, 100, false)) fail(field, 'Доля распределения должна быть от 0 до 100%.');
      });
    }
    if (record.kind === 'commitment' && present(record.dueDay) && !numeric(record.dueDay, 0, 31, true)) fail('due-day', 'День платежа должен быть от 0 до 31.');
    if (record.kind === 'settings') {
      ['start', 'end'].forEach(function (field) {
        if (present(record[field]) && (typeof record[field] !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(record[field]))) fail(field, 'Границы дня должны иметь формат ЧЧ:ММ.');
      });
      if (present(record.breakMinutes) && !numeric(record.breakMinutes, 0, 60, true)) fail('break', 'Перерыв должен быть от 0 до 60 минут.');
    }
    if (record.kind === 'spending-limit') {
      if (typeof record.category !== 'string' || !record.category.trim()) fail('category', 'У лимита должна быть категория расходов.');
      if (present(record.warningPercent) && !numeric(record.warningPercent, 50, 100, true)) fail('warning-percent', 'Порог предупреждения должен быть от 50 до 100%.');
    }
    if (record.kind === 'expense-category') {
      if (typeof record.id !== 'string' || !/^category-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(record.id)) fail('category-id', 'Некорректный id пользовательской категории расходов.');
      if (record.month !== '2000-03') fail('category-month', 'Пользовательские категории должны храниться в общем разделе 2000-03.');
      if (typeof record.title === 'string' && record.title.trim().replace(/\s+/g, ' ').length > 48) fail('category-title', 'Название категории должно содержать не больше 48 символов.');
      if (['essentials', 'reserve', 'goals', 'flexible'].indexOf(record.envelope) < 0) fail('category-envelope', 'У категории должна быть существующая часть бюджета.');
      if (record.archived !== undefined && typeof record.archived !== 'boolean') fail('category-archived', 'Состояние архива категории должно быть true или false.');
    }
    if (record.kind === 'income-plan') {
      if (['BYN', 'USD', 'RUB'].indexOf(record.currency) < 0 || record.id !== 'income-plan-' + record.currency) fail('income-plan-id', 'Id плана поступления должен соответствовать его валюте.');
      if (record.month !== '2000-04') fail('income-plan-month', 'Планы поступлений должны храниться в общем разделе 2000-04.');
      if (!validDate(record.nextDate)) fail('income-plan-date', 'В плане поступления должна быть существующая дата дохода.');
      if (record.expectedAmount !== undefined && record.expectedAmount !== null && !numeric(record.expectedAmount, 0, 1000000000, false)) fail('expected-amount', 'Ожидаемая сумма должна быть неотрицательным десятичным числом или null.');
    }
    if (record.kind === 'onboarding-preferences') {
      if (record.id !== 'onboarding-preferences' || record.month !== '2000-05') fail('onboarding-id', 'Настройки первого запуска должны храниться под общим id onboarding-preferences в разделе 2000-05.');
      if (typeof record.completed !== 'boolean') fail('onboarding-completed', 'Завершение первого запуска должно быть true или false.');
      if (record.version !== 1) fail('onboarding-version', 'Неизвестная версия настроек первого запуска.');
    }
    return errors;
  }

  function inspect(value) {
    var errors = [], warnings = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, backup: null, records: [], errors: [issue('format', 'Выбери JSON-копию, скачанную из HVF.')], warnings: [] };
    var unsafe = jsonSafety(value);
    if (unsafe) return { ok: false, backup: null, records: [], errors: [issue('unsafe', unsafe)], warnings: [] };
    if (value.app !== 'HVF' || (value.version !== 2 && value.version !== 3)) errors.push(issue('version', 'Поддерживаются копии HVF версий 2 и 3.'));
    if (value.version === 3 && value.scope !== 'all') errors.push(issue('scope', 'У полной копии версии 3 должно быть scope: all.'));
    if (value.version === 2 && !validMonth(value.month)) errors.push(issue('month', 'В старой копии должен быть указан месяц.'));
    if (!Array.isArray(value.records)) errors.push(issue('records', 'В копии отсутствует список записей.'));
    var source = Array.isArray(value.records) ? value.records : [];
    if (source.length > MAX_RECORDS) errors.push(issue('count', 'В одной копии может быть не больше 5000 записей.'));
    var ids = new Set();
    if (source.length <= MAX_RECORDS) source.forEach(function (record, index) {
      errors = errors.concat(validateRecord(record, index));
      if (record && typeof record.id === 'string') {
        if (ids.has(record.id)) errors.push(issue('duplicate', 'В копии повторяется id записи. Восстановление остановлено, чтобы не перезаписать данные.', index, record.id));
        ids.add(record.id);
      }
    });
    if (value.version === 2) warnings.push('Старая копия содержит выбранный месяц и сохранённые в ней общие настройки, а не всю историю.');
    var stamp = typeof value.exportedAt === 'string' && Number.isFinite(Date.parse(value.exportedAt)) ? value.exportedAt : '';
    if (!stamp) warnings.push('В копии не указана корректная дата создания.');
    var backup = errors.length ? null : {
      app: 'HVF', version: value.version, scope: value.version === 2 ? 'month' : 'all', exportedAt: stamp,
      records: clone(source)
    };
    if (backup && value.version === 2) backup.month = value.month;
    return { ok: errors.length === 0, backup: backup, records: backup ? clone(backup.records) : [], errors: errors, warnings: warnings,
      version: value.version, scope: value.version === 2 ? 'month' : 'all' };
  }

  function bytes(text) { return new TextEncoder().encode(text).length; }

  function parse(text) {
    if (typeof text !== 'string') return { ok: false, backup: null, records: [], errors: [issue('type', 'Для восстановления выбери JSON-файл.')], warnings: [] };
    if (text.length > MAX_BYTES || bytes(text) > MAX_BYTES) return { ok: false, backup: null, records: [], errors: [issue('size', 'Копия должна быть не больше 5 МБ.')], warnings: [] };
    try { return inspect(JSON.parse(text.replace(/^\uFEFF/, ''))); }
    catch (_) { return { ok: false, backup: null, records: [], errors: [issue('json', 'Не удалось прочитать JSON. Файл повреждён или имеет другой формат.')], warnings: [] }; }
  }

  function create(records, options) {
    var source = recordArray(records);
    if (!source) throw new Error('Для копии нужен список записей HVF.');
    var value = { app: 'HVF', version: 3, scope: 'all', exportedAt: options && options.exportedAt || new Date().toISOString(), records: source };
    var result = inspect(value);
    if (!result.ok) {
      var invalid = new Error(result.errors[0].message);
      invalid.errors = result.errors;
      throw invalid;
    }
    // The download UI uses indentation. Count that exact representation so a
    // freshly exported file never exceeds the import limit because of spaces.
    if (bytes(JSON.stringify(result.backup, null, 2)) > MAX_BYTES) throw new Error('Копия должна быть не больше 5 МБ.');
    return result.backup;
  }

  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }

  /** Preview only. The caller must explicitly confirm, recalculate against the
   * latest account snapshot, then use HVFStore.putMany. No record is deleted.
   * A different month or kind for the same id is never safe to overwrite.
   */
  function importPlan(currentRecords, input, options) {
    var result = typeof input === 'string' ? parse(input) : input && own(input, 'ok') && own(input, 'backup') ? input : inspect(input);
    // Never trust a caller-mutated parsed result; validate its backup again.
    if (result && result.ok) result = inspect(result.backup);
    var mode = options && options.mode || 'merge';
    var invalid = result && Array.isArray(result.errors) ? result.errors.slice() : [issue('format', 'Некорректная копия HVF.')];
    if (!result || result.ok !== true) {
      if (!invalid.length) invalid.push(issue('format', 'Некорректная копия HVF.'));
    }
    if (mode !== 'merge' && mode !== 'replace') invalid.push(issue('mode', 'Выбери добавление новых записей или явную замену совпадений.'));
    var additions = [], replacements = [], conflicts = [], unchanged = [];
    var current = recordArray(currentRecords);
    if (!current) invalid.push(issue('current', 'Не удалось прочитать текущие записи.'));
    var plan = { ok: invalid.length === 0, mode: mode, records: [], additions: additions, replacements: replacements,
      conflicts: conflicts, unchanged: unchanged, invalid: invalid, skipped: 0, warnings: result && result.warnings || [] };
    if (!plan.ok) return plan;
    var indexed = new Map();
    current.forEach(function (record) { if (record && typeof record.id === 'string' && !record.deleted) indexed.set(record.id, record); });
    result.records.forEach(function (record) {
      var previous = indexed.get(record.id);
      if (!previous) additions.push(clone(record));
      else if (previous.month !== record.month || previous.kind !== record.kind) {
        conflicts.push({ id: record.id, reason: previous.month !== record.month ? 'month' : 'kind', replaceable: false, current: clone(previous), incoming: clone(record) });
      } else if (stable(previous) === stable(record)) unchanged.push(clone(record));
      else {
        conflicts.push({ id: record.id, reason: 'changed', replaceable: true, current: clone(previous), incoming: clone(record) });
        if (mode === 'replace') replacements.push(clone(record));
      }
    });
    plan.records = additions.concat(replacements).map(clone);
    plan.skipped = conflicts.length - replacements.length;
    return plan;
  }

  return Object.freeze({ create: create, parse: parse, importPlan: importPlan, preview: importPlan, MAX_BYTES: MAX_BYTES, MAX_RECORDS: MAX_RECORDS });
}));
