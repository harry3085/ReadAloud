// 검증용 오프라인 테스트 — 단어 말하기 채점 1+2+3 확장안
//
// 목적: 새 채점 로직이 (a) 억울한 오답을 줄이면서 (b) "엉뚱한 답"을
//   정답처리하지 않는지(false positive) 합성 케이스로 검증.
//   통과하면 동일 로직을 public/js/app.js _spkGradeAnswer 로 이식.
//
// 실행: node scripts/diag/test-spk-grading.js
//
// 구조:
//   - Tier 직접: 들린 = 정답/동음이의어/발음변형 (기존 + 2번). 기존 임계 유지
//   - Tier 가드(1번): 들린 단어를 "이 시험 단어 전체"와 비교 →
//       정답군이 1등 + 바닥(0.45) + 2등 마진(0.15) 일 때만 인정
//   - 3번(발음코드)은 가드 안의 유사도 계산에만 반영 (단독 통과 불가)

// ── 정규화 ──────────────────────────────────────────────
function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Levenshtein 유사도 (0~1) ────────────────────────────
function levSim(a, b) {
  a = norm(a); b = norm(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return 1 - d[m][n] / Math.max(m, n);
}

// ── 3번: 발음코드 (metaphone-lite) ──────────────────────
function pcode(s) {
  let x = norm(s).replace(/[^a-z]/g, '');
  if (!x) return '';
  x = x
    .replace(/ph/g, 'f')
    .replace(/gh/g, '')
    .replace(/ck/g, 'k')
    .replace(/sch/g, 'sk')
    .replace(/tch/g, 'ch')
    .replace(/^wr/, 'r')
    .replace(/^kn/, 'n')
    .replace(/mb$/, 'm')
    .replace(/c([eiy])/g, 's$1')   // ce/ci/cy → se/si/sy
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/w/g, '')
    .replace(/h/g, '')
    .replace(/[eiy]/g, 'i')        // e/i/y 동일 모음군
    .replace(/(.)\1+/g, '$1')      // 중복 자모 축약
    .replace(/e$/, '');
  return x;
}
function phoneticEqual(a, b) {
  const ca = pcode(a), cb = pcode(b);
  return ca.length >= 2 && ca === cb;
}

// 가드 안 단어 유사도 = 글자 유사도 ∪ 발음코드 일치(0.92)
function wordSim(said, w) {
  return Math.max(levSim(said, w), phoneticEqual(said, w) ? 0.92 : 0);
}

const CFG = {
  lenient: { maxAlt: 5, th: 0.6 },
  normal:  { maxAlt: 5, th: 0.7 },
  strict:  { maxAlt: 1, th: 0.8 },
};
const FLOOR = 0.45;       // 최소 바닥 (이하 = 무의미 → 무조건 오답)
const MARGIN = 0.15;      // 강한 매칭(임계 이상) 시 다른 시험단어 대비 마진
const BIG_MARGIN = 0.30;  // 임계 미만 구제(가까운 1등) 시 요구 마진 (더 엄격)

// ── 핵심 채점 ───────────────────────────────────────────
// alts: 들린 후보 문자열 배열 (Web Speech alternatives)
function grade(alts, target, strictness, homophones, allWords, accentVariants) {
  const cfg = CFG[strictness] || CFG.normal;
  const ans = norm(target);
  if (!ans) return { correct: false, via: 'no-target' };

  // 시험의 다른 단어들 (정답 제외)
  const others = [];
  for (const w of (allWords || [])) { const x = norm(w); if (x && x !== ans && !others.includes(x)) others.push(x); }

  // 인정 후보 = 정답 + 동음이의어 + 발음변형.
  // 단, 다른 시험 단어와 겹치는 동음이의어/변형은 제외 (애매 → 인정 불가, false positive 차단)
  const group = [ans];
  const addCand = (raw) => {
    const x = norm(raw);
    if (x && x !== ans && !group.includes(x) && !others.includes(x)) group.push(x);
  };
  for (const h of (homophones || [])) addCand(h);
  for (const v of (accentVariants || [])) addCand(v);

  const cands = (alts || []).slice(0, cfg.maxAlt).map(norm).filter(Boolean);

  for (const said of cands) {
    // 진짜 정확일치 (정답/필터된 동음이의어·변형) — 항상 안전
    for (const g of group) {
      if (said === g) return { correct: true, via: 'exact', heard: said, sim: 1 };
    }
    // 통합 가드: 정답군 최고유사도(bestG) vs 다른 시험단어 최고유사도(bestO)
    // wordSim = 글자유사도 ∪ 발음코드일치(3번). 항상 "다른 시험단어를 마진만큼 이겨야" 인정.
    let bestG = 0, bestGw = '';
    for (const g of group) { const s = wordSim(said, g); if (s > bestG) { bestG = s; bestGw = g; } }
    let bestO = 0, bestOw = '';
    for (const o of others) { const s = wordSim(said, o); if (s > bestO) { bestO = s; bestOw = o; } }
    const gap = bestG - bestO;
    // (A) 강한 매칭: 임계 이상 + 경쟁단어 마진. (B) 임계 미만 구제: 바닥 이상 + 큰 마진(확실한 1등)
    const strong = bestG >= cfg.th && gap >= MARGIN;
    const rescue = bestG >= FLOOR && gap >= BIG_MARGIN;
    if (strong || rescue) {
      return { correct: true, via: strong ? 'strong' : 'rescue', heard: said, sim: +bestG.toFixed(2),
        beat: `${bestGw}(${bestG.toFixed(2)}) vs ${bestOw || '-'}(${bestO.toFixed(2)}) gap ${gap.toFixed(2)}` };
    }
  }
  return { correct: false, via: 'reject', heard: cands[0] || '' };
}

