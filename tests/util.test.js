const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const S = require('../js/store.js');

test('week belongs to the month of its last day (planner convention)', () => {
  // Sun Sep 27 2026 – Sat Oct 3 2026 is "Week 1 of October"
  const w = U.weekOfMonth(U.parseISO('2026-09-27'));
  assert.equal(w.n, 1);
  assert.equal(w.monthKey, '2026-10');
  assert.equal(U.weekOfMonth(U.parseISO('2026-10-25')).n, 5);
});

test('weekKey uses Sunday start by default', () => {
  assert.equal(U.weekKey(U.parseISO('2026-11-10')), '2026-11-08');
  assert.equal(U.weekKey(U.parseISO('2026-11-10'), 1), '2026-11-09');
});

test('weeksOfMonth lists weeks ending in the month', () => {
  const weeks = U.weeksOfMonth('2026-10').map(U.toISO);
  assert.deepEqual(weeks, ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
});

test('planner months start in October', () => {
  const m = U.plannerMonths(2026, 9);
  assert.equal(m[0].key, '2026-10');
  assert.equal(m[0].index, 1);
  assert.equal(m[11].key, '2027-09');
  assert.deepEqual(U.plannerYearStart(U.parseISO('2027-03-01'), 9), { year: 2026, month: 9 });
});

test('events: ranges and yearly recurrence', () => {
  const range = { start: '2026-12-24', end: '2027-01-02' };
  assert.ok(U.eventOn(range, '2026-12-31'));
  assert.ok(!U.eventOn(range, '2027-01-03'));
  const bday = { start: '2020-11-01', yearly: true };
  assert.ok(U.eventOn(bday, '2026-11-01'));
  assert.equal(U.nextOccurrence(bday, '2026-11-10'), '2027-11-01');
  const yearlyWrap = { start: '2020-12-30', end: '2021-01-02', yearly: true };
  assert.ok(U.eventOn(yearlyWrap, '2027-01-01'));
});

test('cycle dates and lookup', () => {
  const d = U.makeCycleDates('2026-10-01', 6);
  assert.deepEqual(d, { start: '2026-10-01', end: '2027-03-31' });
  assert.equal(U.cycleContaining([{ id: 'a', ...d }], '2026-12-01').id, 'a');
  assert.equal(U.cycleContaining([{ id: 'a', ...d }], '2027-04-01'), null);
});

test('store paths resolve @id segments and create objects', () => {
  const st = S.defaultState();
  st.goals.push({ id: 'g1', title: 'x' });
  S.setPath(st, 'goals.@g1.title', 'Date night each month');
  assert.equal(st.goals[0].title, 'Date night each month');
  S.setPath(st, 'months.2026-10.ideas', 'hello');
  assert.equal(S.getPath(st, 'months.2026-10.ideas'), 'hello');
  assert.equal(S.setPath(st, 'goals.@missing.title', 'nope'), false);
});
