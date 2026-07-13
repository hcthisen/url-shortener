// Dev utility: seed demo links + clicks into the local dev database
// so the dashboard has something to show. Usage: node scripts/seed-demo.mjs
import Database from 'better-sqlite3';

const db = new Database(new URL('../data/shortener.sqlite', import.meta.url).pathname.replace(/^\//, ''));
const links = [
  ['launch', 'https://www.producthunt.com/posts/our-launch', 'PH launch'],
  ['blog', 'https://blog.example.com/2026/07/how-we-ship', null],
  ['docs-v2', 'https://docs.example.com/v2/getting-started', 'docs revamp'],
  ['yt', 'https://www.youtube.com/watch?v=demo123', 'intro video'],
];
const ins = db.prepare('INSERT OR IGNORE INTO links (code, url, note) VALUES (?, ?, ?)');
for (const [code, url, note] of links) ins.run(code, url, note);

const rows = db.prepare('SELECT id, code FROM links').all();
const insClick = db.prepare('INSERT INTO clicks (link_id, ts, referrer) VALUES (?, ?, ?)');
const refs = ['https://news.ycombinator.com/', 'https://www.linkedin.com/feed/', 'https://t.co/xyz', '', '', 'https://www.google.com/'];
const now = Date.now();
for (const row of rows) {
  const base = 2 + Math.floor(Math.random() * 6);
  for (let d = 29; d >= 0; d--) {
    const n = Math.max(0, Math.round(base * (0.4 + Math.random()) * (d < 7 ? 1.6 : 1) * (row.code === 'launch' ? 2 : 1)));
    for (let i = 0; i < n; i++) {
      const ts = new Date(now - d * 86400000 - Math.random() * 80000000).toISOString();
      insClick.run(row.id, ts, refs[Math.floor(Math.random() * refs.length)]);
    }
  }
}
console.log('Seeded', rows.length, 'links,', db.prepare('SELECT COUNT(*) n FROM clicks').get().n, 'total clicks');
db.close();
