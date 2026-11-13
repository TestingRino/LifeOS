const test = require('node:test');
const assert = require('node:assert');
const ICS = require('../js/ics.js');

const wrap = (...ev) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const vev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

test('reads timed, all-day and multi-day events with unfolding and escapes', () => {
  const r = ICS.parse(wrap(
    vev('UID:a', 'DTSTART:20261112T093000', 'DTEND:20261112T104500', 'SUMMARY:Team standup\\, weekly', 'DESCRIPTION:Bring notes\\nand coffee', 'LOCATION:Room 4'),
    vev('UID:b', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261123', 'SUMMARY:Retreat'),
    vev('UID:c', 'DTSTART;TZID=Eastern Standard Time:20261113T140000', 'DURATION:PT1H30M', 'SUMMARY:Call with a very long title that goes on and', ' on forever'),
  ));
  assert.strictEqual(r.events.length, 3);
  const [a, c, b] = r.events;
  assert.deepStrictEqual([a.date, a.time, a.mins, a.text, a.where], ['2026-11-12', '09:30', 75, 'Team standup, weekly', 'Room 4']);
  assert.match(a.notes, /Bring notes\nand coffee/);
  assert.strictEqual(c.time, '14:00'); assert.strictEqual(c.mins, 90); assert.match(c.text, /forever$/);
  assert.deepStrictEqual([b.allDay, b.date, b.endDate], [true, '2026-11-20', '2026-11-22']);
});

test('UTC times are converted to the viewer local time', () => {
  const r = ICS.parse(wrap(vev('UID:z', 'DTSTART:20261112T150000Z', 'DTEND:20261112T160000Z', 'SUMMARY:Utc')));
  const d = new Date(Date.UTC(2026, 10, 12, 15, 0));
  assert.strictEqual(r.events[0].time, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  assert.strictEqual(r.events[0].mins, 60);
});

test('weekly repeats honour BYDAY, INTERVAL, COUNT, UNTIL and EXDATE', () => {
  const dates = (rule, extra = [], from = '2026-11-01', to = '2026-12-31') =>
    ICS.parse(wrap(vev('UID:r', 'DTSTART:20261102T090000', 'SUMMARY:Run', `RRULE:${rule}`, ...extra)), { from, to }).events.map((e) => e.date);
  assert.deepStrictEqual(dates('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4'), ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
  assert.deepStrictEqual(dates('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261130T000000Z'), ['2026-11-02', '2026-11-16', '2026-11-30']);
  assert.deepStrictEqual(dates('FREQ=DAILY;COUNT=3', ['EXDATE:20261103T090000']), ['2026-11-02', '2026-11-04']);
});

test('monthly by day number, by ordinal weekday, and yearly', () => {
  const ev = (rule, start = '20261102') => ICS.parse(wrap(vev('UID:m', `DTSTART;VALUE=DATE:${start}`, 'SUMMARY:X', `RRULE:${rule}`)), { from: '2026-11-01', to: '2027-02-28' }).events.map((e) => e.date);
  assert.deepStrictEqual(ev('FREQ=MONTHLY;BYDAY=2TU'), ['2026-11-10', '2026-12-08', '2027-01-12', '2027-02-09']);
  assert.deepStrictEqual(ev('FREQ=MONTHLY;BYDAY=-1FR'), ['2026-11-27', '2026-12-25', '2027-01-29', '2027-02-26']);
  assert.deepStrictEqual(ev('FREQ=MONTHLY;BYMONTHDAY=31'), ['2026-12-31', '2027-01-31']);
  assert.deepStrictEqual(ev('FREQ=YEARLY', '20201215'), ['2026-12-15']);
});

test('edited or cancelled single instances replace the series instance', () => {
  const r = ICS.parse(wrap(
    vev('UID:s', 'DTSTART:20261102T090000', 'SUMMARY:Sync', 'RRULE:FREQ=WEEKLY;COUNT=3'),
    vev('UID:s', 'RECURRENCE-ID:20261109T090000', 'DTSTART:20261109T110000', 'SUMMARY:Sync (moved)'),
    vev('UID:x', 'DTSTART:20261110T090000', 'SUMMARY:Gone', 'STATUS:CANCELLED'),
  ), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepStrictEqual(r.events.map((e) => `${e.date} ${e.time} ${e.text}`), ['2026-11-02 09:00 Sync', '2026-11-09 11:00 Sync (moved)', '2026-11-16 09:00 Sync']);
  assert.strictEqual(r.skipped, 1);
});

test('the window drops events outside it and caps endless repeats', () => {
  const r = ICS.parse(wrap(vev('UID:e', 'DTSTART:20250101T090000', 'SUMMARY:Daily', 'RRULE:FREQ=DAILY')), { from: '2026-11-01', to: '2027-12-31', cap: 50 });
  assert.strictEqual(r.events.length, 50); assert.strictEqual(r.truncated, true);
});

test('written files round-trip through the reader', () => {
  const out = ICS.build([
    { id: 'p1', text: 'Dentist, 2nd floor', date: '2026-11-12', time: '09:30', mins: 45, notes: 'Bring forms;\nbring card' },
    { id: 'p2', text: 'Birthday', date: '2026-11-14' },
    { id: 'p3', text: 'Late call', date: '2026-11-12', time: '23:45', mins: 30 },
    { id: 'p4', text: 'Morning run', date: '2026-11-16', time: '06:30', mins: 40, weekly: { byday: 'MO', until: '2026-12-31' } },
  ], { name: 'Telos week', now: new Date(Date.UTC(2026, 10, 12)) });
  assert.match(out, /^BEGIN:VCALENDAR\r\n/); assert.match(out, /END:VCALENDAR\r\n$/);
  assert.ok(out.split('\r\n').every((l) => l.length <= 75), 'lines are folded');
  assert.match(out, /DTEND:20261113T001500/); assert.match(out, /TRIGGER:-PT10M/); assert.match(out, /RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231/);
  const back = ICS.parse(out, { from: '2026-11-01', to: '2026-12-31' }).events;
  const first = back.find((e) => e.text.startsWith('Dentist'));
  assert.deepStrictEqual([first.text, first.date, first.time, first.mins], ['Dentist, 2nd floor', '2026-11-12', '09:30', 45]);
  assert.match(first.notes, /Bring forms;\nbring card/);
  assert.strictEqual(back.find((e) => e.text === 'Birthday').allDay, true);
  assert.strictEqual(back.filter((e) => e.text === 'Morning run').length, 7);
});
