// 화이트라벨 프리셋 — 서버(Node) 사이드용. public/js/branding-presets.js 와 동기 유지 필수.
// 변경 시 양쪽 파일 모두 수정.

const BRANDING_PRESETS = {
  coral:  { id: 'coral',  name: '코랄 핑크',         emoji: '🌸', isDefault: true, primary: '#E8714A', primaryDark: '#D85A30', primaryLight: '#FFB89A', primaryBg: '#FFF0E8', primaryText: '#FFFFFF', accentSecondary: '#EF9F27', loginGradient: 'linear-gradient(160deg,#E8714A,#D85A30)', headerGradient: 'linear-gradient(150deg,#E8714A,#D85A30)' },
  blue:   { id: 'blue',   name: '마린 블루',         emoji: '🐋', primary: '#4A90E2', primaryDark: '#2E6FB8', primaryLight: '#A0C4F0', primaryBg: '#E8F1FB', primaryText: '#FFFFFF', accentSecondary: '#5DC7E0', loginGradient: 'linear-gradient(160deg,#4A90E2,#2E6FB8)', headerGradient: 'linear-gradient(150deg,#4A90E2,#2E6FB8)' },
  green:  { id: 'green',  name: '포레스트 그린',     emoji: '🌿', primary: '#52B788', primaryDark: '#358B5E', primaryLight: '#A4DCC0', primaryBg: '#E8F6EE', primaryText: '#FFFFFF', accentSecondary: '#F4A259', loginGradient: 'linear-gradient(160deg,#52B788,#358B5E)', headerGradient: 'linear-gradient(150deg,#52B788,#358B5E)' },
  purple: { id: 'purple', name: '라벤더 퍼플',       emoji: '💜', primary: '#9B59B6', primaryDark: '#763D8C', primaryLight: '#C9A0DC', primaryBg: '#F3E8F8', primaryText: '#FFFFFF', accentSecondary: '#F39C12', loginGradient: 'linear-gradient(160deg,#9B59B6,#763D8C)', headerGradient: 'linear-gradient(150deg,#9B59B6,#763D8C)' },
  orange: { id: 'orange', name: '선셋 오렌지',       emoji: '🍊', primary: '#FF8C42', primaryDark: '#E0701F', primaryLight: '#FFC499', primaryBg: '#FFF1E5', primaryText: '#FFFFFF', accentSecondary: '#3A86FF', loginGradient: 'linear-gradient(160deg,#FF8C42,#E0701F)', headerGradient: 'linear-gradient(150deg,#FF8C42,#E0701F)' },
  pink:   { id: 'pink',   name: '체리 핑크',         emoji: '🌺', primary: '#E91E63', primaryDark: '#B0144C', primaryLight: '#F48FB1', primaryBg: '#FCE4EC', primaryText: '#FFFFFF', accentSecondary: '#7E57C2', loginGradient: 'linear-gradient(160deg,#E91E63,#B0144C)', headerGradient: 'linear-gradient(150deg,#E91E63,#B0144C)' },
  navy:   { id: 'navy',   name: '미드나이트 네이비', emoji: '🌙', primary: '#2C3E50', primaryDark: '#1A252F', primaryLight: '#5D7287', primaryBg: '#E8EBEF', primaryText: '#FFFFFF', accentSecondary: '#E67E22', loginGradient: 'linear-gradient(160deg,#2C3E50,#1A252F)', headerGradient: 'linear-gradient(150deg,#2C3E50,#1A252F)' },
};

const DEFAULT_PRESET_ID = 'coral';

module.exports = { BRANDING_PRESETS, DEFAULT_PRESET_ID };
