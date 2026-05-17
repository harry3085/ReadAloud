// 1회용 복구 — userCompleted 에 recordings 가 없는 eval 에러 케이스를
// Storage 에 남아있는 audio 파일로 AI 재평가
//
// 동작:
//  1) genTests 중 testMode='recording' + academyId 필터
//  2) userCompleted 중 latestErrorStage 있고 recordings 비어있는 케이스
//  3) Storage `recordings/genTests/{testId}/{uid}/` list → 마지막 회차 파일 찾기
//  4) audio fetch → base64 → Gemini check-recording 프롬프트 호출
//  5) userCompleted 갱신 (통과/미통과 + recordings 정상화) + scores add
//
// 사용:
//   node scripts/admin/recover-recording-errors.js --academy=default          (DRY-RUN)
//   node scripts/admin/recover-recording-errors.js --academy=default --apply  (실제 실행)

const { getDb } = require('../lib/firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });

const API_KEY = process.env.GEMINI_API_KEY;
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-flash-lite'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function _ymdKST(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function _isSameKstDay(ts, ymd) {
  if (!ts) return false;
  try {
    const ms = ts.toMillis ? ts.toMillis() : (ts._seconds ? ts._seconds * 1000 : 0);
    if (!ms) return false;
    return _ymdKST(new Date(ms)) === ymd;
  } catch (_) { return false; }
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const f = cleaned.indexOf('{'), l = cleaned.lastIndexOf('}');
  if (f >= 0 && l > f) { try { return JSON.parse(cleaned.slice(f, l + 1)); } catch {} }
  return null;
}

function buildEvalPrompt(originalText, evaluationSeconds) {
  const evalScope = (evaluationSeconds && evaluationSeconds > 0)
    ? `Evaluate ONLY the first ${evaluationSeconds} seconds of the recording.`
    : `Evaluate the ENTIRE recording.`;
  return `You are a Korean English teacher evaluating a student's reading recording.

ORIGINAL TEXT:
"""
${originalText}
"""

${evalScope}
Compare the student's audio to the ORIGINAL TEXT above — measure how much was read clearly and in order.
Then ALWAYS provide detailed feedback (regardless of score).

Return strictly JSON:
{
  "score": <integer 0-100>,
  "missedWords": [<up to 5 important words omitted>],
  "note": "<one-line Korean comment>",
  "feedback": {
    "missedWords": [<up to 3 omitted words>],
    "weakPronunciation": [{ "word": "<english>", "issue": "<Korean instruction>" }],
    "tips": [<up to 3 Korean tips>]
  }
}`;
}

