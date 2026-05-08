// 화이트라벨 색상 프리셋 7종 — 학생 앱 + 학원장 앱 + super 앱 공통
// 사용: <script src="/js/branding-presets.js"></script> 후 window.BRANDING_PRESETS 접근.
// 또는 import { BRANDING_PRESETS } from './branding-presets.js'.

// 각 프리셋의 bgGradient — 학생 앱 홈 화면 배경 (위→아래 진한→연한 7스톱 fade)
// 기존 코랄 그라디언트(#B02F44→#FFE8DB) 와 동일한 패턴을 색상별로 변형
const BRANDING_PRESETS = {
  coral: {
    id: 'coral', name: '코랄 핑크', emoji: '🌸', isDefault: true,
    primary: '#E8714A', primaryDark: '#D85A30', primaryLight: '#FFB89A',
    primaryBg: '#FFF0E8', primaryText: '#FFFFFF', accentSecondary: '#EF9F27',
    loginGradient: 'linear-gradient(160deg,#E8714A,#D85A30)',
    headerGradient: 'linear-gradient(150deg,#E8714A,#D85A30)',
    bgGradient: 'linear-gradient(180deg,#B02F44 0%,#C93848 10%,#E14E47 22%,#F07258 36%,#FF9575 52%,#FFC4AB 72%,#FFE8DB 100%)',
  },
  blue: {
    id: 'blue', name: '마린 블루', emoji: '🐋',
    primary: '#4A90E2', primaryDark: '#2E6FB8', primaryLight: '#A0C4F0',
    primaryBg: '#E8F1FB', primaryText: '#FFFFFF', accentSecondary: '#5DC7E0',
    loginGradient: 'linear-gradient(160deg,#4A90E2,#2E6FB8)',
    headerGradient: 'linear-gradient(150deg,#4A90E2,#2E6FB8)',
    bgGradient: 'linear-gradient(180deg,#1A3D6E 0%,#234F8A 10%,#2E6FB8 22%,#4A90E2 36%,#7AAFEA 52%,#B5D2F2 72%,#E8F1FB 100%)',
  },
  green: {
    id: 'green', name: '포레스트 그린', emoji: '🌿',
    primary: '#52B788', primaryDark: '#358B5E', primaryLight: '#A4DCC0',
    primaryBg: '#E8F6EE', primaryText: '#FFFFFF', accentSecondary: '#F4A259',
    loginGradient: 'linear-gradient(160deg,#52B788,#358B5E)',
    headerGradient: 'linear-gradient(150deg,#52B788,#358B5E)',
    bgGradient: 'linear-gradient(180deg,#1F5C3D 0%,#2A7350 10%,#358B5E 22%,#52B788 36%,#7BC8A0 52%,#B8E0CC 72%,#E8F6EE 100%)',
  },
  purple: {
    id: 'purple', name: '라벤더 퍼플', emoji: '💜',
    primary: '#9B59B6', primaryDark: '#763D8C', primaryLight: '#C9A0DC',
    primaryBg: '#F3E8F8', primaryText: '#FFFFFF', accentSecondary: '#F39C12',
    loginGradient: 'linear-gradient(160deg,#9B59B6,#763D8C)',
    headerGradient: 'linear-gradient(150deg,#9B59B6,#763D8C)',
    bgGradient: 'linear-gradient(180deg,#5A2D6B 0%,#693378 10%,#763D8C 22%,#9B59B6 36%,#B47DCB 52%,#D8B8E5 72%,#F3E8F8 100%)',
  },
  orange: {
    id: 'orange', name: '선셋 오렌지', emoji: '🍊',
    primary: '#FF8C42', primaryDark: '#E0701F', primaryLight: '#FFC499',
    primaryBg: '#FFF1E5', primaryText: '#FFFFFF', accentSecondary: '#3A86FF',
    loginGradient: 'linear-gradient(160deg,#FF8C42,#E0701F)',
    headerGradient: 'linear-gradient(150deg,#FF8C42,#E0701F)',
    bgGradient: 'linear-gradient(180deg,#9C4A14 0%,#BD5D18 10%,#E0701F 22%,#FF8C42 36%,#FFAB73 52%,#FFD2AE 72%,#FFF1E5 100%)',
  },
  pink: {
    id: 'pink', name: '체리 핑크', emoji: '🌺',
    primary: '#E91E63', primaryDark: '#B0144C', primaryLight: '#F48FB1',
    primaryBg: '#FCE4EC', primaryText: '#FFFFFF', accentSecondary: '#7E57C2',
    loginGradient: 'linear-gradient(160deg,#E91E63,#B0144C)',
    headerGradient: 'linear-gradient(150deg,#E91E63,#B0144C)',
    bgGradient: 'linear-gradient(180deg,#7A0F36 0%,#990F40 10%,#B0144C 22%,#E91E63 36%,#EE5C8A 52%,#F8B4C7 72%,#FCE4EC 100%)',
  },
  navy: {
    id: 'navy', name: '미드나이트 네이비', emoji: '🌙',
    primary: '#2C3E50', primaryDark: '#1A252F', primaryLight: '#5D7287',
    primaryBg: '#E8EBEF', primaryText: '#FFFFFF', accentSecondary: '#E67E22',
    loginGradient: 'linear-gradient(160deg,#2C3E50,#1A252F)',
    headerGradient: 'linear-gradient(150deg,#2C3E50,#1A252F)',
    bgGradient: 'linear-gradient(180deg,#0F1B26 0%,#15202C 10%,#1A252F 22%,#2C3E50 36%,#5D7287 52%,#A8B3BF 72%,#E8EBEF 100%)',
  },
};

