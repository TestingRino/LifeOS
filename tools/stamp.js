/* Cache-busting: tags the local css/js links in index.html with a fresh version so browsers
   never mix a new page with old scripts or styles. Run before committing: npm run stamp */
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'index.html');
const v = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const html = fs.readFileSync(file, 'utf8')
  .replace(/((?:href|src)="(?:css|js)\/[^"?]+)(?:\?v=\w+)?"/g, `$1?v=${v}"`);
fs.writeFileSync(file, html);
console.log(`stamped assets with v=${v}`);
