// ScoreSnap — 종이 시험지 OCR 채점 (No-Storage MVP, 2026-05-11)
// featureFlags.scoreSnap=true 학원에서만 활성화.
//
// 워크플로우 (재설계 — 정답지 먼저, 학생 답안지 일괄):
//   1) 정답지 1장 촬영 → AI OCR → 검토 (T7-B 작업 대기)
//   2) 학생 답안지 여러 장 (반복 추가 또는 갤러리 다중 선택) (T7-C)
//   3) 일괄 채점 + 이름란 OCR → 학생별 결과 목록 (T7-D)
//   4) 학생 카드 클릭 → 상세 + PNG 다운로드 (T5 결과 카드 재사용)
//
// 현재 상태 (T7-A 완료):
//   - 헤더 더블클릭 진입점 + featureFlag (T2)
//   - 풀스크린 오버레이 + 닫기 + 카메라 자원 해제 (T3 인프라)
//   - 카메라 + 이미지 처리 + 미리보기 (T4)
//   - 결과 카드 골격 + 학원장 수정 + PNG (T5)
//   - 진입점은 임시 자리표시자 — T7-B 정답지 촬영 작업 대기

(function () {
  'use strict';

  // 모듈 state
  let _state = {};
  let _stream = null;
  let _scanRaf = 0;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── T2. 헤더 진입점 ───
  let _ssEntrypointBound = false;
  window._ssBindEntrypoint = function () {
    if (_ssEntrypointBound) return;
    const flags = window.MY_FEATURE_FLAGS || {};
    if (flags.scoreSnap !== true) return;
    const headerLogo = document.querySelector('.header-logo');
    if (!headerLogo) return;
    headerLogo.style.cursor = 'pointer';
    headerLogo.title = 'ScoreSnap (더블클릭)';
    headerLogo.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (typeof window.openScoreSnap === 'function') window.openScoreSnap();
    });
    _ssEntrypointBound = true;
    console.log('[scoresnap] 진입점 활성화 (헤더 로고 더블클릭)');
  };

  // ─── 풀스크린 오버레이 + 진입 ───
  window.openScoreSnap = async function () {
    const ok = (typeof window.showConfirm === 'function')
      ? await window.showConfirm('ScoreSnap', '시험지 채점을 시작할까요?')
      : true;
    if (!ok) return;
    _state = { phase: 'init', answerKey: null, students: [] };
    _renderOverlay();
    _renderPlaceholder();
  };

  function _renderOverlay() {
    if (document.getElementById('scoreSnapOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'scoreSnapOverlay';
    ov.style.cssText = [
      'position:fixed', 'inset:0',
      'background:#111', 'color:#fff',
      'z-index:99999',
      'display:flex', 'flex-direction:column',
      'font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif',
    ].join(';');
    ov.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <span id="ssHeaderTitle" style="font-size:16px;font-weight:700;">📷 ScoreSnap</span>
        <button id="ssClose" aria-label="닫기" style="background:transparent;border:none;color:#fff;font-size:28px;cursor:pointer;line-height:1;padding:0 6px;">×</button>
      </div>
      <div id="ssBody" style="flex:1;overflow:auto;display:flex;flex-direction:column;"></div>
    `;
    document.body.appendChild(ov);
    document.getElementById('ssClose').onclick = closeScoreSnap;
  }

  function closeScoreSnap() {
    _releaseCamera();
    document.getElementById('scoreSnapOverlay')?.remove();
    _state = {};
  }
  window.closeScoreSnap = closeScoreSnap;

  function _setHeader(text) {
    const el = document.getElementById('ssHeaderTitle');
    if (el) el.textContent = text;
  }

  // ── T7-A 자리표시자 ──
  function _renderPlaceholder() {
    _state.phase = 'placeholder';
    _setHeader('📷 ScoreSnap');
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;gap:14px;text-align:center;max-width:520px;margin:0 auto;">
        <div style="font-size:48px;">📋</div>
        <div style="font-size:17px;font-weight:700;color:#fff;">정답지 → 학생 답안지 워크플로우</div>
        <div style="font-size:13px;color:#bbb;line-height:1.7;background:#1a1a1a;border:1px dashed #444;border-radius:8px;padding:16px 20px;text-align:left;">
          1. 정답이 포함된 시험지 1장을 먼저 촬영 (정답지)<br>
          2. AI 가 정답 추출 + 검토 화면<br>
          3. 학생 답안지 여러 장 일괄 촬영<br>
          4. 이름란 OCR 로 학생별 자동 구분 + 채점<br>
          5. 학생별 카드 클릭 → 상세 + PNG 다운로드
        </div>
        <div style="font-size:12px;color:#888;line-height:1.6;">
          T7-B / T7-C / T7-D 작업 후 활성화됩니다.<br>
          QR / setId / 인덱스 추적 모두 폐기 — 시험지 종이만 있으면 채점 가능.
        </div>
        <button onclick="window.closeScoreSnap()" style="margin-top:14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">종료</button>
      </div>
    `;
  }

  // ─── 카메라 자원 해제 (T7-B/C 에서 재사용) ───
  function _releaseCamera() {
    if (_scanRaf) cancelAnimationFrame(_scanRaf);
    _scanRaf = 0;
    if (_stream) {
      _stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      _stream = null;
    }
  }

  // ─── 이미지 처리 헬퍼 (T4 — T7-B/C 에서 재사용) ───
  // file → 1536px max JPEG 0.85 → { dataUrl, base64, mimeType, sizeKB, width, height }
  window._ssProcessImage = async function (file) {
    if (!/^image\//.test(file.type) && file.type !== '') {
      throw new Error('이미지 파일만 가능해요');
    }
    const imgUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이미지 로드 실패 (지원하지 않는 형식일 수 있어요)'));
      i.src = imgUrl;
    });
    const maxSide = 1536;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(imgUrl);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('JPEG 변환 실패');

    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('FileReader 실패'));
      r.readAsDataURL(blob);
    });
    const base64 = String(dataUrl).split(',')[1] || '';
    return {
      dataUrl, base64,
      mimeType: 'image/jpeg',
      sizeKB: Math.round(blob.size / 1024),
      width: canvas.width,
      height: canvas.height,
    };
  };

  // 모듈 state 외부 접근 (T7-D 결과 화면에서 student name 등 set 용)
  Object.defineProperty(window, '_ssState', { get: () => _state });

  // _renderResultScreen / PNG 다운로드 / 학원장 토글 — T7-D 에서 다시 정의
})();
