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

test('planDates repeats chosen weekdays for N weeks from the start date', () => {
  // 2026-11-10 is a Tuesday; Mon(1) and Wed(3) over 2 weeks
  const d = U.planDates('2026-11-10', 2, [1, 3]).map((x) => x.date);
  assert.deepEqual(d, ['2026-11-11', '2026-11-16', '2026-11-18', '2026-11-23']);
  assert.deepEqual(U.planDates('2026-11-10', 1, [2]).map((x) => x.date), ['2026-11-10']);
});

test('parseWorkoutText handles CSV, loose dates, minutes, times and bad lines', () => {
  const r = U.parseWorkoutText('Date,Workout,Minutes\n2026-11-12, Run, 40, easy pace\n11/14, Lift, 6:30, 45 min, legs\nNov 16 2026;Ride;60\nnonsense line', 2026);
  assert.equal(r.workouts.length, 3);
  assert.deepEqual(r.workouts[0], { date: '2026-11-12', type: 'Run', minutes: 40, details: 'easy pace', time: '' });
  assert.equal(r.workouts[1].date, '2026-11-14');
  assert.equal(r.workouts[1].time, '06:30');
  assert.equal(r.workouts[1].minutes, 45);
  assert.equal(r.workouts[1].details, 'legs');
  assert.equal(r.workouts[2].date, '2026-11-16');
  assert.deepEqual(r.bad, ['nonsense line']);
});

test('parseWorkoutText reads .ics events', () => {
  const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261112T170000\nDTEND:20261112T174500\nSUMMARY:Spin class\nDESCRIPTION:Coach Sam\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261114\nSUMMARY:Long run\nEND:VEVENT\nEND:VCALENDAR';
  const r = U.parseWorkoutText(ics, 2026).workouts;
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].date, r[0].time, r[0].minutes, r[0].type], ['2026-11-12', '17:00', 45, 'Spin class']);
  assert.deepEqual([r[1].date, r[1].time, r[1].type], ['2026-11-14', '', 'Long run']);
});
