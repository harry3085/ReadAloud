// ScoreSnap — 종이 시험지 OCR 채점 (No-Storage MVP, 2026-05-11)
// featureFlags.scoreSnap=true 학원에서만 활성화. 모든 신규 코드는 이 파일에 격리.
// T1: 인쇄 템플릿 QR 코드 생성 헬퍼
// T2: featureFlag + 진입점 (헤더 로고 더블클릭) + 자리표시자 모달
// T3~T6: 시험식별·촬영·채점·결과·PNG (추후 채움)

(function () {
  'use strict';

  // ─── T1. QR 코드 생성 (qrcode-generator 동적 로드) ───
  window._ssQrCache = window._ssQrCache || {};
  let _ssQrLibLoading = null;

  function _ssEnsureQrLib() {
    if (typeof window.qrcode === 'function') return Promise.resolve();
    if (_ssQrLibLoading) return _ssQrLibLoading;
    _ssQrLibLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { _ssQrLibLoading = null; reject(new Error('QR 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return _ssQrLibLoading;
  }

  // testId → data:image PNG URL (캐시). 사전 호출해두면 _tpBuildPrintHtml 이 동기적으로 읽음.
  window._ssGenerateQR = async function (testId) {
    if (!testId) return '';
    const key = String(testId);
    if (window._ssQrCache[key]) return window._ssQrCache[key];
    await _ssEnsureQrLib();
    const qr = window.qrcode(0, 'M');
    qr.addData(key);
    qr.make();
    const dataUrl = qr.createDataURL(4, 0);
    window._ssQrCache[key] = dataUrl;
    return dataUrl;
  };

  // ─── T2. 헤더 더블클릭 진입점 + 자리표시자 모달 ───
  let _ssEntrypointBound = false;

  // _loadMyAcademyContext 가 academyData 받은 뒤 호출.
  // featureFlags.scoreSnap=true 학원에서만 헤더 로고에 더블클릭 리스너 부착.
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

  // T3~T6 에서 실제 워크플로우 구현. 현재는 안내 모달.
  window.openScoreSnap = async function () {
    const ok = (typeof window.showConfirm === 'function')
      ? await window.showConfirm('ScoreSnap', '시험지 채점 기능을 시작할까요?\n(T3 시험 식별 화면은 아직 작업 중)')
      : true;
    if (!ok) return;
    if (typeof window.showAlert === 'function') {
      window.showAlert('준비 중', 'T3~T6 작업이 끝나면 카메라가 열립니다. 지금은 인쇄 템플릿 QR (T1) 검증 단계예요.');
    }
  };
})();
