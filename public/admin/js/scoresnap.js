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
    // 직전 세션 (localStorage) 있으면 이어서 보기 분기
    const prev = _loadSession();
    if (prev) {
      const minutesAgo = Math.max(1, Math.round((Date.now() - prev.savedAt) / 60000));
      const cont = (typeof window.showConfirm === 'function')
        ? await window.showConfirm(
            'ScoreSnap — 이전 채점 결과',
            `${minutesAgo}분 전 채점한 "${prev.answerKey?.testName || '시험'}" (${prev.students?.length || 0}명) 이어서 보시겠어요?\n\n[확인] 이어서 / [취소] 새로 시작 (이전 결과 삭제)`
          )
        : true;
      if (cont) {
        _state = {
          phase: 'init',
          answerKey: prev.answerKey,
          students: prev.students.map(s => ({ ...s, image: null })),  // image 는 없음 (재채점 불가)
          precision: false,
        };
        _renderOverlay();
        _renderResultGrid();
        return;
      } else {
        _clearSession();
      }
    }
    const ok = (typeof window.showConfirm === 'function')
      ? await window.showConfirm('ScoreSnap', '시험지 채점을 시작할까요?')
      : true;
    if (!ok) return;
    _state = { phase: 'init', answerKey: null, students: [] };
    _renderOverlay();
    _renderAnswerKeyCapture();
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

  // ─── T7-B. 정답지 촬영 화면 ───
  function _renderAnswerKeyCapture() {
    _state.phase = 'answerKey-capture';
    _setHeader('📋 ScoreSnap · 1단계: 정답지 촬영');
    const body = document.getElementById('ssBody');
    if (!body) return;
    const precision = _state.precision === true;
    const precisionBadge = precision
      ? '<span style="display:inline-block;background:#5a3a1a;color:#ffc107;border:1px solid #ffc107;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:6px;">🎯 정밀 모드</span>'
      : '';
    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;flex-shrink:0;">
        <div style="font-size:13px;color:#bbb;line-height:1.6;">
          정답이 표시된 시험지 1장을 먼저 촬영해 주세요. AI 가 문제·정답을 자동으로 인식합니다.
          (시험지 출력 시 <b style="color:#fff;">[답지 보기]</b> 옵션 켜고 인쇄한 것 권장)
          ${precisionBadge}
        </div>
      </div>
      <div id="ssAkBody" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 30px;gap:18px;overflow-y:auto;min-height:0;">
        <div style="font-size:48px;">📋</div>
        <div style="font-size:14px;color:#bbb;text-align:center;line-height:1.5;">
          정답이 포함된 시험지 1장 촬영
          ${precision ? '<br><span style="font-size:11px;color:#ffc107;">정밀 모드 — 해상도·정확도 ↑, 응답 +3~5초</span>' : ''}
        </div>
        <input id="ssAkCamIn" type="file" accept="image/*" capture="environment" style="display:none;">
        <input id="ssAkGalIn" type="file" accept="image/*" style="display:none;">
        <button id="ssAkCamBtn"
          style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:18px 40px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
          📷 정답지 촬영
        </button>
        <button id="ssAkGalBtn"
          style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #444;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">
          🖼 갤러리에서 선택
        </button>
      </div>
    `;
    const camIn = document.getElementById('ssAkCamIn');
    const galIn = document.getElementById('ssAkGalIn');
    document.getElementById('ssAkCamBtn').onclick = () => camIn.click();
    document.getElementById('ssAkGalBtn').onclick = () => galIn.click();
    camIn.onchange  = (e) => _handleAnswerKeyFile(e.target.files?.[0]);
    galIn.onchange  = (e) => _handleAnswerKeyFile(e.target.files?.[0]);
  }

  async function _handleAnswerKeyFile(file) {
    if (!file) return;
    const body = document.getElementById('ssAkBody');
    if (body) body.innerHTML = `<div style="color:#bbb;text-align:center;font-size:14px;padding:40px;">⏳ 이미지 처리 중…</div>`;
    try {
      const precision = _state.precision === true;
      const processed = await window._ssProcessImage(file, { precision });
      _state.answerKeyImage = processed;
      _renderAnswerKeyOcr(processed, precision);
    } catch (e) {
      if (body) body.innerHTML = `
        <div style="color:#ff8a80;text-align:center;font-size:14px;line-height:1.5;padding:30px;">
          이미지 처리 실패<br><span style="color:#999;font-size:12px;">${esc(e.message)}</span>
        </div>
        <button onclick="window._ssAkRestart()" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">다시 시도</button>
      `;
    }
  }

  // 정답지 OCR 호출 + 진행 표시
  async function _renderAnswerKeyOcr(processed, precision = false) {
    _state.phase = 'answerKey-ocr';
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:18px;">
        <div style="width:48px;height:48px;border:4px solid #333;border-top-color:var(--c-brand,#E8714A);border-radius:50%;animation:ssSpin 1s linear infinite;"></div>
        <div style="font-size:15px;color:#fff;font-weight:600;">AI 가 정답지 분석 중…${precision ? ' (정밀 모드)' : ''}</div>
        <div style="font-size:12px;color:#888;line-height:1.5;text-align:center;">${precision ? '보통 8~13초' : '보통 5~10초'}<br>문제·정답 자동 추출</div>
      </div>
      <style>@keyframes ssSpin { to { transform: rotate(360deg); } }</style>
    `;
    try {
      const idToken = await window._ssGetIdToken();
      const r = await fetch('/api/scoresnap-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          mode: 'answerKey',
          imageBase64: processed.base64,
          imageMimeType: processed.mimeType,
          precision,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      _state.answerKey = data;
      _renderAnswerKeyReview();
    } catch (e) {
      body.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;gap:14px;text-align:center;max-width:420px;margin:0 auto;">
          <div style="font-size:48px;">⚠</div>
          <div style="font-size:15px;color:#ff8a80;font-weight:600;">정답지 분석 실패</div>
          <div style="font-size:13px;color:#bbb;line-height:1.6;">${esc(e.message)}</div>
          <button onclick="window._ssAkRestart()" style="margin-top:14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">다시 촬영</button>
        </div>
      `;
    }
  }

  // 추출된 정답지 검토 — 학원장이 오류 직접 수정
  function _renderAnswerKeyReview() {
    _state.phase = 'answerKey-review';
    _setHeader('📋 ScoreSnap · 정답지 검토');
    const body = document.getElementById('ssBody');
    if (!body) return;
    const k = _state.answerKey || {};
    const qs = k.questions || [];
    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:12px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;color:#fff;">${esc(k.testName || '시험')} · ${qs.length}문항 인식됨 ${_state.precision === true ? '<span style="font-size:10px;color:#ffc107;font-weight:400;">🎯 정밀</span>' : ''}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">정답만 직접 수정 가능. 보기·문제 텍스트 인식 부족하면 [🎯 정밀 모드] 재촬영</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="window._ssAkRestart()" style="background:transparent;color:#bbb;border:1px solid #444;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;">🔄 다시 촬영</button>
          ${_state.precision === true
            ? ''
            : '<button onclick="window._ssAkPrecisionRetry()" style="background:#5a3a1a;color:#ffc107;border:1px solid #ffc107;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;" title="해상도 ↑ + AI 보수 모드. 응답 +3~5초">🎯 정밀 모드 재촬영</button>'}
        </div>
      </div>
      <div id="ssAkReviewList" style="flex:1;overflow-y:auto;padding:14px;background:#0a0a0a;">
        ${qs.map((q, i) => _buildAnswerKeyRow(q, i)).join('') || '<div style="color:#888;text-align:center;padding:40px;">문항이 인식되지 않았어요. 다시 촬영해 주세요.</div>'}
      </div>
      <div style="padding:14px 18px;border-top:1px solid #333;display:flex;justify-content:center;gap:10px;flex-shrink:0;">
        <button onclick="window.closeScoreSnap()" style="background:transparent;color:#bbb;border:1px solid #444;padding:11px 22px;border-radius:8px;font-size:13px;cursor:pointer;">취소</button>
        <button onclick="window._ssAkConfirm()" style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:11px 30px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;${qs.length === 0 ? 'opacity:0.5;pointer-events:none;' : ''}">
          ✓ 정답지 확정 → 학생 답안 채점
        </button>
      </div>
    `;
  }

  function _buildAnswerKeyRow(q, idx) {
    const isMcq = q.type === 'mcq';
    const lowConf = q.confidence < 0.8;
    const choicesHtml = isMcq && Array.isArray(q.choices) && q.choices.length
      ? `<div style="font-size:11px;color:#bbb;margin-top:4px;">${q.choices.map((c, j) => `${['①','②','③','④','⑤'][j] || j+1} ${esc(c)}`).join(' &nbsp; ')}</div>`
      : '';
    return `
      <div style="background:${lowConf ? '#3a2a1a' : '#1a1a1a'};border:1px solid ${lowConf ? '#ffc107' : '#333'};border-radius:6px;padding:10px 14px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-size:13px;font-weight:700;color:#fff;">Q${q.no} <span style="font-size:10px;color:#888;font-weight:400;">[${isMcq ? '객관식' : '단답'}]</span> ${lowConf ? '<span style="font-size:10px;color:#ffc107;">⚠ 검토</span>' : ''}</div>
          <div style="font-size:10px;color:#666;">conf ${Math.round((q.confidence || 0) * 100)}%</div>
        </div>
        <div style="font-size:12px;color:#ddd;margin-top:4px;line-height:1.5;">${esc(q.stem) || '<span style="color:#666;">(문제 없음)</span>'}</div>
        ${choicesHtml}
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
          <span style="font-size:11px;color:#888;flex-shrink:0;">정답:</span>
          <input type="text" value="${esc(q.answer || '')}"
            onchange="window._ssAkEditAnswer(${idx}, this.value)"
            style="flex:1;padding:5px 8px;background:#0a0a0a;border:1px solid #555;border-radius:4px;color:#fff;font-size:12px;font-family:inherit;">
        </div>
      </div>
    `;
  }

  // 학원장 정답 직접 수정
  window._ssAkEditAnswer = function (idx, val) {
    if (!_state.answerKey?.questions?.[idx]) return;
    const q = _state.answerKey.questions[idx];
    q.answer = String(val || '').trim();
    // MCQ 면 choices 에서 매칭되는 인덱스 찾아 answerIdx 갱신
    if (q.type === 'mcq' && Array.isArray(q.choices)) {
      const matchIdx = q.choices.findIndex(c => c === q.answer);
      if (matchIdx >= 0) q.answerIdx = matchIdx;
    }
    // confidence 높여서 회색으로 (수동 수정한 거니까)
    q.confidence = 1.0;
    // 해당 카드만 갱신은 어려우니 전체 다시 그림
    _renderAnswerKeyReview();
  };

  window._ssAkRestart = function () {
    _state.answerKey = null;
    _state.answerKeyImage = null;
    _state.precision = false;  // 다시 촬영은 기본 모드로
    _renderAnswerKeyCapture();
  };

  // 정밀 모드로 재촬영 — 해상도 + maxTokens + temperature 조정
  window._ssAkPrecisionRetry = function () {
    _state.answerKey = null;
    _state.answerKeyImage = null;
    _state.precision = true;
    _renderAnswerKeyCapture();
  };

  // 정답지 확정 → 학생 답안 단계
  window._ssAkConfirm = function () {
    if (!_state.answerKey?.questions?.length) return;
    _state.students = [];
    _renderStudentCapture();
  };

  // ─── T7-C. 학생 답안지 일괄 촬영 화면 ───
  function _renderStudentCapture() {
    _state.phase = 'student-capture';
    _setHeader('🎓 ScoreSnap · 2단계: 학생 답안지');
    const body = document.getElementById('ssBody');
    if (!body) return;
    const k = _state.answerKey;
    const precision = _state.precision === true;
    const precisionBadge = precision
      ? '<span style="display:inline-block;background:#5a3a1a;color:#ffc107;border:1px solid #ffc107;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:6px;">🎯 정밀</span>'
      : '';

    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;flex-shrink:0;">
        <div style="font-size:14px;font-weight:600;color:#fff;">${esc(k.testName || '시험')} · ${k.questions.length}문항 ${precisionBadge}</div>
        <div style="font-size:11px;color:#888;margin-top:3px;">학생 답안지 여러 장 추가 후 [🚀 일괄 채점] 누르세요. 이름란의 손글씨로 학생 자동 구분.</div>
      </div>
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex-shrink:0;">
        <input id="ssStCamIn" type="file" accept="image/*" capture="environment" style="display:none;">
        <input id="ssStGalIn" type="file" accept="image/*" multiple style="display:none;">
        <button id="ssStCamBtn"
          style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
          📷 사진 추가 촬영
        </button>
        <button id="ssStGalBtn"
          style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #444;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer;">
          🖼 갤러리 다중 선택
        </button>
        <div style="flex:1;"></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:${precision ? '#ffc107' : '#888'};cursor:pointer;">
          <input type="checkbox" id="ssStPrecision" ${precision ? 'checked' : ''} onchange="window._ssStTogglePrecision(this.checked)" style="cursor:pointer;">
          🎯 정밀 모드
        </label>
      </div>
      <div id="ssStThumbs" style="flex:1;overflow-y:auto;padding:14px;background:#0a0a0a;min-height:0;">
        ${_buildStudentThumbsHtml()}
      </div>
      <div style="padding:14px 18px;border-top:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px;flex-wrap:wrap;">
        <button onclick="window._ssBackToAnswerKey()" style="background:transparent;color:#bbb;border:1px solid #444;padding:10px 16px;border-radius:6px;font-size:12px;cursor:pointer;">← 정답지 검토로</button>
        <div style="flex:1;text-align:center;font-size:12px;color:#888;" id="ssStCount">${_state.students.length}장 추가됨</div>
        <button id="ssStGradeBtn" onclick="window._ssStartBatchGrade()"
          ${_state.students.length === 0 ? 'disabled' : ''}
          style="background:${_state.students.length === 0 ? '#444' : 'var(--c-brand,#E8714A)'};color:#fff;border:none;padding:11px 24px;border-radius:8px;font-size:14px;font-weight:700;cursor:${_state.students.length === 0 ? 'not-allowed' : 'pointer'};${_state.students.length === 0 ? 'opacity:0.5;' : ''}">
          🚀 일괄 채점 (${_state.students.length}명)
        </button>
      </div>
    `;
    const camIn = document.getElementById('ssStCamIn');
    const galIn = document.getElementById('ssStGalIn');
    document.getElementById('ssStCamBtn').onclick = () => camIn.click();
    document.getElementById('ssStGalBtn').onclick = () => galIn.click();
    camIn.onchange = (e) => _handleStudentFiles(e.target.files);
    galIn.onchange = (e) => _handleStudentFiles(e.target.files);
  }

  function _buildStudentThumbsHtml() {
    const list = _state.students || [];
    if (list.length === 0) {
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#666;text-align:center;gap:14px;padding:40px;">
          <div style="font-size:48px;">🎓</div>
          <div style="font-size:14px;">학생 답안지를 추가해 주세요</div>
          <div style="font-size:11px;color:#555;line-height:1.6;">
            한 장씩 촬영하거나, 갤러리에서 여러 장 한 번에 선택 가능.<br>
            이름란 손글씨로 학생 자동 구분됩니다.
          </div>
        </div>
      `;
    }
    const rows = list.map((s, i) => `
      <div style="position:relative;background:#1a1a1a;border:1px solid #333;border-radius:6px;overflow:hidden;">
        <img src="${s.image.dataUrl}" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#000;">
        <div style="position:absolute;top:4px;left:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;">${i + 1}</div>
        <button onclick="window._ssStRemove(${i})" title="삭제"
          style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,0.85);color:#fff;border:none;width:24px;height:24px;border-radius:50%;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
        <div style="font-size:10px;color:#888;padding:4px 6px;text-align:center;">${s.image.sizeKB} KB</div>
      </div>
    `).join('');
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
        ${rows}
      </div>
    `;
  }

  async function _handleStudentFiles(files) {
    if (!files || files.length === 0) return;
    const precision = _state.precision === true;
    const thumbs = document.getElementById('ssStThumbs');
    const before = _state.students.length;
    // 다중 파일 처리 — 순차 (대량일 때 메모리 안전)
    for (const file of files) {
      try {
        const processed = await window._ssProcessImage(file, { precision });
        _state.students.push({ image: processed, status: 'pending', result: null, error: null });
      } catch (e) {
        console.warn('[scoresnap] image process 실패:', e.message);
      }
    }
    if (_state.students.length > before) {
      // 썸네일·카운트·버튼 갱신 (전체 다시 그림)
      _renderStudentCapture();
    }
    // input value 비움 (같은 파일 재선택 가능)
    const camIn = document.getElementById('ssStCamIn');
    const galIn = document.getElementById('ssStGalIn');
    if (camIn) camIn.value = '';
    if (galIn) galIn.value = '';
  }

  window._ssStRemove = function (idx) {
    if (!_state.students || idx < 0 || idx >= _state.students.length) return;
    _state.students.splice(idx, 1);
    _renderStudentCapture();
  };

  window._ssStTogglePrecision = function (checked) {
    _state.precision = checked === true;
  };

  window._ssBackToAnswerKey = function () {
    // 정답지 검토 화면으로 (재촬영 X — 그대로 유지)
    if (!_state.answerKey?.questions?.length) {
      _renderAnswerKeyCapture();
      return;
    }
    _renderAnswerKeyReview();
  };

  // ─── 일괄 채점 — 동시 호출 3개 throttle ───
  const BATCH_CONCURRENCY = 3;

  window._ssStartBatchGrade = async function () {
    const list = _state.students || [];
    if (list.length === 0) return;
    _state.phase = 'batch-grading';
    _setHeader(`🚀 ScoreSnap · 일괄 채점 (${list.length}명)`);
    _renderBatchProgress();

    let done = 0;
    const update = () => {
      const el = document.getElementById('ssBatchProgress');
      if (el) {
        const success = list.filter(s => s.status === 'done').length;
        const failed = list.filter(s => s.status === 'error').length;
        el.innerHTML = `채점 중 ${done}/${list.length}<br><span style="font-size:11px;color:#888;">✓ ${success}명 · ${failed > 0 ? `<span style="color:#ff8a80;">✗ ${failed}명</span>` : '실패 없음'}</span>`;
      }
    };
    update();

    // worker pool
    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const myIdx = cursor++;
        const s = list[myIdx];
        s.status = 'grading';
        try {
          s.result = await _gradeOneStudent(s.image);
          s.status = 'done';
        } catch (e) {
          s.error = e.message || '채점 실패';
          s.status = 'error';
        }
        done++;
        update();
      }
    }
    await Promise.all(Array(Math.min(BATCH_CONCURRENCY, list.length)).fill(0).map(() => worker()));

    // 전부 끝나면 결과 목록 (T7-D 자리표시자 — 현재는 간이 표시)
    _renderBatchResults();
  };

  async function _gradeOneStudent(image) {
    const idToken = await window._ssGetIdToken();
    const r = await fetch('/api/scoresnap-grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        mode: 'student',
        imageBase64: image.base64,
        imageMimeType: image.mimeType,
        answerKeyQuestions: _state.answerKey.questions,
        precision: _state.precision === true,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  function _renderBatchProgress() {
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:18px;">
        <div style="width:48px;height:48px;border:4px solid #333;border-top-color:var(--c-brand,#E8714A);border-radius:50%;animation:ssSpin 1s linear infinite;"></div>
        <div style="font-size:15px;color:#fff;font-weight:600;">학생 답안 채점 중…</div>
        <div id="ssBatchProgress" style="font-size:13px;color:#bbb;line-height:1.6;text-align:center;"></div>
        <div style="font-size:11px;color:#666;text-align:center;line-height:1.6;max-width:320px;">
          동시 ${BATCH_CONCURRENCY}명 병렬 처리. 학생당 보통 5~10초.
        </div>
      </div>
      <style>@keyframes ssSpin { to { transform: rotate(360deg); } }</style>
    `;
  }

  // ─── T7-D. 학생별 결과 카드 그리드 ───
  function _renderBatchResults() {
    _renderResultGrid();
  }

  function _renderResultGrid() {
    _state.phase = 'result-grid';
    _saveSession();  // 진입 시점에 항상 최신 결과 localStorage 백업
    _setHeader(`📊 ScoreSnap · 결과 (${_state.answerKey?.testName || '시험'})`);
    const body = document.getElementById('ssBody');
    if (!body) return;
    const list = _state.students || [];
    const done = list.filter(s => s.status === 'done').length;
    const failed = list.filter(s => s.status === 'error').length;

    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;color:#fff;">채점 완료 · ${esc(_state.answerKey?.testName || '시험')}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">총 ${list.length}명 · ✓ ${done}명 성공${failed > 0 ? ` · <span style="color:#ff8a80;">✗ ${failed}명 실패</span>` : ''} · 카드 클릭 → 상세</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="window._ssBackToStudentCapture()" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;">+ 답안지 추가</button>
          <button onclick="window.closeScoreSnap()" style="background:transparent;color:#bbb;border:1px solid #444;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;">종료</button>
        </div>
      </div>
      <div id="ssResultGrid" style="flex:1;overflow-y:auto;padding:16px;background:#0a0a0a;">
        ${_buildResultGridHtml()}
      </div>
    `;
  }

  function _buildResultGridHtml() {
    const list = _state.students || [];
    if (list.length === 0) return '<div style="color:#888;text-align:center;padding:40px;">결과 없음</div>';
    const cards = list.map((s, i) => _buildStudentCardHtml(s, i)).join('');
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">${cards}</div>`;
  }

  function _buildStudentCardHtml(s, idx) {
    if (s.status === 'error') {
      return `
        <div onclick="window._ssRetryOne(${idx})" style="background:#2a1a1a;border:1px solid #5a3030;border-radius:8px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:11px;color:#999;">#${idx + 1}</div>
          <div style="font-size:24px;text-align:center;">⚠</div>
          <div style="font-size:12px;color:#ff8a80;text-align:center;font-weight:600;">채점 실패</div>
          <div style="font-size:10px;color:#888;text-align:center;line-height:1.4;max-height:32px;overflow:hidden;">${esc(s.error || '오류')}</div>
          <div style="font-size:10px;color:#888;text-align:center;margin-top:4px;">↻ 클릭 재시도</div>
        </div>
      `;
    }
    const r = s.result || {};
    const pct = r.scorePercent || 0;
    const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';
    const name = (r.studentName || '').trim() || `(이름 미인식 #${idx + 1})`;
    return `
      <div onclick="window._ssOpenStudentDetail(${idx})" style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:border-color 0.15s;"
        onmouseover="this.style.borderColor='#666'" onmouseout="this.style.borderColor='#333'">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;color:#888;">#${idx + 1}</div>
          <div style="font-size:10px;color:${color};font-weight:700;">${pct}점</div>
        </div>
        <div style="font-size:14px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</div>
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span style="font-size:24px;font-weight:800;color:${color};line-height:1;">${r.correctCount || 0}</span>
          <span style="font-size:13px;color:#888;">/ ${r.totalQuestions || 0}</span>
        </div>
        ${(r.uncertainQuestions || []).length > 0 ? `<div style="font-size:10px;color:#ffc107;">⚠ ${r.uncertainQuestions.length} 검토</div>` : ''}
        <div style="font-size:10px;color:#666;text-align:center;margin-top:auto;">상세 보기 →</div>
      </div>
    `;
  }

  // 실패 카드 재시도
  window._ssRetryOne = async function (idx) {
    const s = _state.students?.[idx];
    if (!s || s.status === 'grading') return;
    s.status = 'grading';
    s.error = null;
    // 그리드 카드만 갱신 어려우니 전체 재렌더
    _renderResultGrid();
    try {
      s.result = await _gradeOneStudent(s.image);
      s.status = 'done';
    } catch (e) {
      s.error = e.message;
      s.status = 'error';
    }
    _renderResultGrid();
  };

  // ─── 학생 상세 화면 ───
  window._ssOpenStudentDetail = function (idx) {
    const s = _state.students?.[idx];
    if (!s || s.status !== 'done') return;
    _state.detailIdx = idx;
    _state.phase = 'student-detail';
    _setHeader(`📊 ScoreSnap · ${esc(s.result.studentName || `학생 #${idx + 1}`)}`);
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:12px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0;">
        <button onclick="window._ssCloseStudentDetail()" style="background:transparent;color:#bbb;border:1px solid #444;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;">← 목록</button>
        <div style="font-size:11px;color:#888;">#${idx + 1} / ${_state.students.length}</div>
      </div>
      <div id="ssDetailRoot" style="flex:1;overflow-y:auto;background:#0a0a0a;padding:16px;">
        <div id="ssDetailCard" style="background:#fff;color:#222;max-width:680px;margin:0 auto;padding:24px 28px;border-radius:10px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;">
          ${_buildStudentDetailHtml(s, idx)}
        </div>
      </div>
      <div style="padding:12px 18px;border-top:1px solid #333;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;flex-shrink:0;">
        <button onclick="window._ssDownloadStudentPng(${idx})" style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">📥 PNG 다운로드</button>
        ${idx > 0 ? `<button onclick="window._ssOpenStudentDetail(${idx - 1})" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 18px;border-radius:8px;font-size:13px;cursor:pointer;">← 이전</button>` : ''}
        ${idx < _state.students.length - 1 ? `<button onclick="window._ssOpenStudentDetail(${idx + 1})" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 18px;border-radius:8px;font-size:13px;cursor:pointer;">다음 →</button>` : ''}
      </div>
    `;
  };

  function _buildStudentDetailHtml(s, idx) {
    const r = s.result || {};
    const total = r.totalQuestions || 0;
    const correct = r.correctCount || 0;
    const pct = r.scorePercent || 0;
    const wrongNos = r.wrongNumbers || [];
    const uncertain = new Set(r.uncertainQuestions || []);
    const dateStr = _fmtDate(new Date());

    // 검토 필요 카드 (confidence 낮음) — AI 가 자신 없는 항목만 별도 강조
    const reviewCards = (r.answers || []).filter(a => uncertain.has(a.no)).map(a => `
      <div style="border:1px solid #ffc107;background:#fff8e1;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:12px;">
        <div style="font-weight:700;color:#e65100;margin-bottom:4px;">Q${a.no} · ${a.isCorrect ? '✓' : '✗'} · conf ${Math.round((a.confidence||0)*100)}%${a._adminOverride ? ' · <span style="color:#1976d2;">수정됨</span>' : ''}</div>
        <div style="color:#555;line-height:1.6;">
          학생답: <b>${esc(a.studentAnswer || '(빈칸)')}</b> &nbsp;→&nbsp;
          정답: <b>${esc(a.correctAnswer || '?')}</b>
        </div>
        <div style="margin-top:6px;display:flex;gap:6px;">
          ${a.isCorrect
            ? `<button onclick="window._ssToggleAnswer(${idx}, ${a.no}, false)" style="font-size:11px;padding:4px 10px;border:1px solid #c62828;background:#fff;color:#c62828;border-radius:4px;cursor:pointer;">✗ 오답으로 수정</button>`
            : `<button onclick="window._ssToggleAnswer(${idx}, ${a.no}, true)" style="font-size:11px;padding:4px 10px;border:1px solid #2e7d32;background:#fff;color:#2e7d32;border-radius:4px;cursor:pointer;">✓ 정답으로 수정</button>`
          }
        </div>
      </div>
    `).join('');

    // 전체 문항 — ✓/✗ 자체가 토글 버튼 (학원장 직접 수정)
    const allRows = (r.answers || []).map(a => `
      <div style="display:flex;gap:10px;padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;align-items:center;">
        <span style="width:30px;color:#888;font-weight:700;">Q${a.no}</span>
        <button onclick="window._ssToggleAnswer(${idx}, ${a.no}, ${!a.isCorrect})"
          title="클릭 → ${a.isCorrect ? '오답' : '정답'}으로 변경"
          style="width:30px;height:24px;border:1px solid ${a.isCorrect ? '#2e7d32' : '#c62828'};background:${a.isCorrect ? '#e8f5e9' : '#ffebee'};color:${a.isCorrect ? '#2e7d32' : '#c62828'};border-radius:4px;cursor:pointer;font-weight:700;font-size:13px;padding:0;line-height:1;">${a.isCorrect ? '✓' : '✗'}</button>
        <span style="flex:1;min-width:0;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.studentAnswer || '(빈칸)')}</span>
        <span style="color:#888;font-size:11px;">→ ${esc(a.correctAnswer || '?')}</span>
        ${a._adminOverride ? '<span style="color:#1976d2;font-size:10px;flex-shrink:0;">수정</span>' : ''}
      </div>
    `).join('');

    return `
      <div style="margin-bottom:14px;border-bottom:2px solid #333;padding-bottom:12px;">
        <div style="font-size:11px;color:#888;">${esc(window.MY_ACADEMY_NAME || '')}</div>
        <div style="font-size:17px;font-weight:800;color:#111;margin-top:2px;line-height:1.4;word-break:keep-all;">${esc(_state.answerKey?.testName || '시험')}</div>
        <div style="font-size:11px;color:#555;margin-top:4px;">총 ${total}문항 · 채점일 ${esc(dateStr)}</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 12px;border:1px solid #999;border-radius:6px;background:#fff;">
          <span style="font-size:13px;color:#555;font-weight:600;flex-shrink:0;">학생:</span>
          <input id="ssDetailNameIn" type="text" value="${esc(r.studentName || '')}"
            placeholder="이름 직접 입력"
            oninput="window._ssEditStudentName(${idx}, this.value)"
            style="flex:1;min-width:0;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;font-family:inherit;font-weight:600;">
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;background:#e8f5e9;border-left:4px solid #2e7d32;padding:12px 16px;border-radius:6px;">
          <div style="font-size:11px;color:#666;">점수</div>
          <div style="font-size:26px;font-weight:800;color:#2e7d32;line-height:1.1;margin-top:4px;">${correct} / ${total} <span style="font-size:14px;color:#777;">(${pct}점)</span></div>
        </div>
        <div style="flex:2;min-width:200px;background:#fff3e0;border-left:4px solid #e65100;padding:12px 16px;border-radius:6px;">
          <div style="font-size:11px;color:#666;">틀린 문항</div>
          <div style="font-size:15px;font-weight:700;color:#bf360c;line-height:1.4;margin-top:4px;">${wrongNos.length ? wrongNos.join(', ') : '없음 (만점!)'}</div>
        </div>
      </div>

      ${reviewCards ? `
        <div style="margin-bottom:18px;">
          <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:8px;">⚠ 검토 필요 (AI 가 자신 없음)</div>
          ${reviewCards}
        </div>
      ` : ''}

      <details style="margin-bottom:6px;" open>
        <summary style="font-size:13px;font-weight:700;color:#333;cursor:pointer;padding:6px 0;">📋 전체 문항 (${total}개) <span style="font-weight:400;color:#888;font-size:11px;">— ✓/✗ 클릭하여 직접 수정 가능</span></summary>
        <div style="margin-top:8px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          ${allRows}
        </div>
      </details>
    `;
  }

  function _fmtDate(d) {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  window._ssCloseStudentDetail = function () {
    _state.detailIdx = null;
    _renderResultGrid();
  };

  window._ssBackToStudentCapture = function () {
    _renderStudentCapture();
  };

  // 학생 이름 직접 수정 — 자동 localStorage 저장
  window._ssEditStudentName = function (idx, val) {
    const s = _state.students?.[idx];
    if (!s?.result) return;
    s.result.studentName = String(val || '').trim();
    _saveSession();
  };

  // 학원장 정답 토글 — 자동 localStorage 저장
  window._ssToggleAnswer = function (idx, no, makeCorrect) {
    const s = _state.students?.[idx];
    if (!s?.result || !Array.isArray(s.result.answers)) return;
    const a = s.result.answers.find(x => x.no === no);
    if (!a) return;
    a.isCorrect = makeCorrect === true;
    a._adminOverride = true;
    s.result.correctCount = s.result.answers.filter(x => x.isCorrect).length;
    s.result.scorePercent = s.result.totalQuestions > 0
      ? Math.round((s.result.correctCount / s.result.totalQuestions) * 100) : 0;
    s.result.wrongNumbers = s.result.answers.filter(x => !x.isCorrect).map(x => x.no);
    // 이름 input 보존
    const nameIn = document.getElementById('ssDetailNameIn');
    if (nameIn) s.result.studentName = nameIn.value || '';
    _saveSession();
    // 카드만 재렌더
    const card = document.getElementById('ssDetailCard');
    if (card) card.innerHTML = _buildStudentDetailHtml(s, idx);
  };

  // ─── localStorage 임시 보관 (새로고침까지 유지) ───
  // image 는 너무 커서 제외 — result 메타만 저장. 복원 시 PNG 다운로드·정답 수정은 가능, 재채점은 불가.
  const SS_LS_KEY = 'scoresnap_session_v1';
  const SS_LS_MAX_AGE = 24 * 60 * 60 * 1000;  // 24 시간

  function _saveSession() {
    try {
      if (!_state.answerKey?.questions?.length) {
        localStorage.removeItem(SS_LS_KEY);
        return;
      }
      const list = (_state.students || []).filter(s => s.status === 'done');
      if (list.length === 0) {
        // 학생 결과 없으면 저장 의미 없음 (정답지만 있는 상태)
        localStorage.removeItem(SS_LS_KEY);
        return;
      }
      const data = {
        savedAt: Date.now(),
        academyName: window.MY_ACADEMY_NAME || '',
        answerKey: _state.answerKey,
        students: list.map(s => ({ status: 'done', result: s.result })),
      };
      localStorage.setItem(SS_LS_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[scoresnap] localStorage 저장 실패:', e.message);
    }
  }

  function _loadSession() {
    try {
      const raw = localStorage.getItem(SS_LS_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.answerKey?.questions?.length || !data?.students?.length) return null;
      if (Date.now() - (data.savedAt || 0) > SS_LS_MAX_AGE) {
        localStorage.removeItem(SS_LS_KEY);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function _clearSession() {
    try { localStorage.removeItem(SS_LS_KEY); } catch (_) {}
  }

  // _renderResultGrid 진입 시 자동 저장 (학원장 수정·이름 수정도 같은 함수 호출)

  // ─── PNG 다운로드 (html2canvas 동적 로드) ───
  let _html2canvasLoading = null;
  function _ensureHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve();
    if (_html2canvasLoading) return _html2canvasLoading;
    _html2canvasLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { _html2canvasLoading = null; reject(new Error('html2canvas 로드 실패')); };
      document.head.appendChild(s);
    });
    return _html2canvasLoading;
  }

  window._ssDownloadStudentPng = async function (idx) {
    const card = document.getElementById('ssDetailCard');
    if (!card) return;
    const s = _state.students?.[idx];
    if (!s?.result) return;
    // 이름 input 현재값 보존 + value 속성 박아 캡처에 반영
    const nameIn = document.getElementById('ssDetailNameIn');
    if (nameIn) {
      s.result.studentName = nameIn.value || '';
      nameIn.setAttribute('value', nameIn.value || '');
    }
    try {
      await _ensureHtml2Canvas();
    } catch (e) {
      if (typeof window.showAlert === 'function') window.showAlert('PNG 라이브러리 로드 실패', e.message);
      return;
    }
    try {
      const canvas = await window.html2canvas(card, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
      });
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const safe = v => String(v).replace(/[\\/:*?"<>|]/g, '_');
        const name = safe(s.result.studentName || `student_${idx + 1}`);
        const title = safe(_state.answerKey?.testName || 'test');
        const date = _fmtDate(new Date()).replace(/[: ]/g, '_');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_${title}_${date}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch (e) {
      if (typeof window.showAlert === 'function') window.showAlert('PNG 생성 실패', e.message);
    }
  };

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
  // file → max-size JPEG 0.85 → { dataUrl, base64, mimeType, sizeKB, width, height }
  // opts.precision=true → 2048px (정밀 모드, OCR 인식률 ↑), 기본 1536px
  window._ssProcessImage = async function (file, opts = {}) {
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
    const maxSide = opts.precision ? 2048 : 1536;
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
