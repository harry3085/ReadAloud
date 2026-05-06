// 화이트라벨 색상 프리셋 7종 — 학생 앱 + 학원장 앱 + super 앱 공통
// 사용: <script src="/js/branding-presets.js"></script> 후 window.BRANDING_PRESETS 접근.
// 또는 import { BRANDING_PRESETS } from './branding-presets.js'.

const BRANDING_PRESETS = {
  coral: {
    id: 'coral',
    name: '코랄 핑크',
    emoji: '🌸',
    isDefault: true,           // LexiAI 기본
    primary: '#E8714A',
    primaryDark: '#D85A30',
    primaryLight: '#FFB89A',
    primaryBg: '#FFF0E8',
    primaryText: '#FFFFFF',
    accentSecondary: '#EF9F27',
    loginGradient: 'linear-gradient(160deg,#E8714A,#D85A30)',
    headerGradient: 'linear-gradient(150deg,#E8714A,#D85A30)',
  },
  blue: {
    id: 'blue',
    name: '마린 블루',
    emoji: '🐋',
    primary: '#4A90E2',
    primaryDark: '#2E6FB8',
    primaryLight: '#A0C4F0',
    primaryBg: '#E8F1FB',
    primaryText: '#FFFFFF',
    accentSecondary: '#5DC7E0',
    loginGradient: 'linear-gradient(160deg,#4A90E2,#2E6FB8)',
    headerGradient: 'linear-gradient(150deg,#4A90E2,#2E6FB8)',
  },
  green: {
    id: 'green',
    name: '포레스트 그린',
    emoji: '🌿',
    primary: '#52B788',
    primaryDark: '#358B5E',
    primaryLight: '#A4DCC0',
    primaryBg: '#E8F6EE',
    primaryText: '#FFFFFF',
    accentSecondary: '#F4A259',
    loginGradient: 'linear-gradient(160deg,#52B788,#358B5E)',
    headerGradient: 'linear-gradient(150deg,#52B788,#358B5E)',
  },
  purple: {
    id: 'purple',
    name: '라벤더 퍼플',
    emoji: '💜',
    primary: '#9B59B6',
    primaryDark: '#763D8C',
    primaryLight: '#C9A0DC',
    primaryBg: '#F3E8F8',
    primaryText: '#FFFFFF',
    accentSecondary: '#F39C12',
    loginGradient: 'linear-gradient(160deg,#9B59B6,#763D8C)',
    headerGradient: 'linear-gradient(150deg,#9B59B6,#763D8C)',
  },
  orange: {
    id: 'orange',
    name: '선셋 오렌지',
    emoji: '🍊',
    primary: '#FF8C42',
    primaryDark: '#E0701F',
    primaryLight: '#FFC499',
    primaryBg: '#FFF1E5',
    primaryText: '#FFFFFF',
    accentSecondary: '#3A86FF',
    loginGradient: 'linear-gradient(160deg,#FF8C42,#E0701F)',
    headerGradient: 'linear-gradient(150deg,#FF8C42,#E0701F)',
  },
  pink: {
    id: 'pink',
    name: '체리 핑크',
    emoji: '🌺',
    primary: '#E91E63',
    primaryDark: '#B0144C',
    primaryLight: '#F48FB1',
    primaryBg: '#FCE4EC',
    primaryText: '#FFFFFF',
    accentSecondary: '#7E57C2',
    loginGradient: 'linear-gradient(160deg,#E91E63,#B0144C)',
    headerGradient: 'linear-gradient(150deg,#E91E63,#B0144C)',
  },
  navy: {
    id: 'navy',
    name: '미드나이트 네이비',
    emoji: '🌙',
    primary: '#2C3E50',
    primaryDark: '#1A252F',
    primaryLight: '#5D7287',
    primaryBg: '#E8EBEF',
    primaryText: '#FFFFFF',
    accentSecondary: '#E67E22',
    loginGradient: 'linear-gradient(160deg,#2C3E50,#1A252F)',
    headerGradient: 'linear-gradient(150deg,#2C3E50,#1A252F)',
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
function applyPresetToCss(preset) {
  if (!preset) return;
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', preset.primary);
  root.style.setProperty('--brand-primary-dark', preset.primaryDark);
  root.style.setProperty('--brand-primary-light', preset.primaryLight);
  root.style.setProperty('--brand-primary-bg', preset.primaryBg);
  root.style.setProperty('--brand-primary-text', preset.primaryText);
  root.style.setProperty('--brand-accent-secondary', preset.accentSecondary);
  root.style.setProperty('--brand-login-gradient', preset.loginGradient);
  root.style.setProperty('--brand-header-gradient', preset.headerGradient);
  // 학원장 앱 호환 (--teal 별칭)
  root.style.setProperty('--teal', preset.primary);
  root.style.setProperty('--teal-dark', preset.primaryDark);
  root.style.setProperty('--teal-light', preset.primaryBg);
  // 학생 앱 호환 (--c-brand 별칭)
  root.style.setProperty('--c-brand', preset.primary);
  root.style.setProperty('--c-brand-dark', preset.primaryDark);
  root.style.setProperty('--c-brand-cream', preset.primaryBg);
  // theme-color 메타
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = preset.primary;
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
}
