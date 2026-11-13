/* Reminders that reach your phone when Telos is closed: web push, a morning digest, and an email fallback.
   The server (server/routes/reminders.js) sends them; this file turns notifications on, and keeps the server's small
   "what is coming up" snapshot current. The snapshot holds only today and the next two days (Big 3, task and event titles
   from Telos itself; Google Calendar events are never included). */
(function (root) {
  root.LifeRemind = function (ctx) {
    const DEFAULTS = { digestTime: '08:30', leadMin: 10, push: false, email: false };
    const rs = () => Object.assign({}, DEFAULTS, ctx.state().settings.remind || {});
    const set = (patch) => { const s = ctx.state(); s.settings.remind = Object.assign(rs(), patch); ctx.save(); };
    let cfg = null, loading = false, timer = null, busy = false, lastErr = '';
    const authed = () => ctx.signedIn() && !!ctx.token();
    const api = async (method, path, body) => {
      const r = await fetch(`${ctx.apiBase}${path}`, { method, headers: Object.assign({ Authorization: `Bearer ${ctx.token()}` }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      return j;
    };
    const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in root && 'Notification' in root;
    const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = () => (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
    const hash = (str) => { let h = 5381; for (const c of str) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };

    function snapshot() {
      const days = {}, upcoming = [], now = Date.now(), st = ctx.state();
      for (let i = 0; i < 3; i++) {
        const iso = ctx.U.toISO(ctx.U.addDays(ctx.U.parseISO(ctx.todayISO()), i));
        const timed = ctx.entries(iso).filter((e) => ['sched', 'ideal', 'wo'].includes(e.k) && e.time && !e.done);
        days[iso] = {
          big3: st.big3.filter((b) => b.date === iso && !b.done && b.text).map((b) => b.text.slice(0, 120)),
          tasks: ctx.tasksFor(iso).map((t) => String(t).slice(0, 120)),
          events: timed.map((e) => ({ time: e.time, text: String(e.text).replace(/^[^\w(]+/, '').slice(0, 120) })),
        };
        timed.forEach((e) => { const at = new Date(`${iso}T${e.time}`); if (at.getTime() > now) upcoming.push({ id: `${iso}-${e.time}-${hash(e.text)}`, at: at.toISOString(), text: String(e.text).replace(/^[^\w(]+/, '').slice(0, 120) }); });
      }
      return { days, upcoming: upcoming.slice(0, 60) };
    }

    async function sync() {
      const s = rs();
      if (!authed() || !(s.push || s.email)) return;
      try {
        await api('PUT', '/api/reminders/profile', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', digestTime: s.digestTime, digestPush: !!s.push, digestEmail: !!s.email, leadMin: Number(s.leadMin) || 0, snapshot: snapshot() });
        lastErr = '';
      } catch (e) { lastErr = e.message; }
    }
    /* Called after every save: wait for a quiet moment, then tell the server what is coming up. */
    function touch() { if (!(rs().push || rs().email)) return; clearTimeout(timer); timer = setTimeout(sync, 8000); }

    async function load() {
      if (!authed() || loading || cfg) return;
      loading = true;
      try { cfg = await api('GET', '/api/reminders/config'); } catch (e) { cfg = { push: false, email: false, error: e.message }; }
      loading = false; ctx.render();
    }

    async function enablePush() {
      if (busy) return; busy = true;
      try {
        if (!cfg || !cfg.push || !cfg.publicKey) throw new Error('Push is not set up on this server yet.');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings, then try again.');
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.publicKey) });
        await api('POST', '/api/reminders/push/subscribe', { subscription: sub.toJSON() });
        set({ push: true }); await sync(); ctx.toast('Phone reminders are on');
      } catch (e) { ctx.toast(e.message); }
      busy = false; ctx.render();
    }
    async function disablePush() {
      if (busy) return; busy = true;
      try {
        const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
        if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); await api('POST', '/api/reminders/push/unsubscribe', { endpoint: ep }).catch(() => {}); }
        set({ push: false }); await api('PUT', '/api/reminders/profile', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', digestTime: rs().digestTime, digestPush: false, digestEmail: !!rs().email, leadMin: Number(rs().leadMin) || 0, snapshot: snapshot() }).catch(() => {});
        ctx.toast('Phone reminders are off');
      } catch (e) { ctx.toast(e.message); }
      busy = false; ctx.render();
    }
    async function toggleEmail(on) {
      set({ email: on }); await sync();
      if (!on && authed()) await api('PUT', '/api/reminders/profile', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', digestTime: rs().digestTime, digestPush: !!rs().push, digestEmail: false, leadMin: Number(rs().leadMin) || 0, snapshot: snapshot() }).catch(() => {});
      ctx.toast(on ? 'Morning email is on' : 'Morning email is off'); ctx.render();
    }
    async function test() {
      try { await sync(); const r = await api('POST', '/api/reminders/test'); ctx.toast(r.push || r.email ? `Sent a test${r.push ? ' to your phone' : ''}${r.email ? ' and your email' : ''}` : 'Nothing to send to yet. Turn on phone reminders or the morning email first.'); }
      catch (e) { ctx.toast(e.message); }
    }

    function card() {
      const esc = ctx.esc, s = rs();
      if (!ctx.signedIn()) return `<section class="box"><h2>Reminders on your phone</h2><p class="prompt">Get a morning summary and a nudge before each event, even when Telos is closed. Sign in to turn them on.</p><button type="button" class="btn" data-act="account">Sign in</button></section>`;
      load();
      if (!cfg) return `<section class="box"><h2>Reminders on your phone</h2><p class="muted">Checking what is available…</p></section>`;
      const nothing = !cfg.push && !cfg.email;
      const pushLine = !cfg.push ? '<p class="muted small">Phone notifications are not set up on this server yet.</p>'
        : !pushSupported() ? '<p class="muted small">This browser cannot receive phone notifications.</p>'
        : (isIOS() && !standalone()) ? '<p class="nudge">On iPhone and iPad, first add Telos to your Home Screen (Share, then Add to Home Screen), then open it from there to turn this on.</p>'
        : `<label class="inline-check"><input type="checkbox" data-act="remindPush" ${s.push ? 'checked' : ''}> Notifications on this device</label>`;
      const emailLine = cfg.email ? `<label class="inline-check"><input type="checkbox" data-act="remindEmail" ${s.email ? 'checked' : ''}> Email me the same summary${ctx.email() ? ` at <strong>${esc(ctx.email())}</strong>` : ''} <small class="muted">(a good fallback if you prefer not to allow notifications)</small></label>` : '';
      return `<section class="box"><h2>Reminders on your phone</h2>
        <p class="prompt">A morning summary of your Big 3, tasks and first event, plus a nudge before each timed event. They arrive even when Telos is closed.</p>
        ${nothing ? '<p class="muted small">Reminders are not set up on this server yet.</p>' : ''}
        ${pushLine}${emailLine}
        ${(s.push || s.email) ? `<div class="row wrap"><label>Morning summary at <input type="time" data-remind="digestTime" value="${esc(s.digestTime)}"></label>
          <label>Event nudge <select data-remind="leadMin">${[[0, 'off'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before']].map(([v, l]) => `<option value="${v}"${Number(s.leadMin) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <button type="button" class="btn ghost small" data-act="remindTest">Send a test</button></div>
          <p class="muted small">Telos sends the server only a short list for today and the next two days: your Big 3, task titles and Telos events. Google Calendar events are not included. Timing follows how often the server checks (about every 15 minutes).${lastErr ? ` <span class="nudge">Last sync problem: ${esc(lastErr)}</span>` : ''}</p>` : ''}
      </section>`;
    }

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset && el.dataset.remind) { set({ [el.dataset.remind]: el.dataset.remind === 'leadMin' ? Number(el.value) : el.value }); sync(); }
    });
    const acts = { remindPush: (el) => (el.checked ? enablePush() : disablePush()), remindEmail: (el) => toggleEmail(el.checked), remindTest: test };
    return { card, touch, sync, acts, reset: () => { cfg = null; } };
  };
})(window);
