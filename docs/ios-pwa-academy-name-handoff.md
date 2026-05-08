# iOS PWA 홈화면 추가 시 학원명 자동 노출 문제 — 핸드오프

작성일: 2026-05-08
관련 파일: `public/index.html`, `public/admin/index.html`, `public/js/app.js`, `public/admin/js/app.js`, `api/manifest.js`, `public/sw.js`

---

## 1. 현재 상황

### 증상
iPhone / iPad Safari, Mac Safari, Mac Chrome 등에서 [공유 → 홈화면 추가] / [도크에 추가] 시:

- **로고**: 학원 로고 정상 노출 ✅
- **이름**: `LexiAI` 또는 `L E X I A I` (super_admin 설정값) 가 노출 ❌
- 학원명 (예: '큰소리영어') 자동 적용 안 됨
- 학생/학원장이 input 에서 학원명으로 직접 수정해야 함

### 정상 동작 (참고)
| 동작 | 상태 |
|------|------|
| Android Chrome [홈에 추가] — 학원명 자동 노출 | ✅ |
| Safari 공유 화면 상단 title — 학원명 정상 표시 | ✅ |
| manifest API 응답 (`/api/manifest?academy=xxx`) — 학원명 정상 응답 | ✅ |
| document.title / 메타 — JS 로 학원명 갱신 정상 | ✅ |
| 로고 (apple-touch-icon / manifest icons) — 학원 로고 정상 | ✅ |

### 사용자 진단 결과 (모두 정상)
| 항목 | 값 | 상태 |
|------|---|------|
| localStorage academyId | default | ✅ |
| localStorage appName | 큰소리영어 | ✅ |
| meta apple-mobile-web-app-title | 큰소리영어 | ✅ |
| document.title | 큰소리영어 | ✅ |
| manifest URL | `/api/manifest?academy=default` | ✅ |
| manifest 응답 name | 큰소리영어 | ✅ |
| manifest 응답 short_name | 큰소리영어 | ✅ |

→ **데이터·서버 응답·JS 갱신 모두 정상**. iOS 가 그것을 무시하는 게 문제.

---

## 2. 근본 원인

**iOS Safari 의 [홈화면에 추가] 다이얼로그는 페이지 첫 HTML 응답 시점의 정적 `<title>` / `<meta>` 만 캡처해 사용. 이후 JS 로 변경한 값은 무시.**

```
페이지 로드 흐름:
[t=0]    HTML 응답 → 정적 <title>LexiAI</title>, 정적 메타값
         ← iOS 가 여기서 캡처해 [홈화면 추가] 다이얼로그에 사용
[t=0.1]  인라인 script → localStorage 캐시 보고 메타·title 갱신 시도
[t=0.5]  JS 모듈 로딩 → onAuthStateChanged → Firebase 인증
[t=1.0]  학원 정보 fetch → JS 가 메타·title 을 '큰소리영어' 로 갱신
         ← 너무 늦음. iOS 무시.
```

Android Chrome 은 link.href 변경 시 manifest 재fetch + 동적 갱신 인식. iOS Safari 는 미지원.

---

## 3. 시도한 해결책 (모두 실패)

| # | 시도 | 결과 |
|---|------|------|
| 1 | apple-mobile-web-app-title 메타 동적 갱신 (setAttribute) | ❌ iOS 가 첫 캡처만 사용 |
| 2 | manifest link href 동적 변경 (`replaceWith`) | ❌ |
| 3 | manifest API 응답에 `Cache-Control: no-store` | ❌ 도움 안 됨 |
| 4 | SW 캐시에서 `/manifest.json` 제거 | ✅ 부수 정리 (유지) |
| 5 | iPad 데스크톱 모드 검출 (`navigator.platform + maxTouchPoints`) | ✅ 부수 정리 (유지) |
| 6 | URL `?academy=xxx` 자동 reload | ❌ 학생앱 로그인 무한 로딩 유발 → 제거 |
| 7 | 정적 메타 제거 + JS createElement 동적 추가 | ❌ |
| 8 | 정적 `<title>` 빈 값 처리 | ❌ |

### 핵심 깨달음
super_admin `appConfig/branding.defaultAppName` 을 어떤 값으로 바꿔도:

| defaultAppName 값 | [홈화면 추가] input default |
|---|---|
| 'L E X I A I' | L E X I A I (현재) |
| 'LexiAI' | LexiAI |
| '렉시아이' | 렉시아이 |
| 빈 값 | LexiAI (정적 HTML fallback) |

→ **어느 경우든 학원명 (큰소리영어) 자동 노출 안 됨**.
JS 로 메타·title 갱신하는 모든 방식은 iOS 한계로 무효.

---

## 4. 진정한 해결책 — SSR (서버 사이드 렌더링)

iOS 가 캡처하는 **첫 HTML 응답 시점부터 학원명이 박혀있어야** 함. 클라이언트 JS 로는 불가능. 서버에서 HTML 동적 응답.

### 동작 흐름
```
사용자: raloud.vercel.app/?academy=raloud2 진입
   ↓
Vercel rewrites → /api/render-index 함수로 라우팅
   ↓
api/render-index 가 academies/raloud2 fetch
   ↓
HTML 응답 (학원명 박힘):
  <title>큰소리영어</title>
  <meta apple-mobile-web-app-title content="큰소리영어">
   ↓
iOS Safari 가 정적 응답에서 학원명 캡처
   ↓
[홈화면 추가] → '큰소리영어' 자동 노출 ✓
```

