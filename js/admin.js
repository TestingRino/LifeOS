/* Life.OS — admin screen. Loaded only when an admin opens #/admin (see app.js).
   It is a thin view over /api/admin/*: the server checks every request, so this file can be public. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const ago = (d) => { if (!d) return 'never'; const n = Math.floor((Date.now() - Date.parse(d)) / 86400000); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
  const PLANNERS = { fullfocus: 'Full Focus', panda: 'Panda Planner', passion: 'Passion Planner', daydesigner: 'Day Designer', franklin: 'Franklin Covey', bujo: 'Bullet Journal', happyplanner: 'Happy Planner', erincondren: 'Erin Condren', moleskine: 'Moleskine / diary', hobonichi: 'Hobonichi', cultivate: 'Cultivate What Matters', simplified: 'Simplified / Ink+Volt', other: 'Other', unspecified: 'Not given' };
  const plannerName = (w) => (w.planner === 'other' && w.other ? `Other: ${w.other}` : PLANNERS[w.planner] || w.planner || 'Not given');

  let root, ctx, data = null, tab = 'overview', filter = 'new', search = '', editing = null, busy = false;

  async function call(path, opts) {
    const o = opts || {};
    const res = await fetch(`${ctx.apiBase}/api/admin${path}`, { method: o.method || 'GET', headers: { Authorization: `Bearer ${ctx.token()}`, ...(o.body ? { 'Content-Type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    let json = {}; try { json = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }
  async function load() {
    try { data = await call('/overview'); draw(); } catch (e) { root.innerHTML = `<section class="box"><h2>Admin</h2><p class="nudge">${esc(e.message)}</p><p class="muted small">You need to be signed in with an admin account. See DEPLOY.md, “Admin”.</p></section>`; }
  }

  /* ---------- views ---------- */
  const tile = (label, value, sub) => `<div class="tile"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub || '')}</small></div>`;
  function overview() {
    const t = data.totals, max = Math.max(1, ...data.planners.map((p) => p.count));
    return `<div class="tiles">${tile('People', t.users, `${t.new_7d} new this week`)}${tile('Paid (plus)', t.paid, 'active subscriptions')}${tile('Waitlist', t.waitlist_new, `${t.waitlist_total} total`)}${tile('Photo imports', t.photo_import_today, `${t.photo_import_7d} in 7 days`)}</div>
      <section class="box"><h2>Which planners people want first</h2>
        ${data.planners.length ? data.planners.map((p) => `<div class="adm-bar"><span>${esc(p.planner.startsWith('other: ') ? `Other: ${p.planner.slice(7)}` : PLANNERS[p.planner] || p.planner)}</span><div><i style="width:${Math.round((p.count / max) * 100)}%"></i></div><b>${p.count}</b></div>`).join('') : '<p class="muted">No waitlist requests yet.</p>'}
        <p class="muted small">From the “Request an invite” forms. Tune the top ones first.</p></section>
      <section class="box"><h2>Where else to look</h2><ul class="plain">
        ${ctx.analyticsUrl ? `<li><a href="${esc(ctx.analyticsUrl)}" target="_blank" rel="noopener">Open analytics (PostHog) →</a> funnel, retention, weekly reviews</li>` : '<li class="muted">Add <code>posthogDashboard</code> to js/config.js to link your analytics here.</li>'}
        <li>Supabase dashboard: users, the <code>plans</code> table and backups</li><li>Vercel: server logs, environment variables and deploys</li><li>Stripe dashboard: payments, refunds and invoices</li></ul></section>`;
  }
  function waitlist() {
    const rows = data.waitlist.filter((w) => filter === 'all' || w.status === filter);
    const chip = (k, l) => `<button type="button" class="chip${filter === k ? ' on' : ''}" data-adm="filter" data-v="${k}">${l}</button>`;
    return `<div class="chips">${chip('new', `New (${data.waitlist.filter((w) => w.status === 'new').length})`)}${chip('approved', 'Approved')}${chip('declined', 'Declined')}${chip('all', 'All')}</div>
      ${rows.length ? `<div class="cal-wrap"><table class="index adm-table"><thead><tr><th>Email</th><th>Planner</th><th>From</th><th>Asked</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((w) => `<tr>
        <td>${esc(w.email)}${w.has_account ? ' <small class="muted">has an account</small>' : ''}</td><td>${esc(plannerName(w))}</td><td>${esc(w.source || '—')}</td><td>${fmtDate(w.created_at)}</td><td>${esc(w.status)}</td>
        <td class="adm-act">${w.status !== 'approved' ? `<button type="button" class="btn small primary" data-adm="approve" data-id="${esc(w.id)}">Approve</button>` : `<button type="button" class="btn small ghost" data-adm="copy" data-email="${esc(w.email)}">Copy invite note</button>`}
          ${w.status === 'new' ? `<button type="button" class="btn small ghost" data-adm="decline" data-id="${esc(w.id)}">Decline</button>` : `<button type="button" class="btn small ghost" data-adm="reset" data-id="${esc(w.id)}">Reset</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<section class="box"><p class="muted">Nothing here.</p></section>'}
      <p class="muted small">Approving turns photo import on for that email straight away (no redeploy). Tell them: sign in with that email, then use Photo import from Today.</p>`;
  }
  const badge = (t, cls) => `<span class="adm-badge ${cls || ''}">${esc(t)}</span>`;
  function people() {
    const q = search.trim().toLowerCase(), rows = data.people.filter((p) => !q || p.email.includes(q) || String(p.notes).toLowerCase().includes(q));
    return `<div class="row adm-tools"><input id="admSearch" type="search" placeholder="Search email or notes…" value="${esc(search)}" aria-label="Search people">
        <form class="add adm-add" data-adm-form="grant"><input name="email" type="email" placeholder="Grant access to an email…" required aria-label="Email to grant"><button class="btn small">Grant photo import</button></form></div>
      <div class="cal-wrap"><table class="index adm-table"><thead><tr><th>Person</th><th>Signed up</th><th>Last seen</th><th>Plan</th><th>Photo import</th><th>Used (today / 7d)</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td>${esc(p.email)} ${p.no_account ? badge('no account yet') : ''}${p.via_env ? badge('env list') : ''}${p.status !== 'active' ? badge(p.status, 'warn') : ''}${p.provider ? `<br><small class="muted">${esc(p.provider)}</small>` : ''}</td>
        <td>${fmtDate(p.created_at)}</td><td>${ago(p.last_sign_in_at)}</td><td>${esc(p.tier)}${p.stripe ? ' <small class="muted">stripe</small>' : ''}</td>
        <td>${p.photo_import ? '✓' : '—'}${p.ocr_override !== null && p.ocr_override !== undefined ? ` <small class="muted">${p.ocr_override ? 'allowed' : 'blocked'} by admin</small>` : ''}</td><td>${p.usage_today} / ${p.usage_7d}</td>
        <td><button type="button" class="btn small ghost" data-adm="edit" data-email="${esc(p.email)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No one matches.</td></tr>'}</tbody></table></div>`;
  }
  function settings() {
    const s = data.settings, tiers = s.tiers, flags = s.flags;
    const tierRow = (name) => `<tr><td><strong>${name}</strong></td><td><input type="checkbox" data-t="${name}.ocr" ${tiers[name].ocr ? 'checked' : ''} aria-label="${name} includes photo import"></td>
      <td><input class="num" type="number" min="0" max="100000" data-t="${name}.ocr_hourly" value="${tiers[name].ocr_hourly}" aria-label="${name} per hour"></td><td><input class="num" type="number" min="0" max="100000" data-t="${name}.ocr_daily" value="${tiers[name].ocr_daily}" aria-label="${name} per day"></td></tr>`;
    return `<section class="box"><h2>For everyone</h2>
      <label class="inline-check"><input type="checkbox" data-f="ocr_enabled" ${flags.ocr_enabled ? 'checked' : ''}> Photo import is on <small class="muted">turn off to pause it for every account (a kill switch)</small></label>
      <label class="inline-check"><input type="checkbox" data-f="waitlist_open" ${flags.waitlist_open ? 'checked' : ''}> The invite waitlist accepts new requests</label></section>
      <section class="box"><h2>What each plan includes</h2>
        <table class="index adm-table"><thead><tr><th>Plan</th><th>Photo import</th><th>Per hour</th><th>Per day</th></tr></thead><tbody>${tierRow('free')}${tierRow('plus')}</tbody></table>
        <p class="muted small">A person's own overrides (Edit on the People tab) win over their plan. Environment list on the server: ${esc(data.env.ocr_allowed_emails)} ${data.env.ocr_allowed_emails === 'everyone' ? '' : 'address(es)'} always allowed, default limits ${data.env.hourly}/hour and ${data.env.daily}/day.</p>
        <div class="row"><button type="button" class="btn primary" data-adm="saveSettings">Save settings</button></div></section>`;
  }
  function editDialog() {
    const p = data.people.find((x) => x.email === editing); if (!p) return '';
    const ov = p.ocr_override === true ? 'true' : p.ocr_override === false ? 'false' : '';
    return `<dialog id="admEdit" open class="adm-dlg"><form method="dialog" data-adm-form="edit"><h2>${esc(p.email)}</h2>
      <div class="row"><label>Plan <select name="tier"><option value="free" ${p.tier === 'free' ? 'selected' : ''}>Free</option><option value="plus" ${p.tier === 'plus' ? 'selected' : ''}>Plus</option></select></label>
        <label>Status <select name="status">${['active', 'suspended', 'canceled', 'past_due'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Photo import <select name="ocr"><option value="" ${ov === '' ? 'selected' : ''}>Follow the plan</option><option value="true" ${ov === 'true' ? 'selected' : ''}>Always allow</option><option value="false" ${ov === 'false' ? 'selected' : ''}>Block</option></select></label></div>
      <div class="row"><label>Per hour <input class="num" name="ocr_hourly" type="number" min="0" value="${p.ocr_hourly == null ? '' : p.ocr_hourly}" placeholder="plan default"></label><label>Per day <input class="num" name="ocr_daily" type="number" min="0" value="${p.ocr_daily == null ? '' : p.ocr_daily}" placeholder="plan default"></label></div>
      <label class="field">Notes <textarea name="notes" rows="2" maxlength="500">${esc(p.notes || '')}</textarea></label>
      <p id="admMsg" class="muted small" role="status"></p>
      <div class="row end"><button type="button" class="btn ghost" data-adm="closeEdit">Cancel</button><button class="btn primary">Save</button></div></form></dialog>`;
  }
  function draw() {
    const tabs = [['overview', 'Overview'], ['waitlist', `Waitlist${data.totals.waitlist_new ? ` (${data.totals.waitlist_new})` : ''}`], ['people', 'People'], ['settings', 'Settings']];
    root.innerHTML = `<div class="chips adm-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="chip${tab === k ? ' on' : ''}" role="tab" aria-selected="${tab === k}" data-adm="tab" data-v="${k}">${l}</button>`).join('')}<span class="grow"></span><button type="button" class="btn small ghost" data-adm="refresh">Refresh</button></div>
      ${{ overview, waitlist, people, settings }[tab]()}${editing ? editDialog() : ''}`;
  }

  /* ---------- actions ---------- */
  async function act(fn, ok) { if (busy) return; busy = true; try { await fn(); await load(); if (ok) ctx.toast(ok); } catch (e) { ctx.toast(e.message); } finally { busy = false; } }
  function onClick(e) {
    const b = e.target.closest('[data-adm]'); if (!b || !root.contains(b)) return;
    const k = b.dataset.adm, id = b.dataset.id;
    if (k === 'tab') { tab = b.dataset.v; draw(); }
    else if (k === 'filter') { filter = b.dataset.v; draw(); }
    else if (k === 'refresh') act(async () => {}, 'Refreshed');
    else if (k === 'approve') act(() => call(`/waitlist/${encodeURIComponent(id)}`, { method: 'POST', body: { action: 'approve' } }), 'Approved. Photo import is on for them.');
    else if (k === 'decline') act(() => call(`/waitlist/${encodeURIComponent(id)}`, { method: 'POST', body: { action: 'decline' } }), 'Declined');
    else if (k === 'reset') act(() => call(`/waitlist/${encodeURIComponent(id)}`, { method: 'POST', body: { action: 'reset' } }), 'Back to new');
    else if (k === 'copy') { const t = `You're in! Sign in to Life.OS (${ctx.siteUrl}) with ${b.dataset.email}, then open Today and tap “Import today's page”. Reply with anything that reads wrong.`; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => ctx.toast('Invite note copied'), () => ctx.toast(t)); }
    else if (k === 'edit') { editing = b.dataset.email; draw(); }
    else if (k === 'closeEdit') { editing = null; draw(); }
    else if (k === 'saveSettings') {
      const num = (n) => Number(root.querySelector(`[data-t="${n}"]`).value), chk = (n) => root.querySelector(`[data-t="${n}"]`).checked;
      const tiers = Object.fromEntries(['free', 'plus'].map((n) => [n, { ocr: chk(`${n}.ocr`), ocr_hourly: num(`${n}.ocr_hourly`), ocr_daily: num(`${n}.ocr_daily`) }]));
      const flags = { ocr_enabled: root.querySelector('[data-f=ocr_enabled]').checked, waitlist_open: root.querySelector('[data-f=waitlist_open]').checked };
      act(() => call('/settings', { method: 'PUT', body: { tiers, flags } }), 'Settings saved');
    }
  }
  function onSubmit(e) {
    const f = e.target.closest('[data-adm-form]'); if (!f || !root.contains(f)) return;
    e.preventDefault();
    const fd = new FormData(f);
    if (f.dataset.admForm === 'grant') { act(() => call('/entitlement', { method: 'POST', body: { email: fd.get('email'), ocr: true } }), 'Photo import granted'); return; }
    const n = (v) => (v === '' ? null : Number(v)), email = editing, ocr = fd.get('ocr');
    act(async () => { await call('/entitlement', { method: 'POST', body: { email, tier: fd.get('tier'), status: fd.get('status'), ocr: ocr === '' ? null : ocr === 'true', ocr_hourly: n(fd.get('ocr_hourly')), ocr_daily: n(fd.get('ocr_daily')), notes: fd.get('notes') } }); editing = null; }, 'Saved');
  }
  function onInput(e) { if (e.target.id === 'admSearch') { search = e.target.value; const pos = e.target.selectionStart; draw(); const i = root.querySelector('#admSearch'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } }

  window.LifeAdmin = {
    mount(el, c) {
      root = el; ctx = c; tab = tab || 'overview'; data = null;
      root.innerHTML = '<p class="muted">Loading…</p>';
      if (!root.dataset.bound) { root.dataset.bound = '1'; root.addEventListener('click', onClick); root.addEventListener('submit', onSubmit); root.addEventListener('input', onInput); }
      load();
    },
  };
})();