// ── 합성 테스트 케이스 ──────────────────────────────────
const TEST = ['cereal', 'apple', 'river', 'mountain', 'right', 'cat'];  // 한 시험의 단어들

const cases = [
  // [설명, 정답, 들린후보들, 동음이의어, 발음변형(2번), 기대(통과여부)]
  ['정확히 말함',                'apple',   ['apple'],            [], [], true],
  ['오인식: cereal→serial (가드로 인정)', 'cereal', ['serial'],     [], [], true],
  ['동음이의어: cereal→serial (등록)',    'cereal', ['serial'],     ['serial'], [], true],
  ['발음변형: right→light (light 시험에 없음)', 'right', ['light'],  [], ['light'], true],
  ['오인식 약함: mountain→mountin',  'mountain',['mountin'],          [], [], true],
  ['엉뚱: 무의미 asdf',          'apple',   ['asdf'],             [], [], false],
  ['엉뚱: 침묵/빈값',            'apple',   [''],                 [], [], false],
  ['엉뚱: 전혀 다른 말',         'cereal',  ['hello there'],      [], [], false],
  ['다른 시험단어를 말함: 정답 cereal 인데 "river"', 'cereal', ['river'], [], [], false],
  ['다른 시험단어: 정답 apple 인데 "mountain"',     'apple',  ['mountain'], [], [], false],
  ['헷갈림 가드: 정답 cat, 들림 "cat" (정상)',      'cat',    ['cat'],   [], [], true],
  ['주의 cat/cot: 정답 cat, 들림 "cot" (cot 시험에 없음 → 인정)', 'cat', ['cot'], [], [], true],
  ['2번 충돌: 정답 right, 들림 light, 그런데 light 도 시험단어', 'right', ['light'], [], ['light'], false],
  ['후보 5개 중 하나 정답',      'river',   ['liver', 'diver', 'river', 'fever', 'rover'], [], [], true],
];

console.log('\n=== 단어 말하기 채점 1+2+3 검증 ===');
console.log(`시험 단어: [${TEST.join(', ')}]  · FLOOR=${FLOOR} MARGIN=${MARGIN} (보통 모드)\n`);

let pass = 0, fail = 0;
for (const [desc, tgt, alts, hom, av, expect] of cases) {
  // light 충돌 케이스는 시험단어에 light 포함
  const words = desc.includes('light 도 시험단어') ? [...TEST, 'light'] : TEST;
  const r = grade(alts, tgt, 'normal', hom, words, av);
  const ok = r.correct === expect;
  if (ok) pass++; else fail++;
  const mark = ok ? '✅' : '❌오류';
  const exp = expect ? '통과기대' : '차단기대';
  console.log(`${mark} [${exp}] ${desc}`);
  console.log(`     정답=${tgt} 들림=${JSON.stringify(alts)} → ${r.correct ? '정답' : '오답'} (via ${r.via}${r.sim !== undefined ? ', sim ' + r.sim : ''}${r.beat ? ', ' + r.beat : ''})`);
}
console.log(`\n결과: ${pass}/${cases.length} 기대대로  ${fail ? '(❌ ' + fail + '건 불일치 — 기준치 조정 필요)' : '(전부 일치)'}\n`);
