/* Writes the static marketing page into index.html (between the prerender markers) so crawlers and link previews
   see real content. The app swaps it for the interactive page on load. Run by `npm run stamp`. */
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'index.html');
const copy = require('../js/copy.js');
const html = fs.readFileSync(file, 'utf8');
const out = html.replace(/<!--prerender:start-->[\s\S]*?<!--prerender:end-->/, `<!--prerender:start-->${copy.staticLanding()}<!--prerender:end-->`);
if (out !== html) fs.writeFileSync(file, out);
console.log('prerendered landing page');