const DEFAULT_PRESET_ID = 'coral';

function getPresetById(id) {
  return BRANDING_PRESETS[id] || BRANDING_PRESETS[DEFAULT_PRESET_ID];
}

function getAllPresets() {
  return Object.values(BRANDING_PRESETS);
}

// CSS 변수에 프리셋 주입 — 학생/학원장 앱 어디서든 호출
// 가드: 누락된 키는 setProperty 안 함 → :root 의 default 가 그대로 살아남음
// (빈 string 으로 set 하면 default 무효화되어 background:none 으로 평가됨 — 흰 버튼 버그 방지)
function applyPresetToCss(preset) {
  if (!preset) return;
  const root = document.documentElement;
  const setIf = (name, val) => { if (val) root.style.setProperty(name, val); };
  setIf('--brand-primary', preset.primary);
  setIf('--brand-primary-dark', preset.primaryDark);
  setIf('--brand-primary-light', preset.primaryLight);
  setIf('--brand-primary-bg', preset.primaryBg);
  setIf('--brand-primary-text', preset.primaryText);
  setIf('--brand-accent-secondary', preset.accentSecondary);
  setIf('--brand-login-gradient', preset.loginGradient);
  setIf('--brand-header-gradient', preset.headerGradient);
  setIf('--brand-bg-gradient', preset.bgGradient);
  setIf('--bg-gradient', preset.bgGradient);
  // 학원장 앱 호환 (--teal 별칭)
  setIf('--teal', preset.primary);
  setIf('--teal-dark', preset.primaryDark);
  setIf('--teal-light', preset.primaryBg);
  // 학생 앱 호환 (--c-brand 별칭)
  setIf('--c-brand', preset.primary);
  setIf('--c-brand-dark', preset.primaryDark);
  setIf('--c-brand-cream', preset.primaryBg);
  // theme-color 메타
  if (preset.primary) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = preset.primary;
  }
  window.CURRENT_PRESET = preset;
}

// 글로벌 노출 — 일반 <script> 로 로드. window.* 만 사용.
// ES Module 로 쓰려면 동적 import('./branding-presets.js') 또는 별도 미러 파일.
// (export 키워드는 일반 script context 에서 syntax error 라 dual-mode 불가)
if (typeof window !== 'undefined') {
  window.BRANDING_PRESETS = BRANDING_PRESETS;
  window.DEFAULT_PRESET_ID = DEFAULT_PRESET_ID;
  window.getPresetById = getPresetById;
  window.getAllPresets = getAllPresets;
  window.applyPresetToCss = applyPresetToCss;
  // 페이지 로드 즉시 default(coral) 적용 — onAuthStateChanged 가 발화 안 하거나
  // 늦어지는 경우(자동 로그아웃 후 redirect 등) 흰 화면 방지
  // 그 후 학원/LexiAI 색이 비동기로 덮어씀 (정상 흐름)
  applyPresetToCss(BRANDING_PRESETS[DEFAULT_PRESET_ID]);
}
