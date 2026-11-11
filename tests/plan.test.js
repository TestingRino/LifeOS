const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/plan.js');

test('nextDue: daily, weekly, monthly, yearly', () => {
  assert.strictEqual(P.nextDue({ freq: 'daily', every: 2 }, '2026-03-01'), '2026-03-03');
  assert.strictEqual(P.nextDue({ freq: 'weekly', dows: [1, 3], every: 1 }, '2026-03-02'), '2026-03-04'); // Mon -> Wed
  assert.strictEqual(P.nextDue({ freq: 'weekly', dows: [1, 3], every: 1 }, '2026-03-04'), '2026-03-09'); // Wed -> next Mon
  assert.strictEqual(P.nextDue({ freq: 'weekly', dows: [1], every: 2 }, '2026-03-02'), '2026-03-16');
  assert.strictEqual(P.nextDue({ freq: 'monthly', dom: 1 }, '2026-03-01'), '2026-04-01');
  assert.strictEqual(P.nextDue({ freq: 'monthly', dom: 31 }, '2026-01-31'), '2026-02-28');
  assert.strictEqual(P.nextDue({ freq: 'yearly' }, '2024-02-29'), '2025-02-28');
});
test('nextDue: after-completion mode and until', () => {
  assert.strictEqual(P.nextDue({ freq: 'daily', every: 3, mode: 'after' }, '2026-03-01', '2026-03-10'), '2026-03-13');
  assert.strictEqual(P.nextDue({ freq: 'daily', until: '2026-03-02' }, '2026-03-02'), '');
});
test('parseQuick', () => {
  const p = P.parseQuick('Call dentist friday !high #health +Admin', '2026-03-02'); // Monday
  assert.deepStrictEqual([p.title, p.due, p.priority, p.tags, p.project], ['Call dentist', '2026-03-06', 'high', ['health'], 'Admin']);
  assert.strictEqual(P.parseQuick('Pay rent monthly on the 1st', '2026-03-02').recur.dom, 1);
  assert.strictEqual(P.parseQuick('Take out trash every monday', '2026-03-02').due, '2026-03-02');
  assert.strictEqual(P.parseQuick('Email Sam @waiting tomorrow', '2026-03-02').status, 'waiting');
  assert.strictEqual(P.parseQuick('Plan trip in 2 weeks', '2026-03-02').due, '2026-03-16');
  assert.strictEqual(P.parseQuick('Buy milk', '2026-03-02').due, '');
});
test('rollover skips recurring, waiting, someday and done', () => {
  const tasks = [
    { id: 1, title: 'a', status: 'next', day: '2026-03-02' },
    { id: 2, title: 'b', status: 'next', due: '2026-03-01' },
    { id: 3, title: 'c', status: 'next', day: '2026-03-02', recur: { freq: 'daily' } },
    { id: 4, title: 'd', status: 'waiting', day: '2026-03-02' },
    { id: 5, title: 'e', status: 'done', day: '2026-03-02' },
    { id: 6, title: 'f', status: 'next', due: '2026-03-20' },
  ];
  const n = P.rollTasks(tasks, '2026-03-02', '2026-03-03');
  assert.strictEqual(n, 2);
  assert.strictEqual(tasks[0].day, '2026-03-03');
  assert.strictEqual(tasks[1].due, '2026-03-03');
  assert.strictEqual(tasks[2].day, '2026-03-02');
});
test('search ranks title matches and supports type filters', () => {
  const st = { tasks: [{ id: 't1', title: 'Call the dentist', status: 'next' }, { id: 't2', title: 'Buy gift', notes: 'for dentist visit', status: 'next' }], goals: [{ id: 'g1', title: 'Dentist fund', cycleId: 'c' }], foundation: { legacy: 'Help people' } };
  const idx = P.buildIndex(st);
  const r = P.search(idx, 'dentist');
  assert.strictEqual(r.length, 3);
  assert.ok(r[0].title.toLowerCase().includes('dentist'));
  assert.strictEqual(P.search(idx, 'task: dentist').length, 2);
  assert.strictEqual(P.search(idx, 'help')[0].type, 'Foundation');
});
test('lifeArea maps legacy areas sensibly', () => {
  assert.strictEqual(P.lifeArea('health', 'Healthy person', 'Run a 10K', true), 'fitness');
  assert.strictEqual(P.lifeArea('home', 'Money steward', 'Save a three-month emergency fund', true), 'finances');
  assert.strictEqual(P.lifeArea('friends', 'Family', 'Call Dad', true), 'family');
  assert.strictEqual(P.lifeArea('health', 'Person of faith', 'Deepen my prayer life', true), 'faith');
  assert.strictEqual(P.lifeArea('learning'), 'learning');
  assert.strictEqual(P.lifeArea('home', 'Parent', 'Tidy', false), 'home');
});
test('summarize counts completed work in a period', () => {
  const st = { tasks: [{ title: 'x', status: 'done', doneAt: '2026-03-03' }, { title: 'y', status: 'done', doneAt: '2026-04-03' }], goals: [{ id: 'g', title: 'G', kind: 'achievement', milestones: [{ text: 'm', done: true, doneAt: '2026-03-04' }], history: [{ date: '2026-02-20', v: 10 }, { date: '2026-03-05', v: 40 }] }], big3: [], workouts: [], weeks: {}, months: {} };
  const s = P.summarize(st, '2026-03-01', '2026-03-31');
  assert.strictEqual(s.done.tasks.length, 1);
  assert.strictEqual(s.done.milestones.length, 1);
  assert.deepStrictEqual([s.moved[0].from, s.moved[0].to], [10, 40]);
  assert.match(P.summaryMarkdown(s, 'March'), /Tasks finished \(1\)/);
});
test('templates expand with offsets', () => {
  const trip = P.TEMPLATES.find((t) => t.id === 'tpl-trip');
  const rows = P.expandTemplate(trip, '2026-06-10', 'Paris');
  assert.strictEqual(rows[0].due, '2026-04-11');
  assert.strictEqual(rows[rows.length - 1].due, '2026-06-10');
  assert.strictEqual(rows[0].project, 'Paris');
});
test('period helpers', () => {
  assert.strictEqual(P.period('month', '2026-03-15').to, '2026-03-31');
  assert.strictEqual(P.period('quarter', '2026-05-01').from, '2026-04-01');
  assert.strictEqual(P.shiftPeriod('month', '2026-03-15', -1), '2026-02-01');
});

