const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const originalSource = fs.readFileSync(path.join(__dirname, '../assistant-ai.js'), 'utf8');
// Replace only the network dependency boundary. The production API and all
// parsing, queueing, preference, and cancellation logic run unchanged in a VM.
assert.ok(originalSource.includes('import(TRANSFORMERS_URL)'));
const source = originalSource.replace('import(TRANSFORMERS_URL)', 'Promise.resolve(root.__mockTransformers)');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'mock operation should make progress');
    await delay(1);
  }
}

function fixture(options = {}) {
  const storage = new Map(options.persistedEnabled ? [['hvf-ai-enabled-v1', 'true']] : []);
  const state = {
    imports: 0,
    loads: 0,
    calls: 0,
    active: 0,
    maximumActive: 0,
    prompts: [],
    choices: [],
    stops: [],
    reply: '{"minutes":45}',
    preferences: storage
  };
  const sandbox = {
    setTimeout: options.shortDeadline
      ? (callback, milliseconds) => setTimeout(callback, milliseconds === 90000 ? 5 : milliseconds)
      : setTimeout,
    clearTimeout,
    HVFCore: { estimateDuration: () => 35 },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    }
  };
  if (options.webgpu) {
    sandbox.navigator = { gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } };
  }
  class InterruptableStoppingCriteria {
    interrupt() { this.interrupted = true; }
  }
  const transformers = {
    env: { backends: { onnx: { wasm: {} } } },
    InterruptableStoppingCriteria,
    pipeline: async (task, model, choice) => {
      state.loads += 1;
      state.choices.push(choice);
      assert.equal(task, 'text-generation');
      assert.equal(model, 'onnx-community/Qwen3-0.6B-ONNX');
      if (options.gpuFailure && choice.device === 'webgpu') throw new Error('mock GPU unavailable');
      if (options.loadGate) await options.loadGate.promise;
      const generator = async (prompt, config) => {
        state.calls += 1;
        state.active += 1;
        state.maximumActive = Math.max(state.maximumActive, state.active);
        state.prompts.push(prompt);
        state.stops.push(config.stopping_criteria);
        assert.equal(config.return_full_text, false);
        try {
          if (options.generationGate) await options.generationGate.promise;
          else await delay(options.generationDelay || 10);
          return [{ generated_text: state.reply }];
        } finally {
          state.active -= 1;
        }
      };
      generator.tokenizer = {
        apply_chat_template(messages, templateOptions) {
          assert.equal(templateOptions.enable_thinking, false);
          assert.equal(templateOptions.tokenize, false);
          return JSON.stringify(messages);
        }
      };
      return generator;
    }
  };
  Object.defineProperty(sandbox, '__mockTransformers', {
    get() { state.imports += 1; return transformers; }
  });
  vm.runInNewContext(source, sandbox, { filename: 'assistant-ai.js' });
  state.ai = sandbox.HVFAI;
  return state;
}

test('AI is off by default and enabling does not download anything', async () => {
  const state = fixture();
  assert.equal(state.ai.isEnabled(), false);
  assert.equal((await state.ai.estimate('Задача')).source, 'local');
  assert.equal((await state.ai.plan({ title: 'Английский' })).source, 'local');
  state.ai.setEnabled(true);
  assert.equal(state.preferences.get('hvf-ai-enabled-v1'), 'true');
  assert.equal(state.imports, 0);
  assert.equal(state.loads, 0);
  const persisted = fixture({ persistedEnabled: true });
  assert.equal(persisted.ai.isEnabled(), true);
  assert.equal(persisted.imports, 0);
  assert.equal(persisted.loads, 0);
});

test('model is lazy and shared, while requests are serialized', async () => {
  const state = fixture();
  state.ai.setEnabled(true);
  const results = await Promise.all([state.ai.estimate('Первая'), state.ai.estimate('Вторая')]);
  assert.equal(results[0].source, 'qwen');
  assert.equal(results[1].minutes, 45);
  assert.equal(state.imports, 1);
  assert.equal(state.loads, 1);
  assert.equal(state.maximumActive, 1);
  assert.equal(state.choices[0].device, 'wasm');
  assert.equal(state.choices[0].dtype, 'q4');
});

test('WebGPU uses q4f16 and can fall back to q4 on the processor', async () => {
  const gpu = fixture({ webgpu: true });
  gpu.ai.setEnabled(true);
  await gpu.ai.estimate('Задача');
  assert.equal(gpu.choices[0].device, 'webgpu');
  assert.equal(gpu.choices[0].dtype, 'q4f16');
  const fallback = fixture({ webgpu: true, gpuFailure: true });
  fallback.ai.setEnabled(true);
  assert.equal((await fallback.ai.estimate('Задача')).source, 'qwen');
  assert.deepEqual(fallback.choices.map(choice => choice.device), ['webgpu', 'wasm']);
});

