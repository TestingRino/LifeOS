#!/usr/bin/env node
/* Measures how well photo import reads real planner pages.
   Put photos in a folder with a sidecar file of what is actually on the page:
     tools/ocr-eval/fixtures/full-focus-roles.jpg
     tools/ocr-eval/fixtures/full-focus-roles.expected.json   {"type":"goals","data":{"roles":[{"name":"Parent"}],"goals":[{"title":"Run a 10K"}]}}
   Then:  node tools/ocr-eval.js tools/ocr-eval/fixtures --token <google access token> [--url https://life-os-bice-xi.vercel.app] [--min 0.85]
   It prints precision, recall and F1 for each page and overall, and exits 1 if the overall F1 is below --min. */
const fs = require('fs');
const path = require('path');
const { score } = require('./ocr-score.js');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const dir = args.find((a) => !a.startsWith('--') && fs.existsSync(a) && fs.statSync(a).isDirectory());
const url = (flag('url', process.env.LIFEOS_API || 'http://localhost:3001')).replace(/\/$/, '');
const token = flag('token', process.env.LIFEOS_TOKEN || '');
const min = Number(flag('min', 0));
if (!dir) { console.error('Usage: node tools/ocr-eval.js <fixtures-dir> --token <google access token> [--url API] [--min 0.85]'); process.exit(2); }

(async () => {
  const photos = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)).sort();
  if (!photos.length) { console.error(`No photos found in ${dir}`); process.exit(2); }
  const rows = []; let tp = 0, exp = 0, got = 0;
  for (const file of photos) {
    const side = path.join(dir, file.replace(/\.[^.]+$/, '.expected.json'));
    if (!fs.existsSync(side)) { console.warn(`skip ${file}: no ${path.basename(side)}`); continue; }
    const want = JSON.parse(fs.readFileSync(side, 'utf8'));
    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(path.join(dir, file))], { type: 'image/' + path.extname(file).slice(1).replace('jpg', 'jpeg') }), file);
    form.append('type', want.type); form.append('today', want.today || new Date().toISOString().slice(0, 10));
    const t0 = Date.now();
    const res = await fetch(`${url}/api/ocr/analyze`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { rows.push({ file, error: `${res.status} ${body.error || ''}` }); continue; }
    const s = score(want.type, want.data, body.data);
    tp += s.matched; exp += s.expected; got += s.read;
    rows.push({ file, type: want.type, ms: Date.now() - t0, ...s });
  }
  const P = got ? tp / got : 0, R = exp ? tp / exp : 0, F = P + R ? (2 * P * R) / (P + R) : 0;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  rows.forEach((r) => {
    if (r.error) return console.log(`✗ ${r.file}  ${r.error}`);
    console.log(`${r.f1 >= 0.85 ? '✓' : '△'} ${r.file}  [${r.type}] precision ${pct(r.precision)}  recall ${pct(r.recall)}  F1 ${pct(r.f1)}  (${r.matched}/${r.expected} found, ${r.extra.length} extra, ${r.ms} ms)`);
    r.missed.slice(0, 5).forEach((m) => console.log(`     missed: ${m.text}${m.date ? ` (${m.date})` : ''}`));
    r.extra.slice(0, 3).forEach((m) => console.log(`     extra:  ${m.text}`));
  });
  console.log(`\nOverall: precision ${pct(P)}  recall ${pct(R)}  F1 ${pct(F)} over ${rows.filter((r) => !r.error).length} page(s)`);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ at: new Date().toISOString(), overall: { precision: P, recall: R, f1: F }, rows }, null, 2));
  if (min && F < min) { console.error(`F1 ${pct(F)} is below the target ${pct(min)}`); process.exit(1); }
})();
