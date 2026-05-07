// LexiAI 기본 로고를 Storage 에서 다운받아 public/icons/icon-192.png 와 icon-512.png 로 덮어쓰기
// FOUC 방지 — 첫 방문자도 정적 파일 자체가 LexiAI 로고이므로 잠깐도 안 보임
// 실행: node scripts/admin/sync-lexiai-icons.js

const fs = require('fs');
const path = require('path');
const https = require('https');
const { getDb } = require('../lib/firebase-admin');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

(async () => {
  const db = getDb();
  const snap = await db.doc('appConfig/branding').get();
  if (!snap.exists) {
    console.error('appConfig/branding 도큐먼트가 없습니다. super_admin 에서 LexiAI 로고를 먼저 업로드하세요.');
    process.exit(1);
  }
  const d = snap.data();
  const targets = [
    { size: 192, url: d.defaultLogo192Url, dest: path.resolve(__dirname, '../../public/icons/icon-192.png') },
    { size: 512, url: d.defaultLogo512Url, dest: path.resolve(__dirname, '../../public/icons/icon-512.png') },
  ];

  for (const t of targets) {
    if (!t.url) {
      console.warn(`⚠ ${t.size}px URL 없음 — skip`);
      continue;
    }
    console.log(`⬇ ${t.size}px 다운로드 → ${t.dest}`);
    await download(t.url, t.dest);
    const stat = fs.statSync(t.dest);
    console.log(`  ✓ ${stat.size} bytes`);
  }
  console.log('\n✅ 완료. git add public/icons/ && git commit -m \"chore(branding): LexiAI 정적 아이콘 갱신\" && git push');
})().catch(e => { console.error(e); process.exit(1); });
