/* Calendar files (.ics): read events from any calendar app (Outlook, Apple Calendar, Google, Fastmail...) and write them back out.
   Pure functions, no DOM. Loaded as window.LifeICS in the browser and with require() in tests.
   Times without a zone, and times in a named zone (Outlook writes Windows zone names we cannot convert), are kept as the wall-clock time
   written in the file. Times in UTC ("Z") are converted to the viewer's local time. */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;      // d is a "UTC-as-calendar" date
  const utcDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const addDays = (s, n) => { const d = utcDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dow = (s) => utcDate(s).getUTCDay();
  const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const unesc = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

  /* ---------- reading ---------- */
  function props(block) {
    const out = {};
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(':'); if (i < 1) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const p = {}; params.forEach((x) => { const [k, v] = x.split('='); if (k) p[k.toUpperCase()] = (v || '').replace(/"/g, ''); });
      (out[name.toUpperCase()] = out[name.toUpperCase()] || []).push({ params: p, value: line.slice(i + 1) });
    }
    return out;
  }
  /* "20261112", "20261112T093000", "20261112T093000Z" -> { date, time, allDay, utc } with local conversion for Z */
  function dt(prop) {
    if (!prop) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/.exec(prop.value.trim());
    if (!m) return null;
    if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '', allDay: true };
    if (m[7]) {      // UTC: show it in the viewer's own time
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false };
    }
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false };
  }
  const minsBetween = (a, b) => (a.date === b.date && a.time && b.time ? (+b.time.slice(0, 2) * 60 + +b.time.slice(3)) - (+a.time.slice(0, 2) * 60 + +a.time.slice(3)) : 0);
  function duration(v) {
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec((v || '').trim()); if (!m) return 0;
    return (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }

  /* All start dates of a repeating event inside [from, to] (ISO dates), at most `cap`. Supports DAILY, WEEKLY(+BYDAY), MONTHLY(+BYMONTHDAY / BYDAY with a number) and YEARLY. */
  function expand(start, rule, from, to, exdates, cap) {
    const r = {}; String(rule).split(';').forEach((kv) => { const [k, v] = kv.split('='); if (k) r[k.toUpperCase()] = v; });
    const freq = r.FREQ, step = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
    const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : '';
    const by = r.BYDAY ? r.BYDAY.split(',') : [];
    const out = [], hardEnd = until && until < to ? until : to;
    let n = 0;
    const take = (d) => { n++; if (d >= from && d <= hardEnd && !exdates.has(d)) out.push(d); };
    const okEnd = (d) => d <= hardEnd && (!count || n < count) && out.length < cap;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [start];
    if (freq === 'DAILY') {
      for (let d = start; okEnd(d); d = addDays(d, step)) take(d);
    } else if (freq === 'WEEKLY') {
      const days = by.length ? by.map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((x) => x >= 0) : [dow(start)];
      const wkStart = addDays(start, -dow(start));
      for (let w = wkStart; w <= hardEnd && (!count || n < count) && out.length < cap; w = addDays(w, 7 * step)) {
        for (const d of days.slice().sort((a, b) => a - b)) { const day = addDays(w, d); if (day < start) continue; if (count && n >= count) break; take(day); }
      }
    } else if (freq === 'MONTHLY') {
      const sd = utcDate(start);
      for (let k = 0; ; k += step) {
        const y = sd.getUTCFullYear(), mo = sd.getUTCMonth() + k, first = new Date(Date.UTC(y, mo, 1)), len = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        if (iso(first) > hardEnd || (count && n >= count) || out.length >= cap) break;
        let day = null;
        const m = by[0] && /^(-?\d)?([A-Z]{2})$/.exec(by[0]);
        if (m && m[1]) {      // "2TU" = second Tuesday, "-1FR" = last Friday
          const want = DAY_CODES.indexOf(m[2]), num = +m[1], list = [];
          for (let d = 1; d <= len; d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === want) list.push(d);
          day = num > 0 ? list[num - 1] : list[list.length + num];
        } else day = r.BYMONTHDAY ? +r.BYMONTHDAY.split(',')[0] : sd.getUTCDate();
        if (!day || day > len) continue;
        const d = iso(new Date(Date.UTC(y, mo, day))); if (d < start) continue; take(d);
      }
    } else {
      const sd = utcDate(start);
      for (let k = 0; ; k += step) {
        const d = iso(new Date(Date.UTC(sd.getUTCFullYear() + k, sd.getUTCMonth(), sd.getUTCDate())));
        if (d > hardEnd || (count && n >= count) || out.length >= cap) break; take(d);
      }
    }
    return out;
  }

  function parse(text, opts) {
    const o = opts || {}, src = String(text || '').replace(/\r?\n[ \t]/g, '');
    const from = o.from || '0000-01-01', to = o.to || '9999-12-31', cap = o.cap || 400;
    const blocks = src.split(/BEGIN:VEVENT/i).slice(1).map((b) => b.split(/END:VEVENT/i)[0]);
    const overridden = new Set(), events = [];
    let skipped = 0, truncated = false;
    const parsed = blocks.map((b) => props(b));
    parsed.forEach((p) => { const rid = p['RECURRENCE-ID'] && dt(p['RECURRENCE-ID'][0]); if (rid && p.UID) overridden.add(`${p.UID[0].value}|${rid.date}`); });
    for (const p of parsed) {
      const val = (k) => (p[k] ? p[k][0].value : '');
      const st = dt(p.DTSTART && p.DTSTART[0]);
      if (!st || !val('SUMMARY') || /CANCELLED/i.test(val('STATUS'))) { skipped++; continue; }
      const en = dt(p.DTEND && p.DTEND[0]);
      let mins = en ? minsBetween(st, en) : duration(val('DURATION'));
      let endDate = '';
      if (st.allDay) { endDate = en && en.date > st.date ? addDays(en.date, -1) : ''; if (endDate && endDate <= st.date) endDate = ''; mins = 0; }
      const base = { text: unesc(val('SUMMARY')), time: st.time, mins: mins > 0 ? mins : '', allDay: st.allDay, notes: unesc(val('DESCRIPTION')).slice(0, 300), where: unesc(val('LOCATION')), uid: val('UID') };
      if (p.RRULE && !p['RECURRENCE-ID']) {
        const ex = new Set(); (p.EXDATE || []).forEach((x) => x.value.split(',').forEach((v) => { const d = dt({ value: v }); if (d) ex.add(d.date); }));
        const dates = expand(st.date, val('RRULE'), from, to, ex, cap);
        if (dates.length >= cap) truncated = true;
        dates.forEach((d) => { if (!overridden.has(`${base.uid}|${d}`)) events.push({ ...base, date: d, endDate: endDate ? addDays(d, Math.round((utcDate(endDate) - utcDate(st.date)) / 864e5)) : '' }); });
      } else if ((endDate || st.date) >= from && st.date <= to) events.push({ ...base, date: st.date, endDate });
    }
    events.sort((a, b) => ((a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1));
    return { events, skipped, truncated };
  }

  /* ---------- writing ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {
    const out = []; let cur = '';
    for (const ch of line) {
      if ((cur + ch).length > 70) { out.push(cur); cur = ' ' + ch; } else cur += ch;
    }
    out.push(cur); return out.join('\r\n');
  }
  const ymd = (s) => s.replace(/-/g, '');
  const hm = (t) => t.replace(':', '') + '00';
  const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  /* items: { id, text, date 'YYYY-MM-DD', time 'HH:MM'|'', mins, allDay, endDate, notes, where, weekly:{ byday:'MO', until:'YYYY-MM-DD' } } */
  function build(items, opts) {
    const o = opts || {}, now = o.now || new Date();
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Telos//Planning for what matters//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(o.name || 'Telos')}`];
    items.forEach((it, i) => {
      if (!it.text || !it.date) return;
      L.push('BEGIN:VEVENT', `UID:${(it.id || `${it.date}-${i}`)}-${ymd(it.date)}@telos`, `DTSTAMP:${stamp(now)}`);
      if (!it.time || it.allDay) {
        L.push(`DTSTART;VALUE=DATE:${ymd(it.date)}`, `DTEND;VALUE=DATE:${ymd(addDays(it.endDate && it.endDate > it.date ? it.endDate : it.date, 1))}`);
      } else {
        const mins = Number(it.mins) > 0 ? Number(it.mins) : 30, s = +it.time.slice(0, 2) * 60 + +it.time.slice(3), e = s + mins;
        const endDay = addDays(it.date, Math.floor(e / 1440)), em = e % 1440;
        L.push(`DTSTART:${ymd(it.date)}T${hm(it.time)}`, `DTEND:${ymd(endDay)}T${pad(Math.floor(em / 60))}${pad(em % 60)}00`);
      }
      if (it.weekly) L.push(`RRULE:FREQ=WEEKLY;BYDAY=${it.weekly.byday}${it.weekly.until ? `;UNTIL=${ymd(it.weekly.until)}` : ''}`);
      L.push(`SUMMARY:${esc(it.text)}`);
      if (it.notes) L.push(`DESCRIPTION:${esc(it.notes)}`);
      if (it.where) L.push(`LOCATION:${esc(it.where)}`);
      if (it.time && !it.allDay && o.alarm !== 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.text)}`, `TRIGGER:-PT${o.alarm || 10}M`, 'END:VALARM');
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  const api = { parse, build, expand, DAY_CODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LifeICS = api;
})(typeof window !== 'undefined' ? window : globalThis);
