const vision = require('@google-cloud/vision');
const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');

// 블록 텍스트 재구성 — symbols + detectedBreak 으로 공백/줄바꿈 복원
function _blockText(block) {
  let txt = '';
  for (const para of block.paragraphs || []) {
    for (const word of para.words || []) {
      const w = (word.symbols || []).map(s => s.text || '').join('');
      txt += w;
      const brk = word.symbols?.[word.symbols.length - 1]?.property?.detectedBreak?.type;
      if (brk === 'SPACE' || brk === 'SURE_SPACE') txt += ' ';
      else if (brk === 'EOL_SURE_SPACE' || brk === 'LINE_BREAK') txt += '\n';
      else if (brk === 'HYPHEN') txt += '';
    }
  }
  return txt;
}

// 2단 레이아웃 자동 감지 + 컬럼 재정렬 (2026-05-24 — 좌우 2단 단어장 OCR 섞임 fix)
// 좌/우 컬럼이 명확히 갈릴 때만 [좌 전체 → 우 전체] y순 재조합. 단일 컬럼은 원본 그대로.
function _reorderByColumns(full) {
  const text = full.text || '';
  const page = full.pages?.[0];
  if (!page || !Array.isArray(page.blocks) || page.blocks.length < 4) return { text, reordered: false };
  const W = page.width || 0;
  if (!W) return { text, reordered: false };

  const blocks = page.blocks.map(b => {
    const vs = b.boundingBox?.vertices || [];
    const xs = vs.map(v => v.x || 0);
    const ys = vs.map(v => v.y || 0);
    const cx = xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    return { cx, minY, txt: _blockText(b).trim() };
  }).filter(b => b.txt);

  const mid = W / 2;
  const left = blocks.filter(b => b.cx < mid);
  const right = blocks.filter(b => b.cx >= mid);

  // 2단 판정 (보수적):
  //  - 양쪽 각 2블록 이상
  //  - 좌/우 평균 x 차이가 페이지 폭의 25% 이상 (명확히 분리)
  if (left.length >= 2 && right.length >= 2) {
    const lAvg = left.reduce((a, b) => a + b.cx, 0) / left.length;
    const rAvg = right.reduce((a, b) => a + b.cx, 0) / right.length;
    if ((rAvg - lAvg) >= W * 0.25) {
      left.sort((a, b) => a.minY - b.minY);
      right.sort((a, b) => a.minY - b.minY);
      const reorderedText = [...left, ...right].map(b => b.txt).join('\n');
      return { text: reorderedText, reordered: true };
    }
  }
  return { text, reordered: false };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { idToken, imageBase64, mimeType } = req.body;

    // 인증 + OCR 월 쿼터 (T2/T3 5분류 분리)
    const q = await verifyAndCheckQuota({ idToken, quotaKind: 'ocr' });
    if (q.error) return res.status(q.status).json({ error: q.error, limit: q.limit, currentCount: q.currentCount });
    // 쿼터 통과 시점에 카운트 — 이후 어디서 실패해도 (파서/Gemini 5xx 등) 사용자 시도로 간주.
    // daily/monthly 단일 writer (서버) 통합 — 클라 _logApiCall 폐기, 정합성 보장.
    await incrementUsage({ ...q, res, endpoint: 'ocr' });

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 required' });
    }

    // Support GOOGLE_VISION_KEY as JSON string or base64-encoded JSON
    let credentials;
    const keyEnv = process.env.GOOGLE_VISION_KEY;
    if (!keyEnv) {
      return res.status(500).json({ error: 'GOOGLE_VISION_KEY not set' });
    }
    try {
      credentials = JSON.parse(keyEnv);
    } catch {
      credentials = JSON.parse(Buffer.from(keyEnv, 'base64').toString('utf8'));
    }

    const client = new vision.ImageAnnotatorClient({ credentials });

    const [result] = await client.documentTextDetection({
      image: { content: imageBase64 },
    });

    const full = result.fullTextAnnotation;
    if (!full) {
      return res.status(200).json({ success: true, text: '', confidence: 0, blockCount: 0, provider: 'google-vision' });
    }

    // 2단 레이아웃이면 컬럼 재정렬 (좌→우), 단일 컬럼이면 원본 그대로
    const { text, reordered } = _reorderByColumns(full);
    let totalConf = 0, wordCount = 0, blockCount = 0;

    for (const page of full.pages || []) {
      for (const block of page.blocks || []) {
        blockCount++;
        for (const para of block.paragraphs || []) {
          for (const word of para.words || []) {
            totalConf += (word.confidence || 0);
            wordCount++;
          }
        }
      }
    }

    const confidence = wordCount > 0 ? Math.round((totalConf / wordCount) * 100) : 0;

    res.status(200).json({ success: true, text, confidence, blockCount, reordered, provider: 'google-vision' });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: err.message || 'OCR failed' });
  }
};
