(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFQuick = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function civil(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var year = Number(value.slice(0, 4));
    if (year < 1) return null;
    var date = new Date(0);
    date.setUTCFullYear(year, Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10) === value ? date : null;
  }
  function dateString(year, month, day) {
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  function addDays(value, count) {
    var date = civil(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + count);
    var result = date.toISOString().slice(0, 10);
    return civil(result) ? result : '';
  }

  // Expressions use an explicit boundary: JavaScript's \b does not identify
  // Russian word boundaries. Keeping spans also preserves unrecognised text.
  var boundary = '(^|[\\s,;()[\\]{}])';
  var end = '(?=$|[\\s,;.!?()[\\]{}])';
  function scan(text, expression, convert) {
    var regex = new RegExp(boundary + '(' + expression + ')' + end, 'giu');
    var result = [], match;
    while ((match = regex.exec(text))) {
      var start = match.index + match[1].length;
      var token = match[2];
      result.push({start: start, end: start + token.length, token: token, value: convert(token, start)});
    }
    return result;
  }
  function parse(text, options) {
    var input = typeof text === 'string' ? text : '';
    var baseDate = options && options.baseDate;
    var base = civil(baseDate);
    var result = {title: input.trim(), date: base ? baseDate : '', time: '', duration: null, priority: 1, recognized: [], issues: []};
    var removed = [];
    function issue(message) { if (!result.issues.includes(message)) result.issues.push(message); }
    if (!base) issue('Укажи корректную исходную дату.');

    function select(field, candidates, invalidMessage, conflictMessage) {
      if (!candidates.length) return;
      if (candidates.some(function (candidate) { return candidate.value === null || candidate.value === ''; })) {
        issue(invalidMessage);
        return;
      }
      var distinct = Array.from(new Set(candidates.map(function (candidate) { return candidate.value; })));
      if (distinct.length !== 1) { issue(conflictMessage); return; }
      result[field] = distinct[0];
      result.recognized.push(field);
      removed = removed.concat(candidates);
    }

    var dates = scan(input, '\\d{4}-\\d{1,2}-\\d{1,2}', function (token) { return civil(token) ? token : null; });
    dates = dates.concat(scan(input, '\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?', function (token, start) {
      // A decimal followed by a standard unit is a quantity, not day.month.
      // Keep the entire quantity in the title; only hour durations are parsed
      // separately below. Without a unit, "2.5" remains a valid May 2 date.
      if (/^\d{1,2}\.\d{1,2}$/.test(token) && /^\s*(?:час(?:а|ов)?|ч\.?|кг|мг|г|т|мл|л|км|см|мм|м|шт\.?|килограмм(?:а|ов)?|грамм(?:а|ов)?|миллиграмм(?:а|ов)?|литр(?:а|ов)?|миллилитр(?:а|ов)?|метр(?:а|ов)?|километр(?:а|ов)?|сантиметр(?:а|ов)?|миллиметр(?:а|ов)?|руб(?:л(?:ь|я|ей))?\.?|долл\.?|доллар(?:а|ов)?|евро|kg|mg|g|ml|l|km|cm|mm|m|BYN|USD|RUB|EUR|GBP|CHF|JPY|CNY|PLN|UAH|[$€₽])(?=$|[\s,;.!?()[\]{}\/²³])/iu.test(input.slice(start + token.length))) return undefined;
      var parts = token.split('.').map(Number), year;
      if (parts.length === 3) {
        if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(token)) return null;
        year = parts[2];
      } else {
        if (!base) return null;
        year = base.getUTCFullYear();
        // Find the next occurrence, including February 29 in a leap year.
        for (var offset = 0; offset < 9 && year + offset <= 9999; offset++) {
          var next = dateString(year + offset, parts[1], parts[0]);
          if (civil(next) && next >= baseDate) return next;
        }
        return null;
      }
      var value = dateString(year, parts[1], parts[0]);
      return civil(value) ? value : null;
    }));
    dates = dates.concat(scan(input, 'послезавтра|завтра|сегодня', function (token) {
      var offset = {сегодня: 0, завтра: 1, послезавтра: 2}[token.toLocaleLowerCase('ru')];
      return addDays(baseDate, offset);
    }));
    var weekdays = {понедельник: 1, вторник: 2, среду: 3, четверг: 4, пятницу: 5, субботу: 6, воскресенье: 0};
    dates = dates.concat(scan(input, 'во?\\s+(?:(?:следующ(?:ий|ую|ее)|ближайш(?:ий|ую|ее)|эт(?:от|у|о))\\s+)?(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)', function (token) {
      if (!base) return null;
      var words = token.toLocaleLowerCase('ru').split(/\s+/);
      var weekday = weekdays[words[words.length - 1]];
      var distance = (weekday - base.getUTCDay() + 7) % 7;
      if (!distance && /следующ/.test(token.toLocaleLowerCase('ru'))) distance = 7;
      return addDays(baseDate, distance);
    }));
    dates = dates.filter(function (candidate) { return candidate.value !== undefined; });
    select('date', dates, 'Проверь дату: этот фрагмент оставлен в названии.', 'Найдено несколько разных дат. Выбери дату в редакторе.');

    var times = scan(input, '(?:в\\s+)?\\d{1,3}:\\d{1,3}(?::\\d{1,3})?', function (token) {
      var match = token.match(/^(?:в\s+)?(\d{1,2}):(\d{2})$/i);
      if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
      return match[1].padStart(2, '0') + ':' + match[2];
    });
    select('time', times, 'Проверь время: используй формат 18:00.', 'Найдено несколько разных значений времени. Выбери время в редакторе.');

    var units = '(?:час(?:а|ов)?|ч\\.?)';
    var minutes = '(?:минут(?:а|ы)?|мин\\.?)';
    var numeric = '\\d{1,4}(?:[.,]\\d{1,2})?\\s*' + units + '(?:\\s*\\d{1,3}\\s*' + minutes + ')?|\\d{1,4}\\s*' + minutes;
    var duration = scan(input, '(?:на\\s+)?(?:' + numeric + '|полтора\\s+часа|полчаса|час)', function (token, start) {
      // "Через час" is a reminder offset, not a task's duration.
      if (/через\s*$/iu.test(input.slice(0, start))) return undefined;
      var value = token.toLocaleLowerCase('ru').replace(/^на\s+/, '');
      if (value === 'час') return /^на\s+/iu.test(token) ? 60 : undefined;
      if (value === 'полчаса') return 30;
      if (value === 'полтора часа') return 90;
      var hours = value.match(/^(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:час(?:а|ов)?|ч\.?)(?:\s*(\d{1,3})\s*(?:минут(?:а|ы)?|мин\.?))?$/u);
      var count;
      if (hours) {
        if (hours[2] && Number(hours[2]) >= 60) return null;
        count = Number(hours[1].replace(',', '.')) * 60 + Number(hours[2] || 0);
      } else {
        var mins = value.match(/^(\d{1,4})\s*(?:минут(?:а|ы)?|мин\.?)$/u);
        count = mins ? Number(mins[1]) : NaN;
      }
      return Number.isInteger(count) && count >= 5 && count <= 480 ? count : null;
    }).filter(function (candidate) { return candidate.value !== undefined; });
    select('duration', duration, 'Проверь длительность: укажи от 5 до 480 минут.', 'Найдено несколько значений длительности. Выбери одно в редакторе.');

    var priorities = scan(input, '!\\s*(?:важно|высокий|низкий|обычный)|приоритет\\s*:?\\s*(?:высокий|низкий|обычный|средний)|(?:высокий|низкий|обычный|средний)\\s+приоритет|p[123]', function (token) {
      var value = token.toLocaleLowerCase('ru');
      if (/важно|высокий|p1/.test(value)) return 2;
      if (/низкий|p3/.test(value)) return 0;
      return 1;
    });
    select('priority', priorities, 'Проверь приоритет.', 'Найдено несколько разных приоритетов. Выбери один в редакторе.');

    removed.sort(function (a, b) { return a.start - b.start; });
    var title = '', cursor = 0;
    removed.forEach(function (span) {
      if (span.start < cursor) return;
      title += input.slice(cursor, span.start) + ' ';
      cursor = span.end;
    });
    title += input.slice(cursor);
    result.title = title.replace(/\s+/gu, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/gu, '');
    if (/^[\s.,;:!?–—-]*$/u.test(result.title)) result.title = '';
    if (!result.title) issue('Добавь название дела.');
    return result;
  }
  return {parse: parse};
}));
