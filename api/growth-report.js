// api/growth-report.js
// 학생 성장 리포트 생성 (placeholder — T1~T9 한도 인프라 검증용)
// POST body: { idToken, studentUid, period }   period 예: '2026-04', 'last30d'
// Response: { success, report }
// 인증: idToken 검증 + 학원 growthReport 월 쿼터
//
// ⚠️ 본 핸들러는 한도 차단·카운터 증가까지만 검증. 실제 데이터 수집·Gemini 호출은 후속 작업.

const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');

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
    const { idToken, studentUid, period } = req.body || {};

    // 인증 + 성장 리포트 월 쿼터 체크
    const q = await verifyAndCheckQuota({ idToken, quotaKind: 'growthReport' });
    if (q.error) return res.status(q.status).json({ error: q.error, limit: q.limit, currentCount: q.currentCount });

    if (!studentUid || typeof studentUid !== 'string') {
      return res.status(400).json({ error: 'studentUid required' });
    }
    if (!period || typeof period !== 'string') {
      return res.status(400).json({ error: 'period required' });
    }

    // TODO: 학생 데이터 수집 (scores / userCompleted / 녹음 결과 등)
    // TODO: Gemini API 호출 — 성장 리포트 생성
    // TODO: growthReports 컬렉션에 저장 (academyId / studentUid / period / report / generatedAt / generatedBy)
    const report = {
      placeholder: true,
      message: 'growth-report 핸들러는 placeholder 입니다. 실제 리포트 생성은 후속 작업.',
      academyId: q.academyId,
      studentUid,
      period,
    };

    // 호출 성공 시 카운터 증가 (한도 체크 통과 후)
    await incrementUsage({ ...q, res });

    return res.json({ success: true, report });
  } catch (err) {
    console.error('[growth-report]', err);
    return res.status(500).json({ error: err.message });
  }
};
