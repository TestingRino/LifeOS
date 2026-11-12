/* Telos copy: every product-voice string that is shared between the app and the pre-rendered landing page.
   Loaded as a plain script in the browser (window.TelosCopy) and with require() in tools/prerender.js and tests.
   Voice: thoughtful, quiet, a little literary. Short sentences. Space on the page. */
(function (root) {
  const LABELS = {
    new: { today: 'Today', week: 'This Week', calendar: 'Calendar', tasks: 'What’s Next', plan: 'Pointing Toward', goals: 'Your Telos', track: 'Record', lists: 'Collections', about: 'Why Telos' },
    legacy: { today: 'Today', week: 'Week', calendar: 'Calendar', tasks: 'Tasks', plan: 'Planning sessions', goals: 'Goals', track: 'Track', lists: 'Lists', about: 'About' },
  };
  /* USE_LEGACY_LABELS=true keeps the old section names for one release. It defaults to the new names.
     Set it in js/config.js, or per browser with localStorage 'lifeos.legacyLabels' = '1'. */
  function useLegacy() {
    try {
      if (root.LIFEOS_CONFIG && root.LIFEOS_CONFIG.USE_LEGACY_LABELS === true) return true;
      if (root.localStorage && root.localStorage.getItem('lifeos.legacyLabels') === '1') return true;
    } catch (e) { /* storage unavailable */ }
    return false;
  }
  const label = (key, legacy) => (legacy === undefined ? useLegacy() : legacy) ? LABELS.legacy[key] : LABELS.new[key];

  const TAGLINE = 'Planning for what matters.';
  const GREEK = 'Greek for the end a thing is made for.';

  const landing = {
    hero: {
      name: 'Telos', tagline: TAGLINE,
      body: 'Your paper planner holds your days. Telos holds your direction — so the small decisions on Tuesday still answer to the larger ones you set on Sunday.',
      primary: 'Get started', secondary: 'See how it works',
    },
    start: {
      h: 'Start at the end.',
      p: [
        'Telos is Greek for the end a thing is made for. Aristotle used it to ask a question most planning tools never quite get to: not what you’ll do this week, but what all of it is finally for.',
        'Most productivity apps start at the task. Telos starts at the end — the roles, goals, and purposes you built your planner around in the first place. It reads your paper pages, remembers what matters, and quietly makes sure your week still points there.',
      ],
    },
    how: {
      h: 'Three things, done well.',
      items: [
        ['Snap your planner.', 'Take a photo of this week’s spread. Telos reads it — tasks, appointments, roles, goals — and turns it into a searchable record you carry in your pocket.'],
        ['Keep your direction close.', 'Your roles and goals live one tap away. When you add a task, Telos asks the quiet question: which of these does it serve?'],
        ['Sync without friction.', 'Calendar events flow to Google and Apple. Reminders reach you when they should. Your paper stays paper. Your digital stays current. Neither one fights the other.'],
      ],
    },
    who: {
      h: 'For people who already plan on paper.',
      p: 'If you use a Full Focus, Franklin, Roterunner, Monk Manual, or bullet journal — Telos is built for you. We don’t want to replace your planner. We want to make it reachable.',
    },
    why: {
      h: 'Why Telos.',
      p: [
        'Telos (τέλος) is an ancient Greek word for end, purpose, or the goal toward which something aims. An acorn’s telos is to become an oak. A knife’s telos is to cut well. A person’s telos — Aristotle thought — is to live a flourishing life.',
        'We built this app because a paper planner already holds the best version of your answer to that question. The roles you chose. The goals you set when you were being honest with yourself. Telos’s only job is to keep that answer close, and to make sure your Tuesday still remembers it.',
      ],
    },
    footer: { tagline: TAGLINE, links: [['Privacy', 'privacy.html'], ['Terms', 'terms.html'], ['Contact', 'contact.html'], ['GitHub', 'https://github.com/TestingRino/LifeOS']] },
  };

  const onboarding = {
    s1: { h: 'Welcome to Telos.', lines: [GREEK, 'Let’s start there.'], next: 'Begin' },
    s2: { h: 'First, your roles.', lead: 'Most planning apps start at the task. We start a little earlier.', q: 'What are three or four roles you want this year to serve?', eg: 'e.g. Parent. Partner. Writer. Friend.', next: 'Continue', skip: 'Skip for now' },
    s3: { h: 'Now, what would a good year look like in each?', lead: 'One honest sentence per role is enough.', next: 'Continue', skip: 'Skip for now' },
    s4: { h: 'Have a paper planner?', lead: 'Snap a photo of this week’s spread. Telos will read it and keep it in sync.', next: 'Open camera', skip: 'I’ll do this later' },
  };

  const empty = {
    goals: 'What are you ultimately for? Add your first telos.',
    tasksToday: 'A quiet day. A good time to re-read your telos.',
    weekOpen: 'An open week. What would point you toward what matters?',
    photos: 'Snap your planner page to begin. Telos will do the reading.',
    roles: 'Start with your roles. Everything else points back here.',
    conflict: 'Two versions of this week. Which should Telos keep?',
  };

  const signIn = {
    /* Google Drive mode (the optional Drive sync) */
    drive: ['Telos would like to access your Google Drive.', 'Telos uses your Drive to store your planner data privately in your own account. We don’t see it. We don’t keep a copy. Your telos is yours.'],
    /* Account mode (Supabase): the copy has to be true there, so it says where the plan lives. */
    account: ['Welcome to Telos.', 'Sign in to keep your plan safe and open it on any device. Your first sign-in creates your account. Your plan is private to you, and you can delete it all at any time. Your telos is yours.'],
  };

  const existingUserBanner = { h: 'LifeOS is now Telos.', p: 'Same app. Clearer purpose.', link: 'Learn more', href: '#/why-telos' };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* The marketing page as plain HTML. tools/prerender.js writes it into index.html so link previews and crawlers
     see real content; the app replaces it with the interactive version once the script runs. */
  function staticLanding() {
    const L = landing, par = (a) => a.map((t) => `<p>${esc(t)}</p>`).join('');
    return `<div class="landing" id="staticLanding">
      <section class="land-hero"><div class="land-copy">
        <h1>${esc(L.hero.name)}</h1>
        <p class="land-tag">${esc(L.hero.tagline)}</p>
        <p class="land-sub">${esc(L.hero.body)}</p>
        <div class="land-cta"><a class="btn primary big" href="#/start">${esc(L.hero.primary)}</a> <a class="btn big" href="#/welcome/1">${esc(L.hero.secondary)}</a></div>
      </div></section>
      <section class="land-start"><h2>${esc(L.start.h)}</h2>${par(L.start.p)}</section>
      <section class="land-how"><h2>${esc(L.how.h)}</h2><ol class="comp-flow">${L.how.items.map(([h, t], i) => `<li><span class="comp-n">${i + 1}</span><h3>${esc(h)}</h3><p>${esc(t)}</p></li>`).join('')}</ol></section>
      <section class="land-who"><h2>${esc(L.who.h)}</h2><p>${esc(L.who.p)}</p></section>
      <section class="land-why"><h2>${esc(L.why.h)}</h2>${par(L.why.p)}</section>
      <footer class="land-foot"><p>${esc(L.footer.tagline)}</p><p>${L.footer.links.map(([t, h]) => `<a href="${esc(h)}">${esc(t)}</a>`).join(' · ')}</p></footer>
    </div>`;
  }

  const api = { LABELS, label, useLegacy, TAGLINE, GREEK, landing, onboarding, empty, signIn, existingUserBanner, staticLanding };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TelosCopy = api;
})(typeof window !== 'undefined' ? window : globalThis);
