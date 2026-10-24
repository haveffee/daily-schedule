const test = require('node:test');
const assert = require('node:assert/strict');
const quick = require('../assistant-quick.js');
const baseDate = '2026-10-24';
const parse = (text, date = baseDate) => quick.parse(text, {baseDate: date});

test('Russian quick entry extracts a relative date, time and an hour', () => {
  assert.deepEqual(parse('Завтра в 18:00 репетитор на час'), {
    title: 'репетитор', date: '2026-10-25', time: '18:00', duration: 60,
    priority: 1, recognized: ['date', 'time', 'duration'], issues: []
  });
});

test('weekdays choose the next occurrence across a calendar year', () => {
  const entry = parse('в пятницу 9:30 тренировка 45 мин', '2026-12-31');
  assert.equal(entry.date, '2027-01-01');
  assert.equal(entry.time, '09:30');
  assert.equal(entry.duration, 45);
  assert.equal(entry.title, 'тренировка');
  assert.equal(parse('во вторник встреча', '2026-10-24').date, '2026-10-27');
  assert.equal(parse('в эту субботу встреча').date, baseDate);
  assert.equal(parse('в следующую субботу встреча').date, '2026-10-31');
});

test('today and day after tomorrow use civil dates independently of timezone', () => {
  assert.equal(parse('сегодня оплатить проезд').date, baseDate);
  assert.equal(parse('послезавтра позвонить', '2026-12-30').date, '2027-01-01');
  assert.equal(parse('завтра позвонить', '2024-02-28').date, '2024-02-29');
  assert.equal(parse('завтра позвонить', '2025-02-28').date, '2025-03-01');
});

test('explicit dates support day.month.year and ISO, retaining a chosen past date', () => {
  assert.equal(parse('25.10.2026 репетитор').date, '2026-10-25');
  assert.equal(parse('2026-10-25 репетитор').date, '2026-10-25');
  assert.equal(parse('15.09.2025 оплатить').date, '2025-09-15');
  assert.equal(parse('29.02.2028 встреча').date, '2028-02-29');
});

test('dates without a year choose the upcoming valid occurrence', () => {
  assert.equal(parse('25.10 репетитор').date, '2026-10-25');
  assert.equal(parse('01.01 встреча').date, '2027-01-01');
  assert.equal(parse('29.02 встреча').date, '2028-02-29');
  assert.equal(parse('24.10 встреча').date, baseDate);
});

test('impossible dates and unsupported short years remain visible for correction', () => {
  for (const date of ['31.04', '29.02.2027', '2026-02-30', '25.10.26', '00.12.2026', '2026-13-01', '0000-01-01']) {
    const entry = parse(`${date} встреча`);
    assert.equal(entry.title, `${date} встреча`);
    assert.equal(entry.date, baseDate);
    assert.equal(entry.recognized.includes('date'), false);
    assert.ok(entry.issues.length, date);
  }
});

test('invalid and ambiguous times are not silently removed', () => {
  for (const time of ['25:00', '18:60', '9:3', '999:00', '12:30:00']) {
    const entry = parse(`в ${time} встреча`);
    assert.equal(entry.title, `в ${time} встреча`);
    assert.equal(entry.time, '');
    assert.ok(entry.issues.length, time);
  }
  const entry = parse('Встреча в 18:00 или в 19:00');
  assert.equal(entry.title, 'Встреча в 18:00 или в 19:00');
  assert.equal(entry.time, '');
  assert.ok(entry.issues.length);
});

test('contradictory dates are kept in the title instead of selecting silently', () => {
  const entry = parse('сегодня или завтра позвонить');
  assert.equal(entry.title, 'сегодня или завтра позвонить');
  assert.equal(entry.date, baseDate);
  assert.ok(entry.issues.length);
  assert.equal(parse('завтра 25.10 позвонить').title, 'позвонить');
});

test('duration accepts common Russian spellings and compact forms', () => {
  for (const [input, minutes] of [
    ['на час', 60], ['на полчаса', 30], ['полчаса', 30], ['полтора часа', 90],
    ['1ч30мин', 90], ['1 ч 30 мин', 90], ['на 2 часа', 120], ['2 часов', 120],
    ['45 минут', 45], ['на 30 мин.', 30], ['1,5 часа', 90], ['1.5 ч', 90],
    ['5 мин', 5], ['8 часов', 480]
  ]) {
    const entry = parse(`Подготовиться ${input}`);
    assert.equal(entry.duration, minutes, input);
    assert.equal(entry.title, 'Подготовиться', input);
    assert.deepEqual(entry.issues, [], input);
  }
});

test('out-of-range or contradictory duration remains visible', () => {
  for (const input of ['0 мин', '4 мин', '481 мин', '9 часов', '1ч90мин', '0,01 часа']) {
    const entry = parse(`Дело ${input}`);
    assert.equal(entry.duration, null, input);
    assert.equal(entry.title, `Дело ${input}`, input);
    assert.ok(entry.issues.length, input);
  }
  const entry = parse('Дело на час 30 мин');
  assert.equal(entry.duration, null);
  assert.equal(entry.title, 'Дело на час 30 мин');
  assert.ok(entry.issues.length);
});

