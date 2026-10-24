(function (root, factory) {
  'use strict';
  var core = typeof module === 'object' && module.exports ? require('./assistant-core.js') : root.HVFCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFPlanner = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  function priorityValue(taskOrValue) {
    var value = taskOrValue && typeof taskOrValue === 'object' ? taskOrValue.priority : taskOrValue;
    if (value === undefined || value === null || value === '') return 1;
    var number = Number(value);
    return number === 0 || number === 1 || number === 2 ? number : 1;
  }

  // Parse civil dates in UTC so week boundaries do not depend on a device's
  // timezone or on daylight-saving transitions. Reject JS Date's rollover.
  function dateObject(value) {
    if (typeof value !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value)) return null;
    var year = Number(value.slice(0, 4));
    if (year < 1) return null;
    var result = new Date(0);
    result.setUTCFullYear(year, Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
    result.setUTCHours(0, 0, 0, 0);
    return result.toISOString().slice(0, 10) === value ? result : null;
  }

  function validDate(value) { return dateObject(value) !== null; }

  function nextDate(value) {
    var date = dateObject(value);
    if (!date || value === '9999-12-31') return '';
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function routineTaskId(routineId, date) { return 'routine:' + routineId + ':' + date; }
  function routineSkipId(routineId, date) { return 'skip:' + routineId + ':' + date; }

  function validateRoutine(routine) {
    var r = routine || {};
    var errors = [];
    if (typeof r.id !== 'string' || !r.id) errors.push('У повторяющегося дела должен быть id.');
    if (typeof r.title !== 'string' || !r.title.trim()) errors.push('Укажи название дела.');
    if (!Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.some(function (day) {
      return !Number.isInteger(day) || day < 1 || day > 7;
    })) errors.push('Выбери дни недели.');
    if (!validDate(r.startDate)) errors.push('Укажи корректную дату начала.');
    if (r.untilDate && (!validDate(r.untilDate) || r.untilDate < r.startDate)) errors.push('Дата окончания должна быть не раньше начала.');
    if (r.time !== undefined && r.time !== null && r.time !== '' &&
        (typeof r.time !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(r.time))) errors.push('Укажи время в формате ЧЧ:ММ.');
    if (r.duration !== undefined && r.duration !== null && r.duration !== '' &&
        (!Number.isInteger(Number(r.duration)) || Number(r.duration) < 5 || Number(r.duration) > 480)) errors.push('Длительность должна быть от 5 до 480 минут.');
    return { valid: errors.length === 0, errors: errors };
  }

  function activeRecords(records) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return record && typeof record === 'object' && !record.deleted;
    });
  }

  function occurrenceKey(routineId, date) { return JSON.stringify([routineId, date]); }

  function timestamp(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function laterOverride(a, b) {
    var movedDifference = timestamp(a.lastMovedAt) - timestamp(b.lastMovedAt);
    if (movedDifference) return movedDifference > 0;
    var updatedDifference = timestamp(a.updatedAt) - timestamp(b.updatedAt);
    if (updatedDifference) return updatedDifference > 0;
    return String(a.id) > String(b.id);
  }

  function createdTime(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function logicalTaskId(task) {
    return task.routineId && validDate(task.occurrenceDate)
      ? routineTaskId(task.routineId, task.occurrenceDate) : String(task.id || '');
  }

  /** Compose a day without writing future occurrences to storage. An explicit
   * task overrides its original occurrence even if moved to a different month.
   * A skip is a live record because the store does not expose tombstones.
   */
  function tasksForDay(records, date) {
    var civilDate = dateObject(date);
    if (!civilDate) return [];
    var active = activeRecords(records);
    var routines = new Map();
    active.forEach(function (record) {
      if (record.kind === 'routine') routines.set(record.id, record);
    });
    var skipped = new Set();
    var skippedIds = new Set();
    active.forEach(function (record) {
      if (record.kind === 'routine-skip' && record.routineId) {
        var originalDate = record.occurrenceDate || record.date;
        skipped.add(occurrenceKey(record.routineId, originalDate));
        skippedIds.add(routineTaskId(record.routineId, originalDate));
      }
    });
    // A cross-month move is written as destination then source deletion. During
    // this short overlap, choose one occurrence globally before selecting a day.
    var winners = new Map();
    var allTasks = active.filter(function (record) { return record.kind === 'task'; });
    allTasks.forEach(function (record) {
      if (!record.routineId || !validDate(record.occurrenceDate)) return;
      var key = occurrenceKey(record.routineId, record.occurrenceDate);
      var previous = winners.get(key);
      if (!previous || laterOverride(record, previous)) winners.set(key, record);
    });
    var explicit = allTasks.filter(function (record) {
      if (skippedIds.has(record.id)) return false;
      if (!record.routineId || !validDate(record.occurrenceDate)) return true;
      var key = occurrenceKey(record.routineId, record.occurrenceDate);
      return !skipped.has(key) && winners.get(key) === record;
    });
    var occupied = new Set();
    var explicitIds = new Set();
    explicit.forEach(function (record) {
      explicitIds.add(record.id);
      if (record.routineId && validDate(record.occurrenceDate)) occupied.add(occurrenceKey(record.routineId, record.occurrenceDate));
    });
    skipped.forEach(function (key) { occupied.add(key); });
    var result = explicit.filter(function (record) { return record.date === date; }).map(function (record) {
      var copy = Object.assign({}, record);
      // Completion materializes an occurrence. Its place in the input order is
      // still the series' creation time, including legacy series with no stamp.
      if (routines.has(record.routineId)) copy.createdAt = createdTime(routines.get(record.routineId).createdAt);
      return copy;
    });
    var weekday = civilDate.getUTCDay() || 7;
    var seen = new Set();
    active.forEach(function (routine) {
      if (routine.kind !== 'routine' || routine.active === false || seen.has(routine.id) || !validateRoutine(routine).valid ||
          date < routine.startDate || (routine.untilDate && date > routine.untilDate) || routine.weekdays.indexOf(weekday) < 0) return;
      seen.add(routine.id);
      var id = routineTaskId(routine.id, date);
      if (explicitIds.has(id) || occupied.has(occurrenceKey(routine.id, date))) return;
      result.push({
        id: id, kind: 'task', month: date.slice(0, 7), date: date,
        title: routine.title, duration: routine.duration === undefined ? '' : routine.duration,
        time: routine.time || '', priority: priorityValue(routine), done: false,
        routineId: routine.id, occurrenceDate: date, virtual: true,
        createdAt: createdTime(routine.createdAt), estimated: Boolean(routine.estimated),
        estimateSource: routine.estimateSource || (routine.estimated ? 'local' : 'manual')
      });
    });
    return result.sort(function (a, b) {
      var difference = createdTime(a.createdAt) - createdTime(b.createdAt);
      if (difference) return difference;
      var aId = logicalTaskId(a), bId = logicalTaskId(b);
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
  }

  /** A preview only: the caller applies the returned moved records on confirm.
   * Explicit times are preserved, so conflicting appointments remain visible in
   * the preview. Cross-month persistence needs a new id under the existing store.
   */
  function prepareMove(records, fromDate, toDate, options) {
    if (!validDate(fromDate) || !validDate(toDate)) throw new Error('Для переноса нужны корректные даты.');
    options = options || {};
    var selected = Array.isArray(options.taskIds) ? new Set(options.taskIds) : null;
    var candidates = fromDate === toDate ? [] : tasksForDay(records, fromDate).filter(function (task) {
      return !task.done && (!selected || selected.has(task.id));
    });
    var moved = candidates.map(function (task) {
      var priorCount = Number(task.moveCount);
      if (!Number.isFinite(priorCount)) priorCount = 0;
      var copy = Object.assign({}, task, {
        date: toDate, month: toDate.slice(0, 7),
        time: options.resetTimes ? '' : (task.time || ''),
        moveCount: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(priorCount)) + 1),
        movedFromDate: fromDate
      });
      delete copy.virtual;
      delete copy.start;
      delete copy.end;
      return copy;
    });
    var existing = tasksForDay(records, toDate);
    var schedule = typeof options.schedule === 'function' ? options.schedule : core.schedule;
    var result = schedule(existing.concat(moved), options);
    return {
      candidates: candidates, moved: moved, existing: existing,
      placed: result.placed, waiting: result.waiting, conflicts: result.conflicts
    };
  }

  return Object.freeze({
    priorityValue: priorityValue, validDate: validDate, nextDate: nextDate,
    routineTaskId: routineTaskId, routineSkipId: routineSkipId,
    validateRoutine: validateRoutine, tasksForDay: tasksForDay, prepareMove: prepareMove
  });
}));
