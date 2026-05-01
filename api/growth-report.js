// api/growth-report.js
// 학생 성장 리포트 생성 — scores + userCompleted 수집 + Gemini 분석 + growthReports 저장
// POST body: { idToken, studentUid, period }   period: 'last30d' (기본)
// Response: { success, report: {...}, reportId, model, usage }

const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

// 폴백 체인 (cleanup-ocr 와 동일)
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 모드 라벨 매핑 — 학생앱·학원장앱 표준 5분류
const MODE_LABELS = {
  vocab: '단어시험',
  mcq: '내용이해 객관식',
  fill_blank: '빈칸채우기',
  unscramble: '언스크램블',
  recording: '녹음숙제',
};

const SYSTEM_PROMPT = `당신은 한국 영어 학원의 학생 성장 분석가입니다.
주어진 학생의 응시 데이터를 분석하여 학원장이 학부모와 공유할 수 있는 친화적·건설적인 성장 리포트를 한국어로 작성합니다.

규칙:
1. 강점·약점·추천은 구체적이고 행동 가능한 표현으로 (예: "단어시험 평균 82점으로 안정적" / "녹음숙제 미응시 3회" / "빈칸 채우기 30분/주 추가 권장").
2. 데이터가 적거나 한쪽으로 치우쳐도 사실 그대로 분석하되, 부정적 표현은 건설적으로 (예: "약점 = 부족" 보다 "성장 여지" 톤).
3. 평균 점수·응시 횟수·추세를 활용해 객관성 확보.
4. 한국 학부모 관점에서 이해 가능한 표현 사용. 영어 모드명은 단어시험/객관식/빈칸채우기/언스크램블/녹음숙제 등 한국어로.
5. JSON 출력은 정확히 스키마대로. 추가 설명 텍스트 X.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '한 달 총평 (3~5문장 한국어)' },
    strengths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    weaknesses: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    recommendations: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    improvementNote: { type: 'string', description: '최근 추세 (좋아짐/보합/주춤) 1~2문장' },
  },
  required: ['summary', 'strengths', 'weaknesses', 'recommendations', 'improvementNote'],
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { idToken, studentUid, period = 'last30d' } = req.body || {};

    const q = await verifyAndCheckQuota({ idToken, quotaKind: 'growthReport' });
    if (q.error) return res.status(q.status).json({ error: q.error, limit: q.limit, currentCount: q.currentCount });
    // 쿼터 통과 시점에 카운트 — daily/monthly 단일 writer (서버) 통합
    await incrementUsage({ ...q, res, endpoint: 'growth-report' });

    if (!studentUid || typeof studentUid !== 'string') {
      return res.status(400).json({ error: 'studentUid required' });
    }
    if (q.role !== 'admin' && q.role !== 'academy_admin') {
      return res.status(403).json({ error: '학원장만 호출 가능합니다.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    const db = getFirestore();

    // 1) 학생 정보
    const studentSnap = await db.doc('users/' + studentUid).get();
    if (!studentSnap.exists) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    const student = studentSnap.data();
    if (student.academyId !== q.academyId) {
      return res.status(403).json({ error: '다른 학원 학생입니다.' });
    }

    // 2) 기간 — 최근 30일 (KST 기준)
    const now = Date.now();
    const fromMs = now - 30 * 24 * 3600 * 1000;
    const fromDate = _ymdKST(new Date(fromMs));
    const toDate = _ymdKST(new Date(now));

    // 3) scores 조회 — userId + academyId, 최근 30일 (date 필드, KST)
    const scoresSnap = await db.collection('scores')
      .where('uid', '==', studentUid)
      .where('academyId', '==', q.academyId)
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .get();
    const scores = scoresSnap.docs.map(d => d.data());

    if (scores.length === 0) {
      return res.status(400).json({
        error: '최근 30일 응시 기록이 없어 리포트를 생성할 수 없습니다.',
        attempts: 0,
      });
    }

    // 4) 통계 집계 — 모드별 평균·횟수·최근점수, 전체 평균
    const modeBreakdown = {};
    for (const key of Object.keys(MODE_LABELS)) {
      modeBreakdown[key] = { avg: 0, count: 0, lastScore: null, lastDate: null, sum: 0 };
    }
    let totalAttempts = 0, totalSum = 0;
    for (const s of scores) {
      const mode = s.testMode || s.mode;
      if (!modeBreakdown[mode]) continue;  // 알 수 없는 모드 무시
      modeBreakdown[mode].count++;
      modeBreakdown[mode].sum += (s.score || 0);
      if (!modeBreakdown[mode].lastDate || (s.date || '') > modeBreakdown[mode].lastDate) {
        modeBreakdown[mode].lastScore = s.score || 0;
        modeBreakdown[mode].lastDate = s.date || '';
      }
      totalAttempts++;
      totalSum += (s.score || 0);
    }
    for (const m of Object.values(modeBreakdown)) {
      m.avg = m.count > 0 ? Math.round(m.sum / m.count) : 0;
      delete m.sum;
    }
    const avgScore = totalAttempts > 0 ? Math.round(totalSum / totalAttempts) : 0;
    const passedCount = scores.filter(s => (s.score || 0) >= 80).length;

    // 5) Gemini 프롬프트 — 학생 정보 + 통계
    const userPrompt = _buildUserPrompt(student, modeBreakdown, totalAttempts, avgScore, passedCount, fromDate, toDate);

    // 6) Gemini 호출 (폴백 체인)
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const isTransient = (status) => status === 503 || status === 429;

    let report = null, usedModel = null, usage = null, lastError = null, lastStatus = null;
    outer:
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await _callGemini(model, apiKey, SYSTEM_PROMPT, userPrompt);
          if (result.ok) {
            usedModel = model;
            report = result.json;
            usage = result.usage;
            break outer;
          }
          lastError = result.error;
          lastStatus = result.status || null;
          if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
            return res.status(502).json({ error: 'AI service error', detail: lastError, model, status: lastStatus });
          }
          if (isTransient(lastStatus) && attempt === 0) {
            await sleep(800);
            continue;
          }
          continue outer;
        } catch (e) {
          lastError = e.message;
          if (attempt === 0) { await sleep(800); continue; }
        }
      }
    }

    if (!report) {
      return res.status(502).json({ error: 'All AI models failed', detail: lastError, triedModels: GEMINI_MODELS });
    }

    // 7) 통계 + 메타 결합
    const fullReport = {
      ...report,
      modeBreakdown,
      totalAttempts,
      avgScore,
      passedCount,
      periodFrom: fromDate,
      periodTo: toDate,
    };

    // 8) growthReports 저장
    const docRef = await db.collection('growthReports').add({
      academyId: q.academyId,
      studentUid,
      studentName: student.name || '',
      studentGroup: student.group || '',
      period,
      periodFrom: fromDate,
      periodTo: toDate,
      report: fullReport,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: q.callerUid,
      model: usedModel,
    });

    return res.json({
      success: true,
      reportId: docRef.id,
      report: fullReport,
      model: usedModel,
      usage,
    });
  } catch (err) {
    console.error('[growth-report]', err);
    return res.status(500).json({ error: err.message });
  }
};

function _ymdKST(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function _buildUserPrompt(student, modeBreakdown, totalAttempts, avgScore, passedCount, fromDate, toDate) {
  const grade = student.grade || '-';
  const group = student.group || '-';
  const modeLines = Object.entries(modeBreakdown).map(([k, m]) => {
    if (m.count === 0) return `- ${MODE_LABELS[k]}: 응시 없음`;
    return `- ${MODE_LABELS[k]}: ${m.count}회 응시, 평균 ${m.avg}점, 최근 ${m.lastScore}점 (${m.lastDate})`;
  }).join('\n');

  return `학생 정보:
- 이름: ${student.name || '-'}
- 반: ${group}
- 학년: ${grade}

분석 기간: ${fromDate} ~ ${toDate} (최근 30일)

전체 통계:
- 총 응시 횟수: ${totalAttempts}회
- 전체 평균 점수: ${avgScore}점
- 80점 이상 합격: ${passedCount}회

모드별 통계:
${modeLines}

위 데이터를 바탕으로 강점·약점·추천을 작성하세요. 추세(improvementNote)는 모드별 최근 점수와 평균을 비교해서 판단.`;
}

async function _callGemini(model, apiKey, systemPrompt, userPrompt) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.5,
      topP: 0.95,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) return { ok: false, error: 'Empty response' };

  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { return { ok: false, error: 'JSON parse failed: ' + e.message + ' / raw: ' + text.slice(0, 200) }; }

  return { ok: true, json: parsed, usage: data.usageMetadata || null };
}
