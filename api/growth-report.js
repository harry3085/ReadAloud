// api/growth-report.js
// 학생 성장 리포트 생성 — scores + userCompleted 수집 + Gemini 분석 + growthReports 저장
// POST body: { idToken, studentUid, period }   period: 'last30d' (기본)
// Response: { success, report: {...}, reportId, model, usage }

const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

// 폴백 체인 (cleanup-ocr 와 동일, 2026-05-18 재배치): lite → 3.1-lite → 2.5-flash
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 모드 라벨 매핑 — 학생앱·학원장앱 표준 5분류
const MODE_LABELS = {
  vocab: '단어시험',
  mcq: '본문이해·문법 객관식',
  fill_blank: '빈칸채우기',
  unscramble: '언스크램블',
  recording: '녹음숙제',
};

const SYSTEM_PROMPT = `당신은 한국 영어 학원의 학생 성장 분석가입니다.
주어진 학생의 응시 데이터를 분석하여 학원장이 학부모와 공유할 수 있는 친화적·건설적인 성장 리포트를 한국어로 작성합니다.

규칙:
1. 강점·약점·추천은 구체적이고 행동 가능한 표현으로 (예: "단어시험 평균 82점으로 안정적" / "빈칸 채우기 30분/주 추가 권장").
2. 데이터가 적거나 한쪽으로 치우쳐도 사실 그대로 분석하되, 부정적 표현은 건설적으로 (예: "약점 = 부족" 보다 "성장 여지" 톤).
3. 평균 점수·응시 횟수·추세를 활용해 객관성 확보.
4. 한국 학부모 관점에서 이해 가능한 표현 사용. 영어 모드명은 단어시험/객관식/빈칸채우기/언스크램블/녹음숙제 등 한국어로.
5. **녹음숙제는 점수 평가 방식이 달라 전체 평균/강점/약점/추천 분석에서 제외**합니다. 대신 별도 'recordingComment' 필드에 발음·읽기 상태에 대한 정성 코멘트만 작성하세요.
6. recordingComment 작성 가이드 (**매우 중요**):
   - 내부적으로 받은 카테고리 점수(발음·억양·속도·정확도) 와 자주 약한 발음 단어를 정성 판단의 근거로 활용.
   - **출력에는 절대 수치(점수·퍼센트)를 쓰지 마세요.** AI 평가 점수는 객관성/신뢰도 문제로 학생·학부모 노출이 제한됩니다.
   - 정성 표현만 사용 — "양호", "안정적", "꾸준히 향상 중", "더 다듬을 필요", "흔들리는 부분", "자연스럽게 잡혀가고 있음" 등.
   - 추세 표현 권장 — "전반적으로 안정", "발음 향상 중", "최근 정확도 더 좋아짐", "속도 안정 유지" 등.
   - 구체적 단어 예시는 OK — 'right', 'world' 등 자주 약한 단어 직접 언급해 추가 연습 권장.
   - 좋은 예시: "발음이 전반적으로 안정적이고 억양도 자연스럽게 잡혀가고 있어요. R 발음(right·world)이 가끔 흔들리는 편이라 해당 단어 위주로 추가 연습하면 좋습니다."
   - 나쁜 예시 (수치 노출 금지): "발음 78점, 억양 82점으로 양호" / "정확도 평균 75%" — **절대 출력 금지**.
   - 녹음숙제 응시 0건이면: "최근 30일 녹음숙제 응시 없음 — 응시 시작 시 발음·읽기 상태 분석을 제공할 수 있습니다."
7. JSON 출력은 정확히 스키마대로. 추가 설명 텍스트 X.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '한 달 총평 (3~5문장 한국어, 녹음숙제 제외 점수 기반)' },
    strengths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    weaknesses: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    recommendations: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    improvementNote: { type: 'string', description: '최근 추세 (좋아짐/보합/주춤) 1~2문장' },
    recordingComment: { type: 'string', description: '녹음숙제 발음·읽기 상태 정성 코멘트 (2~4문장, 카테고리 점수와 약한 발음 단어 활용)' },
  },
  required: ['summary', 'strengths', 'weaknesses', 'recommendations', 'improvementNote', 'recordingComment'],
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
    // 녹음숙제는 점수 평가 방식이 달라 전체 평균/합격 수에서 제외 (정성 코멘트로 별도 분석)
    const modeBreakdown = {};
    for (const key of Object.keys(MODE_LABELS)) {
      modeBreakdown[key] = { avg: 0, count: 0, lastScore: null, lastDate: null, sum: 0 };
    }
    let totalAttempts = 0, totalSum = 0;
    for (const s of scores) {
      const mode = s.mode;
      if (!modeBreakdown[mode]) continue;  // 알 수 없는 모드 무시
      modeBreakdown[mode].count++;
      modeBreakdown[mode].sum += (s.score || 0);
      if (!modeBreakdown[mode].lastDate || (s.date || '') > modeBreakdown[mode].lastDate) {
        modeBreakdown[mode].lastScore = s.score || 0;
        modeBreakdown[mode].lastDate = s.date || '';
      }
      if (mode !== 'recording') {
        totalAttempts++;
        totalSum += (s.score || 0);
      }
    }
    for (const m of Object.values(modeBreakdown)) {
      m.avg = m.count > 0 ? Math.round(m.sum / m.count) : 0;
      delete m.sum;
    }
    const avgScore = totalAttempts > 0 ? Math.round(totalSum / totalAttempts) : 0;
    const passedCount = scores.filter(s => s.mode !== 'recording' && (s.score || 0) >= 80).length;

    // 4-b) 녹음숙제 정성 데이터 — 최근 10개 testId 의 userCompleted 에서 categoryScores + feedback 추출
    // (categoryScores 는 AI 가 정성 판단할 때 내부 참고용으로만 사용 — 점수 자체는 학생에게 노출 X)
    const recordingTestIds = [...new Set(
      scores
        .filter(s => s.mode === 'recording' && s.testId)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .map(s => s.testId)
    )].slice(0, 10);
    const recordingDetails = [];
    for (const testId of recordingTestIds) {
      try {
        const ucSnap = await db.doc(`genTests/${testId}/userCompleted/${studentUid}`).get();
        if (!ucSnap.exists) continue;
        const uc = ucSnap.data();
        const recs = Array.isArray(uc.recordings) ? uc.recordings : [];
        const final = recs[recs.length - 1];
        if (!final) continue;
        recordingDetails.push({
          date: uc.date || '',
          categoryScores: final.categoryScores || {},
          weakPronunciation: Array.isArray(final.feedback?.weakPronunciation)
            ? final.feedback.weakPronunciation.slice(0, 5).map(w => ({ word: String(w.word || ''), issue: String(w.issue || '') }))
            : [],
          tips: Array.isArray(final.feedback?.tips) ? final.feedback.tips.slice(0, 3).map(String) : [],
        });
      } catch (e) { console.warn('[growth-report] uc fetch', testId, e.message); }
    }
    const recordingQualityRaw = _aggregateRecordingQuality(recordingDetails);

    // 4-c) 녹음숙제 출제 수 — 최근 30일 학생에게 배정된 recording 시험 수 (제출 N회 / 출제 M회 표시용)
    let recordingAssigned = 0;
    try {
      const sinceTs = new Date(now - 30 * 24 * 3600 * 1000);
      const grp = student.group || '';
      const recSnap = await db.collection('genTests')
        .where('academyId', '==', q.academyId)
        .where('testMode', '==', 'recording')
        .where('createdAt', '>=', sinceTs)
        .get();
      for (const d of recSnap.docs) {
        const data = d.data();
        if (Array.isArray(data.excludedUids) && data.excludedUids.includes(studentUid)) continue;
        const matchTarget =
          data.targetAll === true ||
          (Array.isArray(data.targetUids) && data.targetUids.includes(studentUid)) ||
          (grp && Array.isArray(data.targetGroups) && data.targetGroups.includes(grp));
        if (matchTarget) recordingAssigned++;
      }
    } catch (e) { console.warn('[growth-report] recording assigned count', e.message); }
    const recordingSubmittedTestIds = new Set(
      scores.filter(s => s.mode === 'recording' && s.testId).map(s => s.testId)
    );
    const recordingSubmitted = recordingSubmittedTestIds.size;
    // 클라이언트로 보낼 정성 데이터 — 수치(avgCat) 는 학생 보호 정책상 제외, 학원장 참고용 약한 단어/팁만
    const recordingQuality = {
      assigned: recordingAssigned,
      submitted: recordingSubmitted,
      topWeakWords: recordingQualityRaw.topWeakWords || [],
      topTips: recordingQualityRaw.topTips || [],
    };

    // 5) Gemini 프롬프트 — 학생 정보 + 통계 + 녹음 정성 데이터 (AI 내부 추론용 카테고리 점수 포함)
    const userPrompt = _buildUserPrompt(student, modeBreakdown, totalAttempts, avgScore, passedCount, fromDate, toDate, {
      ...recordingQualityRaw,
      assigned: recordingAssigned,
      submitted: recordingSubmitted,
    });

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

    // 7) 통계 + 메타 결합 — 녹음숙제 정성 데이터 포함 (학원장이 학부모와 공유하는 PDF에도 나타남)
    const fullReport = {
      ...report,
      modeBreakdown,
      totalAttempts,
      avgScore,
      passedCount,
      recordingQuality,  // { count, avgCat, topWeakWords, topTips }
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

function _buildUserPrompt(student, modeBreakdown, totalAttempts, avgScore, passedCount, fromDate, toDate, recordingQuality) {
  const grade = student.grade || '-';
  const group = student.group || '-';
  const modeLines = Object.entries(modeBreakdown).map(([k, m]) => {
    if (m.count === 0) return `- ${MODE_LABELS[k]}: 응시 없음`;
    return `- ${MODE_LABELS[k]}: ${m.count}회 응시, 평균 ${m.avg}점, 최근 ${m.lastScore}점 (${m.lastDate})`;
  }).join('\n');

  // 녹음숙제 정성 섹션 (AI 내부 추론용 — 카테고리 점수 포함하나 출력 시 수치 노출 금지 지시)
  let recordingSection = '';
  if (recordingQuality && recordingQuality.count > 0) {
    const c = recordingQuality.avgCat || {};
    const catLine = [
      c.pronunciation != null ? `발음 ${c.pronunciation}` : null,
      c.intonation != null ? `억양 ${c.intonation}` : null,
      c.pace != null ? `속도 ${c.pace}` : null,
      c.accuracy != null ? `정확도 ${c.accuracy}` : null,
    ].filter(Boolean).join(', ') || '데이터 없음';
    const weakWords = (recordingQuality.topWeakWords || []).join(', ') || '없음';
    const tips = (recordingQuality.topTips || []).join(' / ') || '없음';
    recordingSection = `