### 구현 플랜
1. `api/render.js` 신규 (학생/학원장 dispatcher 통합 — `?type=index|admin`)
2. `vercel.json` rewrites: `/` → `/api/render?type=index`, `/admin/` → `/api/render?type=admin`
3. 정적 `index.html` / `admin/index.html` 을 string template 으로 변환 (학원명·로고·캐치프레이즈 placeholder)
4. 학원 식별: URL `?academy=xxx` 또는 cookie
5. Vercel Edge Cache 학원별 분리 (`Cache-Control: public, s-maxage=300, stale-while-revalidate`)
6. Fallback: 학원 ID 없거나 fetch 실패 시 LexiAI default

### 작업 규모
| 항목 | 시간 | 위험 |
|------|------|------|
| api/render.js (학생/학원장 dispatcher 통합) | 2~3h | 중 |
| vercel.json rewrites (`/`, `/admin/`) | 30m | 저 |
| HTML template 변환 (정적 → string template) | 1h | 저 |
| Vercel CDN 캐시 전략 (학원별 분리) | 1h | 저 |
| 회귀 테스트 (SW · 로그인 · manifest · 색·로고) | 1~2h | 중 |
| **합계** | **5~7시간** | **중** |

### 부담
- ❌ 첫 페이지 로드 200~400ms 추가 (Firestore fetch — Edge cache 적용 시 감소)
- ❌ Cold start 시 1~2초 지연 (드물게)
- ❌ Vercel 함수 한도 (Hobby = 12개, 거의 다 참) → 기존 dispatcher 패턴으로 함수 1개 통합 필요
- ❌ 회귀 위험 (라우팅 변경) — 기존 SW · 인증 · 캐시와 충돌 가능

### 장점
- ✅ Android · iOS · Mac Safari · Mac Chrome 모두 자동 학원명 노출
- ✅ 학생/학원장 수동 input 수정 불필요
- ✅ 진정한 화이트라벨 PWA

---

## 5. 차선책 (SSR 도입 안 할 경우)

### 옵션 A — 그대로 두고 안내문 강화 (현재 상태)
- 학원장 [📱 바로가기] / 학생 [홈화면에 추가] alert 에 "input 에서 학원명 직접 입력" 명시 (이미 적용됨)
- iOS / Mac 사용자만 1단계 수동, Android 자동
- **현재 production 상태 = 이 옵션**

### 옵션 B — 학원별 서브도메인
- `raloud2.app.com` 등 학원별 도메인. 각 도메인의 정적 HTML 에 학원명 박힘
- 도메인·인증서 작업 큼. Vercel Pro 필요.

### 옵션 C — 빌드 시 학원별 정적 HTML 사전 생성
- Vercel build 시 모든 학원 doc 읽어 학원별 HTML 생성 (`/raloud2/index.html` 등)
- 새 학원 추가 시 redeploy 필요. 학원 수 늘면 빌드 시간 증가.

---

## 6. 부수 정리 사항 (SSR 와 무관)

### super_admin 의 LexiAI 브랜딩 → 기본 앱 이름
- 현재 `'L E X I A I'` (띄어쓰기) 입력됨
- 이게 학원 정보 받기 전 fallback 으로 잠깐 메타에 박혀 [홈화면 추가] input 에 노출
- → `'LexiAI'` (붙임) 또는 빈 값으로 정정 권장 (SSR 도입 여부와 무관)
- super 앱 → [🎨 LexiAI 브랜딩] → 기본 앱 이름 칸 수정

---

## 7. 현재 코드 상태 (안정)

이 핸드오프 작성 시점 기준 production 상태:

- 학생앱 로그인 정상 ✅
- 자동 reload 코드 제거됨 ✅
- 정적 `<title>LexiAI</title>` 와 정적 메타 (apple-mobile-web-app-title 등) 복원됨 ✅
- JS 가 메타·title 동적 갱신 (setAttribute 패턴, 단순화됨) ✅
- 부수 fix 유지: SW manifest 캐시 제거 / Cache-Control no-store / iPad 데스크톱 모드 검출 / localStorage academyId 캐시 ✅
- alert 안내문에 "input 학원명 직접 수정" 명시 ✅

SW 버전: `kunsori-v357`
관련 commit: `be80e5f`, `0c465e4`, `4e3a7ae` (당일 마지막 commit 들)

---

## 8. 결정 필요

1. **SSR 도입** (5~7시간, 진정한 해결)
2. **차선 그대로 두기** (Android 자동, iOS 수동 — 현재 상태)
3. **학원별 서브도메인** (도메인 작업 큼)
4. **빌드 시 학원별 정적 HTML** (학원 추가 시 redeploy 필요)

검토 후 결정 알려주세요.

---

## 참고: 관련 코드 위치

- 정적 `<title>` 과 메타: [public/index.html:6](../public/index.html#L6), [public/admin/index.html:8](../public/admin/index.html#L8)
- 인라인 script (FOUC 방지 + 메타 갱신): [public/index.html:14-58](../public/index.html#L14-L58), [public/admin/index.html:60-93](../public/admin/index.html#L60-L93)
- 학원 정보 적용: [public/js/app.js:_applyAcademyBranding](../public/js/app.js), [public/admin/js/app.js:_applyAdminBranding](../public/admin/js/app.js)
- manifest API: [api/manifest.js](../api/manifest.js)
- SW 캐시 전략: [public/sw.js](../public/sw.js)
- [홈화면 추가] alert: [public/js/app.js:installApp](../public/js/app.js), [public/admin/index.html:installAdminApp](../public/admin/index.html)