test('store.migrate moves inbox to-dos into tasks and maps old areas', () => {
  const S = require('../js/store.js');
  const m = S.migrate({ roles: [{ id: 'r1', name: 'Family' }, { id: 'r2', name: 'Healthy person' }], goals: [{ id: 'g', roleId: 'r1', title: 'Call Dad', area: 'friends' }, { id: 'h', roleId: 'r2', title: 'Run', area: 'health' }],
    inbox: [{ id: 'a', kind: 'todo', text: 'Buy milk', date: '2026-03-01', done: false }, { id: 'b', kind: 'goal', text: 'Idea' }], wheel: [{ id: 'w', date: '2026-01-01', scores: { physical: 7, financial: 4, social: 6, mental: 8 } }] });
  assert.strictEqual(m.tasks.length, 1);
  assert.strictEqual(m.tasks[0].title, 'Buy milk');
  assert.strictEqual(m.inbox.length, 1);
  assert.strictEqual(m.goals[0].area, 'family');
  assert.strictEqual(m.goals[1].area, 'fitness');
  assert.strictEqual(m.wheel[0].scores.fitness, 7);
  assert.strictEqual(m.wheel[0].scores.finances, 4);
  const again = S.migrate(JSON.parse(JSON.stringify(m)));
  assert.strictEqual(again.goals[1].area, 'fitness');
});

test('merge keeps additions from both devices and does not resurrect deletions', () => {
  const local = { goals: [{ id: 'a', title: 'A' }, { id: 'c', title: 'only local' }], tasks: [], tomb: { b: '2026-03-02' } };       // deleted b here
  const remote = { goals: [{ id: 'a', title: 'A remote' }, { id: 'b', title: 'B' }, { id: 'd', title: 'only remote' }], tasks: [{ id: 't', title: 'x' }], tomb: { t: '2026-03-01' } }; // t deleted there
  const m = P.mergeStates(local, remote);
  assert.deepStrictEqual(m.goals.map((g) => g.id).sort(), ['a', 'c', 'd']);
  assert.strictEqual(m.goals.find((g) => g.id === 'a').title, 'A');          // local wins on a clash
  assert.strictEqual(m.tasks.length, 0);                                      // remote deletion respected
  assert.deepStrictEqual(Object.keys(m.tomb).sort(), ['b', 't']);
});
test('recordDeletions tombstones removed ids and clears returned ones', () => {
  const tomb = { old: '2020-01-01', back: '2026-03-01' };
  P.recordDeletions(tomb, new Set(['x', 'y', 'back']), new Set(['x', 'back']), '2026-03-10');
  assert.strictEqual(tomb.y, '2026-03-10');
  assert.ok(!('back' in tomb));
  assert.ok(!('old' in tomb));                                                // expired
});
test('idsOf finds nested ids and ignores trash and tombstones', () => {
  const ids = P.idsOf({ goals: [{ id: 'g', milestones: [{ id: 'm' }] }], weeks: { w1: { actions: [{ id: 'a1' }] } }, trash: [{ id: 'gone', item: { id: 'gone' } }], tomb: { z: 1 } });
  assert.deepStrictEqual([...ids].sort(), ['a1', 'g', 'm']);
});