async function geminiEvaluate(audioBase64, mimeType, originalText, evaluationSeconds) {
  const responseSchema = {
    type: 'object',
    properties: {
      score: { type: 'integer' },
      missedWords: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
      feedback: {
        type: 'object',
        properties: {
          missedWords: { type: 'array', items: { type: 'string' } },
          weakPronunciation: { type: 'array', items: { type: 'object', properties: { word: { type: 'string' }, issue: { type: 'string' } }, required: ['word', 'issue'] } },
          tips: { type: 'array', items: { type: 'string' } },
        },
        required: ['missedWords', 'weakPronunciation', 'tips'],
      },
    },
    required: ['score', 'missedWords', 'note', 'feedback'],
  };
  const reqBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: buildEvalPrompt(originalText, evaluationSeconds) },
        { inlineData: { mimeType, data: audioBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1, topP: 0.9, maxOutputTokens: 1000,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`${BASE}/${model}:generateContent?key=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const d = await r.json();
        if (!r.ok) {
          if ([503, 429, 404].includes(r.status)) { console.warn(`  ${model} ${r.status} → 재시도/다음 모델`); continue; }
          throw new Error(`${model} HTTP ${r.status}: ${JSON.stringify(d?.error)}`);
        }
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const j = extractJson(text);
        if (j) return j;
        console.warn(`  ${model} JSON 파싱 실패 — attempt ${attempt+1}`);
      } catch (e) {
        console.warn(`  ${model} exception:`, e.message);
      }
    }
  }
  throw new Error('Gemini 모든 모델 실패');
}

function _gcsPathFromUrl(url) {
  // download URL → 객체 경로 추출
  // 예: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded path}?alt=media&token=...
  const m = url.match(/\/o\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const academyId = args.academy || 'default';
  const apply = !!args.apply;
  const targetYmd = args.date || _ymdKST();

  if (!API_KEY) {
    console.error('\n[error] GEMINI_API_KEY 환경변수 없음. .env.local 확인.');
    process.exit(1);
  }

  const db = getDb();
  const storage = getStorage();
  // bucket 명: firebase-admin getStorage().bucket() 기본은 default bucket
  // 명시 안 하면 FIREBASE_STORAGE_BUCKET 또는 projectId.firebasestorage.app
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'readaloud-51113.firebasestorage.app';
  const bucket = storage.bucket(bucketName);

  console.log(`\n=== 녹음 에러 케이스 복구 (${academyId} · ${targetYmd}) ${apply ? '[APPLY]' : '[DRY-RUN]'} ===\n`);

  // 1) 에러 케이스 찾기
  const testsSnap = await db.collection('genTests')
    .where('academyId', '==', academyId)
    .where('testMode', '==', 'recording')
    .get();

  const cases = [];
  for (const t of testsSnap.docs) {
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    for (const uc of ucSnap.docs) {
      const c = uc.data();
      const recs = Array.isArray(c.recordings) ? c.recordings : [];
      if (!_isSameKstDay(c.latestAttemptAt, targetYmd)) continue;
      if (!c.latestErrorStage) continue;
      if (recs.length > 0) continue;  // 이미 recordings 있는 케이스는 학원장 UI 로 처리
      cases.push({ test: t, testId: t.id, uc: uc.ref, uid: uc.id, c });
    }
  }
  console.log(`복구 대상: ${cases.length}건\n`);
  if (!cases.length) { console.log('(대상 없음)'); process.exit(0); }

  // 2) 각 케이스 처리
  let okCount = 0, failCount = 0;
  for (const item of cases) {
    const { test, testId, uc, uid, c } = item;
    const userName = c.userName || uid.slice(0, 8);
    const testName = (test.data().name || '').slice(0, 40);
    console.log(`▶ ${userName} / ${testName}`);

    try {
      // 2a) Storage list
      const prefix = `recordings/genTests/${testId}/${uid}/`;
      const [files] = await bucket.getFiles({ prefix });
      if (!files.length) { console.log(`  ✗ Storage 에 audio 없음 (${prefix})`); failCount++; continue; }
      // 파일명 패턴: round{N}_{ts}_{i}.{ext} — round 번호로 정렬 후 마지막
      const sorted = files.slice().sort((a, b) => {
        const na = parseInt((a.name.match(/round(\d+)/) || [])[1] || '0', 10);
        const nb = parseInt((b.name.match(/round(\d+)/) || [])[1] || '0', 10);
        if (na !== nb) return na - nb;
        // 같은 round 면 timestamp 큰 게 마지막
        const ta = parseInt((a.name.match(/round\d+_(\d+)/) || [])[1] || '0', 10);
        const tb = parseInt((b.name.match(/round\d+_(\d+)/) || [])[1] || '0', 10);
        return ta - tb;
      });
      console.log(`  Storage 파일 ${sorted.length}개 · 마지막: ${sorted[sorted.length-1].name}`);

      // 2b) recordings 배열 재구성 (download URL 받기)
      const newRecs = [];
      for (let i = 0; i < sorted.length; i++) {
        const f = sorted[i];
        // signed URL 100년 (사실상 영구) — Firebase Storage download URL 대체
        const [url] = await f.getSignedUrl({ action: 'read', expires: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 });
        const meta = await f.getMetadata();
        newRecs.push({
          round: i + 1,
          audioUrl: url,
          duration: 0,
          voiceActivity: null,
          mimeType: meta[0]?.contentType || (f.name.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm'),
        });
      }

      // 2c) 마지막 audio 다운로드 → base64
      const lastFile = sorted[sorted.length - 1];
      const [buf] = await lastFile.download();
      const audioBase64 = buf.toString('base64');
      const meta = await lastFile.getMetadata();
      const rawMime = meta[0]?.contentType || (lastFile.name.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm');
      // Gemini 호환 mime
      const mimeType = (() => {
        const lower = rawMime.toLowerCase();
        if (lower.includes('webm')) return 'audio/ogg';
        if (lower.includes('mp4') || lower.includes('m4a')) return 'audio/aac';
        return lower.split(';')[0].trim() || 'audio/ogg';
      })();

      // 2d) 질문 정보
      const tData = test.data();
      const q = (Array.isArray(tData.questions) && tData.questions[0]) || {};
      const fullText = q.fullText || '';
      const passScore = tData.passScore || q.accuracyThreshold || 80;
      const evalSec = (typeof q.evaluationSeconds === 'number') ? q.evaluationSeconds : 0;
      if (!fullText) { console.log(`  ✗ fullText 없음`); failCount++; continue; }

      console.log(`  Gemini 호출 (audio ${(buf.length/1024).toFixed(0)}KB, mime=${mimeType})...`);

      if (!apply) {
        console.log(`  [DRY-RUN] passScore=${passScore} evalSec=${evalSec} fullText=${fullText.slice(0, 50)}...`);
        console.log(`  [DRY-RUN] 실제 호출 안 함. --apply 추가 시 실행.`);
        continue;
      }

      // 2e) Gemini 평가
      const evalResult = await geminiEvaluate(audioBase64, mimeType, fullText, evalSec);
      const score = Math.max(0, Math.min(100, parseInt(evalResult.score) || 0));
      const missedWords = Array.isArray(evalResult.missedWords) ? evalResult.missedWords.slice(0, 5) : [];
      const note = String(evalResult.note || '').slice(0, 200);
      const fb = evalResult.feedback || {};
      const feedback = {
        missedWords: Array.isArray(fb.missedWords) ? fb.missedWords.slice(0, 3) : [],
        weakPronunciation: Array.isArray(fb.weakPronunciation) ? fb.weakPronunciation.slice(0, 3) : [],
        tips: Array.isArray(fb.tips) ? fb.tips.slice(0, 3) : [],
      };
      const passed = score >= passScore;

      newRecs[newRecs.length - 1] = {
        ...newRecs[newRecs.length - 1],
        score, missedWords, note, feedback,
      };

      // 2f) userCompleted 갱신
      const today = _ymdKST();
      if (passed) {
        await uc.set({
          uid, userName,
          score, passed: true, passScore, date: today,
          recordings: newRecs,
          completedAt: FieldValue.serverTimestamp(),
          latestFailedScore: null, latestFailedAt: null,
          latestErrorStage: null, latestErrorMessage: null, latestAttemptAt: null,
          reEvaluatedAt: FieldValue.serverTimestamp(),
          recoveredBy: 'script:recover-recording-errors',
        }, { merge: true });
      } else {
        await uc.set({
          uid, userName,
          passScore,
          latestFailedScore: score,
          latestFailedAt: FieldValue.serverTimestamp(),
          recordings: newRecs,
          latestErrorStage: null, latestErrorMessage: null, latestAttemptAt: null,
          reEvaluatedAt: FieldValue.serverTimestamp(),
          recoveredBy: 'script:recover-recording-errors',
        }, { merge: true });
      }

      // 2g) scores add
      await db.collection('scores').add({
        uid, userName,
        testId, testName: tData.name || '',
        score, passed, passScore,
        mode: 'recording',
        date: today,
        academyId: tData.academyId,
        createdAt: FieldValue.serverTimestamp(),
        reEvaluated: true,
        recordings: newRecs,
      });

      console.log(`  ✓ ${score}점 · ${passed ? '통과' : '미통과 (통과 ' + passScore + ')'}`);
      okCount++;
    } catch (e) {
      console.error(`  ✗ 실패:`, e.message);
      failCount++;
    }
  }

  console.log(`\n=== 결과 ===`);
  console.log(`✓ 성공: ${okCount}건`);
  console.log(`✗ 실패: ${failCount}건`);
  if (!apply) console.log(`\n(DRY-RUN 이었습니다. 실제 실행하려면 --apply 추가)`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
