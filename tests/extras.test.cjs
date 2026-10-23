const test = require('node:test');
const assert = require('node:assert/strict');
const { insights, tips } = require('../assistant-extras.js');

test('a mandatory shortage stays visible even before any income is recorded', () => {
  const hints = insights({ income: 0, mandatoryRequested: 680, mandatoryShortfall: 680, freeToSpend: 0 }, 'BYN', 10);
  assert.equal(hints[0].tone, 'warning');
  assert.match(hints[0].text, /680/);
  assert.ok(!hints.some(hint => hint.title === 'Ориентир на день'));
});

test('daily guidance uses only free money and rounds down without spending protected funds', () => {
  const hints = insights({ income: 700, mandatoryRequested: 680, freeToSpend: 20 }, 'BYN', 3);
  const daily = hints.find(hint => hint.title === 'Ориентир на день');
  assert.match(daily.text, /6,66/);
  assert.ok(!daily.text.includes('233,33'));
  assert.match(daily.text, /20/);
});

test('overspending takes priority over savings and per-day suggestions', () => {
  const hints = insights({ income: 100, spent: 150, deficit: 50, freeToSpend: 30, additionalIncome: 100 }, 'USD', 10);
  assert.equal(hints[0].tone, 'warning');
  assert.match(hints[0].text, /50/);
  assert.ok(!hints.some(hint => hint.title === 'Ориентир на день'));
});

test('spending that consumes protected money blocks a daily shopping allowance', () => {
  const hints = insights({ income: 1000, freeToSpend: 100, protectionShortfall: 75 }, 'BYN', 10);
  assert.ok(hints.some(hint => hint.tone === 'warning' && hint.text.includes('75')));
  assert.ok(!hints.some(hint => hint.title === 'Ориентир на день'));
});

test('initial mandatory shortage and later protected shortage remain separate', () => {
  const hints = insights({ income: 500, mandatoryShortfall: 180, protectionShortfall: 50 }, 'BYN', 10);
  assert.ok(hints.some(hint => hint.text.includes('180')));
  assert.ok(hints.some(hint => hint.text.includes('50')));
  assert.ok(!hints.some(hint => hint.text.includes('230')));
});

test('a gift is included as actual income and no date assumptions are made', () => {
  const hints = insights({ income: 100, salaryIncome: 0, additionalIncome: 100, freeToSpend: 100 }, 'BYN');
  assert.ok(hints.some(hint => hint.title === 'Дополнительный доход учтён'));
  assert.ok(!hints.some(hint => hint.title === 'Начни с поступлений'));
  assert.ok(!hints.some(hint => hint.title === 'Ориентир на день'));
});

test('empty and invalid data produce readable hints without NaN or Infinity', () => {
  for (const data of [undefined, {}, { income: Infinity, freeToSpend: NaN }, { income: 20, freeToSpend: 20 }, { income: true, freeToSpend: [] }]) {
    const hints = insights(data, '<broken>', 0);
    assert.ok(hints.length >= 1);
    assert.ok(hints.every(hint => !/NaN|Infinity|undefined/.test(hint.text)));
  }
});

test('very large finite input never creates an infinite daily amount', () => {
  const hints = insights({ income: 1e308, freeToSpend: 1e308 }, 'USD', 1);
  assert.ok(hints.every(hint => !/NaN|Infinity|∞/.test(hint.text)));
});

test('educational tips link to verified public primary sources', () => {
  assert.equal(tips.length, 4);
  for (const tip of tips) {
    assert.ok(['consumer.gov', 'www.consumerfinance.gov'].includes(new URL(tip.url).hostname));
    assert.ok(tip.title && tip.text && tip.source);
  }
});
