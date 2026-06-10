const fs = require('fs');
const path = require('path');
const targets = ['icon-192.png','icon-512.png','LexiAI','lexiai','defaultLogo','/icons/'];
function scan(dir, exts = ['.js','.html','.css','.json']) {
  const results = [];
  for (const name of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, name.name);
    if (name.isDirectory() && !['node_modules','.git','.vercel','dist','build'].includes(name.name)) {
      results.push(...scan(full, exts));
      continue;
    }
    if (!exts.includes(path.extname(name.name))) continue;
    try {
      const c = fs.readFileSync(full, 'utf8');
      const lines = c.split(/\r?\n/);
      lines.forEach((l,i) => {
        for (const t of targets) {
          if (l.includes(t)) {
            results.push({ file: full.replace(/\\/g, '/'), line: i+1, target: t, text: l.trim().slice(0,160) });
            break;
          }
        }
      });
    } catch(_) {}
  }
  return results;
}
const r = scan('public');
r.push(...scan('api'));
const byFile = {};
r.forEach(x => { (byFile[x.file] = byFile[x.file] || []).push(x); });
for (const [f, items] of Object.entries(byFile)) {
  console.log('\n== ' + f + ' (' + items.length + '건) ==');
  items.slice(0, 12).forEach(i => console.log('  ' + i.line + ' [' + i.target + ']: ' + i.text));
  if (items.length > 12) console.log('  ... ' + (items.length-12) + '건 더');
}