test('estimate requires one valid numeric minutes field and reports local fallback honestly', async () => {
  const state = fixture();
  state.ai.setEnabled(true);
  for (const invalid of ['{"minutes":999}', '{"minutes":"45"}', '{"minutes":45,"extra":true}', 'Text {"minutes":45}']) {
    state.reply = invalid;
    const result = await state.ai.estimate('Задача');
    assert.equal(result.source, 'local');
    assert.equal(result.minutes, 35);
    assert.match(state.ai.getStatus(), /некорректный/);
  }
  state.reply = '```json\n{"minutes":15}\n```';
  assert.equal((await state.ai.estimate('Задача')).minutes, 15);
});

test('plan validates every action and never includes financial properties in the prompt', async () => {
  const state = fixture();
  state.ai.setEnabled(true);
  state.reply = JSON.stringify({ steps: [
    { title: 'Выбрать учебный материал', duration: 20 },
    { title: 'Разобрать один урок', duration: 45 },
    { title: 'Проверить знания', duration: 15 }
  ] });
  const result = await state.ai.plan({ title: 'Английский', outcome: 'Поддержать разговор', income: 424242, saved: 313131, expenses: [{ secret: 'never-send-ledger' }] });
  assert.equal(result.source, 'qwen');
  assert.equal(result.steps.length, 3);
  const prompt = state.prompts.at(-1);
  assert.ok(prompt.includes('Английский'));
  assert.ok(!prompt.includes('424242'));
  assert.ok(!prompt.includes('313131'));
  assert.ok(!prompt.includes('never-send-ledger'));
  const cases = [
    [{ title: 'Только один шаг', duration: 20 }],
    [{ title: 'Повтор', duration: 20 }, { title: 'Повтор', duration: 20 }, { title: 'Иное', duration: 20 }],
    [{ title: 'a'.repeat(101), duration: 20 }, { title: 'Второе', duration: 20 }, { title: 'Третье', duration: 20 }],
    [{ title: 'Первое', duration: 0 }, { title: 'Второе', duration: 20 }, { title: 'Третье', duration: 20 }]
  ];
  for (const steps of cases) {
    state.reply = JSON.stringify({ steps });
    assert.equal((await state.ai.plan({ title: 'Проект' })).source, 'local');
  }
});

test('disabling while loading prevents any inference or Qwen result', async () => {
  const loadGate = deferred();
  const state = fixture({ loadGate });
  state.ai.setEnabled(true);
  const pending = state.ai.estimate('Задача');
  await until(() => state.loads === 1);
  state.ai.setEnabled(false);
  loadGate.resolve();
  assert.equal((await pending).source, 'local');
  assert.equal(state.calls, 0);
  assert.match(state.ai.getStatus(), /выключена/);
});

test('disabling interrupts inference and invalidates queued requests even after re-enabling', async () => {
  const generationGate = deferred();
  const state = fixture({ generationGate });
  state.ai.setEnabled(true);
  const active = state.ai.estimate('Первая');
  const queued = state.ai.estimate('Вторая');
  await until(() => state.calls === 1);
  state.ai.setEnabled(false);
  state.ai.setEnabled(true);
  generationGate.resolve();
  assert.equal((await active).source, 'local');
  assert.equal((await queued).source, 'local');
  assert.equal(state.stops[0].interrupted, true);
  assert.equal(state.calls, 1);
});

test('deadline stops generation cooperatively without orphaning concurrent model calls', async () => {
  const state = fixture({ shortDeadline: true, generationDelay: 20 });
  state.ai.setEnabled(true);
  const results = await Promise.all([state.ai.estimate('Первая'), state.ai.estimate('Вторая')]);
  assert.equal(results[0].source, 'local');
  assert.equal(results[1].source, 'local');
  assert.equal(state.maximumActive, 1);
  assert.ok(state.stops.every(stop => stop.interrupted));
  assert.match(state.ai.getStatus(), /90 секунд/);
});

test('status subscriptions receive strings immediately and can unsubscribe', () => {
  const state = fixture();
  const messages = [];
  const unsubscribe = state.ai.subscribe(message => messages.push(message));
  assert.equal(typeof messages[0], 'string');
  state.ai.setEnabled(true);
  assert.equal(messages.length, 2);
  unsubscribe();
  state.ai.setEnabled(false);
  assert.equal(messages.length, 2);
});
