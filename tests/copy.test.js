const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const copy = require('../js/copy.js');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

test('new section labels by default, legacy labels behind the flag', () => {
  assert.strictEqual(copy.label('tasks'), 'What’s Next');
  assert.strictEqual(copy.label('goals', false), 'Your Telos');
  assert.strictEqual(copy.label('track', false), 'Record');
  assert.strictEqual(copy.label('lists', false), 'Collections');
  assert.strictEqual(copy.label('week', false), 'This Week');
  assert.strictEqual(copy.label('week', true), 'Week');
  assert.strictEqual(copy.label('tasks', true), 'Tasks');
  assert.strictEqual(copy.label('about', true), 'About');
  assert.deepStrictEqual(Object.keys(copy.LABELS.new), Object.keys(copy.LABELS.legacy));
});

test('index.html carries the pre-rendered landing page and Telos meta tags', () => {
  const m = /<!--prerender:start-->([\s\S]*?)<!--prerender:end-->/.exec(html);
  assert.ok(m, 'prerender markers present');
  assert.strictEqual(m[1], copy.staticLanding(), 'run npm run stamp to refresh the pre-rendered page');
  assert.match(m[1], /Planning for what matters\./);
  assert.match(html, /<title>Telos — Planning for what matters<\/title>/);
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) assert.ok(html.includes(`property="${p}"`), p);
  assert.ok(!/Life\.?OS/i.test(m[1].replace(/href="[^"]*"/g, '')));
});

test('every nav label in index.html matches the copy table', () => {
  for (const [, key, text] of html.matchAll(/data-lbl="(\w+)"[^>]*>([^<]+)</g)) assert.strictEqual(text, copy.LABELS.new[key], key);
});

test('manifest uses the Telos name and colors', () => {
  const mf = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(mf.name, 'Telos'); assert.strictEqual(mf.theme_color, '#1a1a1a'); assert.strictEqual(mf.background_color, '#faf8f3');
});

test('onboarding has four screens and skips on 2 to 4', () => {
  const o = copy.onboarding;
  assert.deepStrictEqual(Object.keys(o), ['s1', 's2', 's3', 's4']);
  assert.ok(o.s2.skip && o.s3.skip && o.s4.skip);
});
