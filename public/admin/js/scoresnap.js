// ScoreSnap — 종이 시험지 OCR 채점 (No-Storage MVP, 2026-05-11 T1 인프라)
// featureFlags.scoreSnap=true 학원에서만 활성화. 모든 신규 코드는 이 파일에 격리.
// T1: 인쇄 템플릿 QR 코드 생성 헬퍼 (qrcode-generator 동적 로드)
// T2~T6: 진입점·시험식별·촬영·채점·결과 (추후 채움)

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
    // typeNumber=0 (자동), errorCorrectLevel='M' (15%)
    const qr = window.qrcode(0, 'M');
    qr.addData(key);
    qr.make();
    // moduleSize=4px → testId 한 줄 (≤30자) 기준 ~80×80
    const dataUrl = qr.createDataURL(4, 0);
    window._ssQrCache[key] = dataUrl;
    return dataUrl;
  };

  // T2~T6 자리표시자 — 진입점·시험식별·촬영·채점·PNG (추후 구현)
  window.openScoreSnap = function () {
    if (typeof window.showAlert === 'function') {
      window.showAlert('ScoreSnap', '아직 활성화되지 않았어요 (T2 진입점 작업 대기)');
    }
  };
})();