녹음숙제 정성 데이터 (AI 내부 참고용 — 출력에 수치 노출 금지):
- 출제 ${recordingQuality.assigned || 0}회 중 제출 ${recordingQuality.submitted || 0}회
- 카테고리 평균(100점 만점, 정성 판단 근거로만 사용): ${catLine}
- 자주 약한 발음 단어: ${weakWords}
- AI 피드백 팁: ${tips}`;
  } else {
    recordingSection = `

녹음숙제 정성 데이터: 최근 30일 응시 없음`;
  }

  return `학생 정보:
- 이름: ${student.name || '-'}
- 반: ${group}
- 학년: ${grade}

분석 기간: ${fromDate} ~ ${toDate} (최근 30일)

전체 통계 (녹음숙제 제외):
- 총 응시 횟수: ${totalAttempts}회
- 전체 평균 점수: ${avgScore}점
- 80점 이상 합격: ${passedCount}회

모드별 통계:
${modeLines}${recordingSection}

위 데이터를 바탕으로:
1. summary/strengths/weaknesses/recommendations/improvementNote 는 녹음숙제 외 점수 데이터만 활용해 작성.
2. recordingComment 는 녹음숙제 정성 데이터(카테고리 점수·약한 발음 단어·팁)를 활용해 발음·읽기 상태에 대한 구체적 코멘트만 작성. 응시 없으면 안내 문구.`;
}

// 녹음숙제 정성 데이터 집계 — 카테고리 평균 + 자주 약한 단어 + 팁
function _aggregateRecordingQuality(details) {
  if (!details.length) return { count: 0, avgCat: {}, topWeakWords: [], topTips: [] };
  const sumCat = { pronunciation: 0, intonation: 0, pace: 0, accuracy: 0 };
  const cntCat = { pronunciation: 0, intonation: 0, pace: 0, accuracy: 0 };
  const wordFreq = new Map();
  const tipFreq = new Map();
  for (const d of details) {
    for (const k of Object.keys(sumCat)) {
      if (typeof d.categoryScores?.[k] === 'number') {
        sumCat[k] += d.categoryScores[k];
        cntCat[k]++;
      }
    }
    (d.weakPronunciation || []).forEach(w => {
      const key = (w.word || '').toLowerCase().trim();
      if (key) wordFreq.set(key, (wordFreq.get(key) || 0) + 1);
    });
    (d.tips || []).forEach(t => {
      const key = String(t).trim();
      if (key) tipFreq.set(key, (tipFreq.get(key) || 0) + 1);
    });
  }
  const avgCat = {};
  for (const k of Object.keys(sumCat)) {
    avgCat[k] = cntCat[k] > 0 ? Math.round(sumCat[k] / cntCat[k]) : null;
  }
  const topWeakWords = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  const topTips = [...tipFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  return { count: details.length, avgCat, topWeakWords, topTips };
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