test('delay phrases and ordinary numbers are not mistaken for duration', () => {
  for (const title of ['через час позвонить', 'через 30 минут позвонить', 'Купить молоко за 100 рублей', 'Поговорить час спустя', 'Купить высокий стул', 'Завтрак приготовить']) {
    const entry = parse(title);
    assert.equal(entry.title, title);
    assert.equal(entry.duration, null);
    assert.equal(entry.date, baseDate);
    assert.equal(entry.priority, 1);
  }
});

test('decimal quantities with standard units are preserved instead of becoming dates', () => {
  for (const unit of ['кг', 'г', 'мг', 'т', 'л', 'мл', 'м', 'км', 'см', 'мм', 'метра', 'литра', 'килограмма', 'руб', 'руб.', 'рубля', 'рублей', 'доллара', 'BYN', 'USD', 'RUB', 'EUR', 'kg', 'ml', '$', '€']) {
    const text = `Купить 2.5 ${unit} риса`;
    const entry = parse(text);
    assert.equal(entry.title, text, unit);
    assert.equal(entry.date, baseDate, unit);
    assert.deepEqual(entry.recognized, [], unit);
    assert.deepEqual(entry.issues, [], unit);
  }
  const tomorrow = parse('Завтра купить 1.5 кг яблок');
  assert.equal(tomorrow.title, 'купить 1.5 кг яблок');
  assert.equal(tomorrow.date, '2026-10-25');
  assert.deepEqual(tomorrow.issues, []);
  assert.equal(parse('Купить 1.50 USD').title, 'Купить 1.50 USD');
  assert.deepEqual(parse('Купить 1.50 USD').issues, []);
  assert.equal(parse('2.5 репетитор').date, '2027-05-02');
  assert.equal(parse('2.5 репетитор').title, 'репетитор');
});

test('priorities require explicit markers and map p1 to high and p3 to low', () => {
  for (const [marker, expected] of [
    ['!важно', 2], ['! высокий', 2], ['высокий приоритет', 2], ['приоритет: высокий', 2],
    ['низкий приоритет', 0], ['приоритет низкий', 0], ['!низкий', 0],
    ['обычный приоритет', 1], ['средний приоритет', 1], ['p1', 2], ['P2', 1], ['p3', 0]
  ]) {
    const entry = parse(`Заплатить ${marker}`);
    assert.equal(entry.priority, expected, marker);
    assert.equal(entry.title, 'Заплатить', marker);
  }
  const conflict = parse('Дело p1 p3');
  assert.equal(conflict.priority, 1);
  assert.equal(conflict.title, 'Дело p1 p3');
  assert.ok(conflict.issues.length);
});

test('keeps Unicode and markup as plain text, strips only recognised syntax', () => {
  const entry = parse('Завтра, в 18:00 — <b>Репетитор & английский</b> 📚 на час !важно');
  assert.equal(entry.title, '<b>Репетитор & английский</b> 📚');
  assert.equal(entry.priority, 2);
  assert.deepEqual(entry.issues, []);
});

test('requires a title after recognised attributes and handles empty input', () => {
  assert.equal(parse('завтра в 18:00 на час').title, '');
  assert.equal(parse('Завтра, в 18:00.').title, '');
  assert.ok(parse('завтра в 18:00 на час').issues.length);
  assert.ok(parse('').issues.length);
  assert.ok(parse(null).issues.length);
});

test('browser build exposes the same API without CommonJS or dependencies', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../assistant-quick.js'), 'utf8'), context);
  const entry = context.HVFQuick.parse('Завтра в 18:00 репетитор на час', {baseDate});
  assert.equal(entry.title, 'репетитор');
  assert.equal(entry.date, '2026-10-25');
  assert.equal(entry.duration, 60);
});

test('date arithmetic rejects the civil range overflow and an invalid base date', () => {
  const overflow = parse('завтра дело', '9999-12-31');
  assert.equal(overflow.title, 'завтра дело');
  assert.equal(overflow.date, '9999-12-31');
  assert.ok(overflow.issues.length);
  const invalid = parse('сегодня дело', '2026-02-30');
  assert.equal(invalid.date, '');
  assert.equal(invalid.title, 'сегодня дело');
  assert.ok(invalid.issues.length);
});

test('does not mutate frozen options and returns independent result objects', () => {
  const options = Object.freeze({baseDate});
  const a = quick.parse('Завтра дело', options);
  const b = quick.parse('Завтра дело', options);
  a.recognized.push('fake');
  a.issues.push('fake');
  assert.deepEqual(b.recognized, ['date']);
  assert.deepEqual(b.issues, []);
  assert.equal(options.baseDate, baseDate);
});
