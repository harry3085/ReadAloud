# 큰소리 영어 (ReadAloudApp) — 작업 컨텍스트

## 프로젝트 개요
한국 영어 학원용 PWA. 학생 앱 + 관리자 앱 두 개로 구성.

- **학생 앱**: `public/index.html` + `public/js/app.js` + `public/style.css`
- **관리자 앱**: `public/admin/index.html` + `public/admin/js/app.js` + `public/admin/style.css`
- **서비스워커**: `public/sw.js` (FCM 백그라운드 알림 + 앱 쉘 캐시)
- **FCM SW**: `public/firebase-messaging-sw.js`
- **Firestore 규칙**: `firestore.rules`
- **Firestore 인덱스**: `firestore.indexes.json`

## 배포
- **Vercel 프로젝트**: `readaloud-app` (harry-kims-projects-2eb6982d)
- **URL**: `https://raloud.vercel.app`
- **GitHub**: `https://github.com/harry3085/ReadAloud` (브랜치: `master`)
- **배포 명령**: `npx vercel --prod --yes`
- GitHub `master` push → Vercel 자동 배포 (Production Branch = master로 설정됨)

## Firebase 프로젝트
- **Project ID**: `readaloud-51113`
- **Auth / Firestore / Storage / FCM** 모두 사용
- Firebase SDK: v10.12.0 (ES Module, CDN)

## 주요 Firestore 컬렉션 (2026-04-23 기준)
| 컬렉션 | 설명 |
|--------|------|
| `users` | 학생/관리자 계정 (role: 'admin'/'student', status: 'active'/'pause'/'out') |
| `groups` | 반(클래스) 정보 |
| `scores` | 시험 점수 — `mode` 표준 키(`vocab`/`fill_blank`/`unscramble`/`mcq`/`subjective`/`recording`) 사용 |
| `notices` | 공지사항 |
| `hwFiles` | 숙제 파일 |
| `userNotifications` | 사용자 알림 |
| `fcmTokens` | FCM 토큰 |
| `payments` | 결제 |
| `savedPushList` | 저장된 푸시 목록 |
| `pushNotifications` | 푸시 알림 목록 |
| `genBooks` | Generator 교재 (관리자 전용) |
| `genChapters` | Generator 챕터 (관리자 전용) |
| `genPages` | Generator 페이지 (관리자 전용) |
| `genQuestionSets` | AI 생성 문제 세트 (관리자 전용) |
| `genTests` | AI 시험 배정 — `testMode` 표준 키 사용. 하위 `userCompleted/{uid}` 에 학생 응시 스냅샷(questions/answers) — 최고점 통과 시에만 저장 |
| `apiUsage` | Gemini API 호출 일일 카운트 (문서 ID = `YYYY-MM-DD`). admin read / signed-in write |
| `tests` | (레거시) 관리자 시험목록 병합 조회용으로만 유지 — 쓰기 중단, 상세 스냅샷 없음 |

### Phase 6E에서 삭제된 컬렉션 (규칙·코드 모두 제거)
- `recHw` / `recSubmissions` / `recFeedbacks` / `recContents` / `recFolders` — AI 녹음숙제(`genTests.testMode='recording-ai'`)로 완전 이전
- `books` / `folders` / `units` (top-level) — 시험지 출력 제거로 더 이상 사용 안 함 (규칙은 현재 유지 중, Phase 6F 후보)

## 관리자 앱 구조 (`public/admin/js/app.js` ~6609줄)

### 핵심 유틸
```js
esc(str)          // XSS 방지 HTML escape — innerHTML 모든 곳에 적용
showToast(msg)    // 토스트 알림
showConfirm(title, sub) // Promise 기반 확인 모달 (confirm() 대신 사용)
showModal(html)   // 모달 열기
closeModal()      // 모달 닫기
```

### 페이지네이션 엔진
```js
// 데이터 → 테이블 렌더링 + 정렬 + 페이지네이션 통합
initPagination(tableId, dataArray, renderRowFn, paginationElId, pageSize)

// 내부 상태: _pageState[tableId] = { data, renderRowFn, page, pageSize, sortCol, sortDir }
renderPage(tableId)          // 현재 페이지 렌더링
refreshPagination(tableId)   // 데이터 유지하며 UI 갱신
```

**중요**: 정렬이 필요한 테이블은 반드시 `initPagination`을 사용해야 함.
직접 `innerHTML` 할당 시 `sortTable`이 작동하지 않음.

### 테이블 정렬
```js
// thead th에 onclick="sortTable('tableId', colIdx)" 추가 시 자동 작동
window.sortTable(tableId, colIdx)
```

### initPagination 적용된 테이블 목록
- `studentTableBody` / `pauseTableBody` / `outTableBody` — 학생관리
- `classTableBody` — 클래스관리
- `noticeTableBody` — 공지사항
- `testListBody` — 시험목록 (tests + genTests 병합)

## 관리자 앱 CSS (`public/admin/style.css`)

### 테마 색상
```css
--teal: #E8714A      /* 주 강조색 (코랄/오렌지) */
--teal-dark: #D85A30
--teal-light: #FEF2EC
--text: #222
--gray: #888
--border: #e0e0e0
```

### 테이블 셀 유틸리티 클래스
```css
td.td-link    /* 클릭 가능한 주요 컬럼 — 굵게, hover 시 teal */
td.td-main    /* 주요 컬럼 — 굵게, 검은색 */
td.td-sub     /* 날짜/보조 정보 — 12px, 회색 */
td.td-mono    /* 아이디 등 고정폭 — monospace */
td.td-center  /* 가운데 정렬 */
td.td-sm      /* 작은 글자 — 12px */
```

**규칙**: `<td>` 인라인 `style=""` 대신 위 클래스 사용.

### 테이블 정렬 헤더
```html
<th onclick="sortTable('tableId', 1)" class="sortable">컬럼명</th>
```

## Generator 페이지 (`public/admin/js/app.js` — loadGenerator 이하)

관리자 앱의 콘텐츠 생성 도구. 이미지 OCR → Firestore Book/Chapter/Page 구조로 저장.

### Firestore 스키마
```
genBooks   { name, createdAt, createdBy }
genChapters { name, bookId, bookName, order, createdAt }
genPages   { title, text, serialNumber, bookId, bookName, chapterId, chapterName,
             ocrConfidence, ocrProvider, imageUrl, edited, createdAt, createdBy }
```

### 상태 변수
```js
_genPages, _genChapters, _genBooks   // Firestore에서 로드한 전체 데이터
_genImages                           // 업로드된 이미지 배열
_genCheckedPages/Chapters/Books      // Set — 체크박스 다중 선택 (툴바 작업용)
_genActiveBook, _genActiveChapter, _genActivePage  // 행 클릭 네비게이션 상태
_genPageCur, _genPageSize=20         // Page 목록 페이지네이션
```

### 인터랙션 설계
- **체크박스 클릭**: `_genChecked*` Set 업데이트 → 툴바 버튼 활성/비활성
- **행 클릭**: `_genActive*` 상태 업데이트 → 필터 + 에디터 로드
  - Book 행 클릭 → Chapter/Page 목록 해당 Book으로 필터
  - Chapter 행 클릭 → Page 목록 해당 Chapter로 필터
  - Page 행 클릭 → 좌측 에디터에 내용 로드
  - 다시 클릭 시 선택 해제 (토글)
- 활성 행은 `var(--teal-light)` 배경 + `var(--teal)` 글자색으로 하이라이트

### 레이아웃
- 4컬럼 flexbox: [에디터(500px, 리사이저)] | [Page | Chapter | Book]
- 에디터 폭 드래그 리사이저: min 250px, max 60%, `localStorage('generator_editor_width')` 저장
- 높이: `calc(100vh - 280px)`

### OCR
- `POST /api/ocr` (api/ocr.js) — Google Cloud Vision DOCUMENT_TEXT_DETECTION
- 이미지 → base64 → API → genPages에 저장
- 환경변수: `GOOGLE_VISION_KEY` (JSON 또는 base64 인코딩 JSON)

### Firestore 규칙
```
match /genBooks/{id}    { allow read, write: if isAdmin(); }
match /genChapters/{id} { allow read, write: if isAdmin(); }
match /genPages/{id}    { allow read, write: if isAdmin(); }
```

## AI 문제 생성 (2026-04-19 추가)

관리자 앱의 두 번째 콘텐츠 생성 도구. Generator Page(본문) → Gemini로 객관식 4지선다 자동 출제.

### 관련 파일
- `api/generate-quiz.js` — Gemini API 호출 서버리스 함수
- `public/admin/quiz-test.html` — 독립 API 검증 페이지 (관리자 앱과 분리)
- `public/admin/js/app.js` 하단 (~6083줄 이후) — `loadQuizGenerate` / `loadQuestionSets` 등 UI 코드

### 관리자 앱 메뉴 2개 (콘텐츠 생성 섹션)
- **AI 문제 생성** (`goPage('quiz-generate')`): Page 선택 → AI 호출 → 미리보기/제외 → 세트 저장
- **문제 세트 목록** (`goPage('quiz-sets')`): `genQuestionSets` CRUD (이름변경/삭제/상세보기)

### API: `POST /api/generate-quiz`
```
body:   { pages: [{id,title,text}], count?: 1~20, type?: 'mcq' }
return: { success, model, questions: [{type,question,questionKo,choices[4],explanation,sourcePageId,difficulty}] }
```

### Gemini 모델 폴백 체인
```js
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite-preview',  // 1순위 (빠르고 저렴)
  'gemini-2.5-flash',                // 2순위 (Preview 실패 시 폴백)
];
```

### 프롬프트 구조 (`api/generate-quiz.js`)
- **시스템 프롬프트** (`SYSTEM_PROMPTS.mcq`): 한국 중·고등 독해 퀴즈 역할 부여 + 5가지 규칙 (문제 유형, 본문 근거, 선택지 4개/정답 1개, easy30/medium50/hard20 난이도 분포, JSON 출력 형식)
- **유저 프롬프트** (`buildUserPrompt`): `[Passage 1] ID/Title/본문` 형식으로 선택된 페이지들 나열 + 문제 수 지시
- **generationConfig**: `temperature:0.7`, `maxOutputTokens:8192`, `responseMimeType:'application/json'` (JSON 강제 모드)

### 제약
- 본문 최대 3000자/페이지 (초과 시 slice), 최소 20자
- 한 번에 최대 10 Page, 1~20문제
- 문제 타입 추가 시: `SYSTEM_PROMPTS`, `validators`, `buildUserPrompt.typeInstructions` 3곳 + 관리자 UI `<option>` 추가 (객체 키 구조라 확장 용이)

### 환경변수
- `GEMINI_API_KEY`: Google AI Studio에서 발급. `.env.local` + Vercel 대시보드 양쪽 등록 필요

### Firestore 규칙
```
match /genQuestionSets/{id}  { allow read, write: if isAdmin(); }
match /genTests/{testId}     { allow read: if isSignedIn(); allow write: if isAdmin(); }
```

### genQuestionSets 스키마
```
{ name, sourceType:'mcq', sourcePages:[{pageId,pageTitle,bookId,chapterId}],
  questions:[...], questionCount, aiModel, aiGeneratedAt, createdAt, createdBy, updatedAt }
```

### 상태 변수 (app.js 하단)
```js
_qgSelectedPageIds  // AI 생성 화면에서 선택된 Page IDs
_qgGenerated        // AI 생성 결과 (미리보기용)
_qgExcluded         // 미리보기에서 체크 해제된 문제 인덱스
_qsList             // 문제 세트 목록 (Firestore에서 로드)
```

### 알려진 TODO (3단계 — 다음 세션)
1. **학생 앱에 신규 `testMode: 'reading-mcq'` 화면 필요** — 현재 학생앱은 단어 meaning 모드만 있고 본문 독해 객관식 UI 없음
2. `genTests` 스키마 확정 + "시험 배정" 관리자 UI (반/학생 선택 → genTests 생성)
3. 학생앱 `tests + genTests` 병렬 조회
4. `qgRenameSet`이 `prompt()` 사용 중 — 기존 규칙(`confirm()` 금지)에 어긋남, `showModal`로 교체 필요

## Firestore 복합 인덱스 (`firestore.indexes.json`)
```json
recSubmissions: hwId(ASC) + uid(ASC)
```
배포: `firebase deploy --only firestore:indexes`

## 서비스워커 (`public/sw.js`)
- **캐시명**: `kunsori-v13` (대규모 배포 후 버전 bump 관례)
- **전략**: 앱 쉘(HTML/CSS/JS) = 네트워크 우선 → 캐시 fallback
- **자동 리로드**: 새 SW 활성화 시 `SW_UPDATED` 메시지 → 클라이언트 자동 리로드

## 보안 규칙 (`firestore.rules`)
- `isAdmin()`: Firestore에서 users/{uid}.role == 'admin' 확인
- `isOwner(uid)`: request.auth.uid == uid 확인
- 대부분 컬렉션: read = 로그인 사용자, write = 관리자 전용

## Phase 6 작업 이력 (2026-04-19 ~ 2026-04-21)

Phase 6은 전체 시험 시스템을 `genTests` 기반으로 일원화하는 대규모 리팩토링. 레거시 컬렉션과 UI를 순차적으로 제거하고 새 아키텍처로 이전.

### Phase 6A~6C (2026-04-19~04-20)
- `_TEST_TYPE_CONFIG` + `actions:['assign','print']` 패턴으로 시험 유형별 배정/출력 통일
- 단어시험 인쇄에 1단/2단 선택 추가, 배정 시 `vocabOptions`(format/direction/mcqRatio/shuffleQ) 저장
- 학생앱 v2 풀이 화면 (`_vqState`/`_uqState` — 단어시험/언스크램블)
  - 단어시험 스펠링은 `ko→en` 고정 (한글 보고 영단어 쓰기)
  - 언스크램블은 정답 확인 → 다음 진행 방식
  - 완료된 시험 재시험 허용
- 합체 카드 스타일(코랄 그라디언트 헤더 + 흰색 본문)을 단어시험/교재이해/빈칸채우기에 통일 적용
- 문제 세트 수정 모달 하단 버튼 고정 + 리사이즈 따라가기

### Phase 6D (2026-04-21): 죽은 코드 일괄 제거
- **관리자앱**: `My Book` / `My Book 출력` / `숙제목록 작성` / `숙제 생성` / `제출 현황` / 4단계 시험출제 마법사 HTML+JS 전량 제거
- **학생앱 레거시 화면 제거**: `#units` / `#modeSelect` / `#quiz` / `#spelling` / `#unscramble` + 풀이 함수들
- 총 감소: ~4,660줄 (admin/js `9940→7149`, student/js `5556→4745`, admin/html `1304→957`, student/html `851→733`)
- SW 캐시 `v9→v10`

### Phase 6E (2026-04-21): 레거시 녹음숙제 완전 제거 + Firestore rules 정리
- **학생앱**: `#recHwList` / `#recHwDetail` 화면 + `goRecHw`/`loadRecHwList`/`openRecHwDetail`/`submitRec`/`updateRecBadge` 등 전체 제거 (353줄)
- **관리자 대시보드**: `loadDashRecStatus` + '녹음숙제 제출현황' 위젯 제거
- **학생앱 랭킹**: '녹음숙제' 탭 제거 (점수 랭킹만 유지)
- **firestore.rules**: `recHw`/`recSubmissions`/`recFeedbacks`/`recContents`/`recFolders` 5개 컬렉션 규칙 삭제 + `firebase deploy --only firestore:rules` 배포
- **홈 메뉴 재추가**: 녹음숙제 카드가 AI 경로(`goRecAi()` → `#recAiList` → `startRecAi`)로 재지정, 목록은 `genTests(testMode='recording-ai')`만 로드 — 이전 커밋에서 메뉴카드가 완전히 사라진 버그 수정
- SW 캐시 `v10→v11→v12`

### 2026-04-21: 관리자앱 사이드바 재배치
- '교재 & 시험' nav-group 해체 → '시험 관리' 섹션으로 평면화
- 6개 시험 유형 + 시험 목록 모두 최상위 nav-item으로 승격, 각 항목에 SVG 아이콘 추가
- 사이드바/pageLabels에서 이모지 전부 제거 (📚/🎯/🎨/📊/💬/📋/🖨/✨/📁 등)
- **시험지 출력 기능 전체 삭제**: `#page-test-print` + `loadPrintTestList`/`buildFolderBookTree`/`treeSort`/`renderFolderTree`/`treeCheck*`/`doPrintExamFromTree`/`printMixedExamPDF` 등 504줄 제거
- SW 캐시 `v12→v13`

### 알려진 Phase 6F 후보 (미완료)
1. `firestore.rules`의 `books`/`folders`/`units`(top-level)/`tests` 규칙 제거 — 시험지 출력 제거로 쓰임새 없어짐. 관리자 시험목록이 `tests` 병합 표시를 그만두는 쪽으로 정리
2. `public/js/app.js`에 남은 admin-in-student 고아 헬퍼 (`loadAdminUnits` 등) 정리
3. 고아 `onclick` 핸들러 정리 (`retrySession()`, `doStart()` — 도달 불가능한 화면이라 무해)

## 2026-04-23: Gemini 단일모델 전환 + 성적 상세 모달 재작성

### 1) Gemini API 단일 모델 전략
관리자·학생 간 평가 결과 불일치 혼란 제거 목적. 3개 API 모두 `gemini-3.1-flash-lite-preview`만 사용하도록 통일 — 폴백 체인 제거.
- `api/check-recording.js` (녹음 평가)
- `api/generate-quiz.js` (AI 문제 생성)
- `api/cleanup-ocr.js` (OCR 정리·번역)
- 2.0-flash/2.5-flash 제거 이유: free tier에서 limit:0 이거나 RPD 20 등 실운영 부적합. 3.1은 RPD 500으로 충분
- 쿼터 초과 시 친화적 에러 메시지로 변환

### 2) 관리자 대시보드 Gemini 사용량 위젯 (`apiUsage` 컬렉션)
- 위치: 관리자 대시보드 `apiUsageCard` (달력 위)
- 자체 로깅: `_logApiCall(endpoint)` + `_geminiFetch(url, init)` 래퍼로 API 호출 시 `apiUsage/{YYYY-MM-DD}` 문서에 `increment()` 기록
- 학생앱도 `_logApiCall(endpoint)` 동일 구현 — 녹음 평가 호출 시 자동 기록
- 상세는 공식 대시보드 링크: `https://aistudio.google.com/rate-limit?timeRange=last-90-days&project=readaloud-51113`
- Firestore 규칙: `apiUsage/{day}` — admin read / signed-in create+update / delete 금지

### 3) scores.mode 값 표준화 (snake_case 일원화)
레거시 리터럴(`word`/`reading-mcq`/`fill-blank`/`recording-ai`) → 표준 키(`vocab`/`mcq`/`fill_blank`/`recording`)
- 마이그레이션 완료 (Firestore 전체 scores + genTests.testMode)
- 학생앱 리터럴 쓰기도 모두 표준 키로 교체
- `_TYPE_LABEL_MAP` / `_unifiedTypeBadge(mode)` 로 배지 통일 (파란색 계열)
- 성적 리포트 '종류→유형' 통일, 5개 유형 필터 (vocab/fill_blank/unscramble/mcq/recording)
- 마이그레이션 후 관련 도구 버튼 제거 완료

### 4) 시험목록 출제일 시각 추가
- `_fmtTestDateTime(t)` — `YY-MM-DD HH:mm` 포맷
- 최신순 정렬 유지

### 5) 관리자 성적 상세 모달 전면 재작성
기존: 레거시 `tests` 컬렉션 기반 단순 단어/문장 목록만 표시 → 학생앱과 동떨어진 UX

신규 설계:
- 데이터 소스: `genTests/{testId}/userCompleted/{uid}` 의 `questions + answers` 스냅샷
- 유형별 상세 빌더 5종 (학생앱 `_vqBuildDetail`/`_mcqBuildDetail`/`_fbBuildDetail`/`_uqBuildDetail` 이식 + 녹음용 `_adminRecBuildDetail` 신규)
- 디스패처: `_adminBuildDetail(mode, comp)` 가 vocab/mcq/fill_blank/unscramble/recording 분기

**3가지 비-상세 케이스 구분** (매우 중요 — `_writeUserCompleted`는 최고점 통과 시에만 `questions/answers` 저장):
1. genTests 자체 없음 → **레거시 시험** 안내
2. passed=false → **미통과 기록** 안내 (상세는 통과한 최고점만 저장)
3. passed=true 이지만 `comp.score !== s.score || comp.date !== s.date` → **재응시 기록** 안내 (기존 최고점 이하)
- 매칭 기준: `comp.score === s.score && comp.date === s.date`

### 6) 성적 상세 모달 레이아웃 표준화 (시험배정 모달과 동일 패턴)
모달 구조 규약을 CLAUDE.md에 명문화 — **"작업 규칙" 6번** 참고

## 주요 버그 수정 이력

### 학생앱 녹음숙제 (2026-04-18)
- **원인**: `recSubmissions` 규칙이 `isOwner`만 허용하는데, 쿼리에 `uid` 필터 없이 `hwId`만으로 조회 → Firestore가 쿼리 전체 거부
- **수정**: `loadRecHwList`, `openRecHwDetail`, `updateRecBadge` 3곳에 `where('uid','==',myUid)` 추가
- **파일**: `public/js/app.js`

### 학생앱 스펠링 시험 모바일 키보드 자동완성 (2026-04-18 / 최종 2026-04-20)
- **원인**: 숨겨진 `<input type="text">`에 `autocomplete="off"` 등을 설정해도 iOS/Android 키보드의 예측 텍스트(QuickType)는 HTML 속성으로 차단 불가
- **최종 해결 (Phase 6C)**: `type="password"` + `autocomplete="new-password"`. iOS 예측 텍스트·비밀번호 관리자 둘 다 안정적으로 차단됨 (commit c0fb278 기준)
- **적용 범위**: `#vqSpellInput` (v2 단어시험), `#spellInput` (레거시 — Phase 6D에서 제거됨), `fb-input-*` (빈칸채우기)

### 관리자앱 모듈 로드 실패 (2026-04-21, Phase 6D 회귀)
- **증상**: `Uncaught SyntaxError: Unexpected token '}'` → `goPage`/`toggleNav` ReferenceError
- **원인**: Phase 6D 대규모 코드 제거 중 `updateNotice` 함수 뒤에 고아 `};`가 남아 ES 모듈 전체 파싱 실패
- **교훈**: 함수 블록 단위 삭제 후 반드시 `node --check *.mjs`로 모듈 모드 파싱 검증 필요 (일반 `node -c`는 module-aware하지 않을 수 있음)

### 학생앱 renderRanking 조기 종료 (2026-04-21, Phase 6E 회귀)
- **증상**: 녹음숙제 랭킹 탭 삭제 시 `if(tab==='score'){...}` 블록의 닫는 `}`도 함께 삭제되어 함수가 파일 끝까지 "삼켜짐"
- **탐지 방법**: `node --check` 자체는 통과 (파일 전체 brace 균형 맞음) — 함수 경계 스캐너 스크립트로 발견
- **수정**: if-score 블록 닫는 `}` 복구

## 작업 규칙 (중요)
1. **XSS**: 모든 사용자 데이터는 `esc()` 필수
2. **confirm/alert 금지**: `showConfirm()` / `showToast()` 사용
3. **테이블**: 반드시 `initPagination` 사용, 직접 innerHTML 할당 금지 (Generator는 커스텀 렌더 사용)
4. **색상**: 테이블 글자는 `var(--text)` (검은색), 보조 정보는 `var(--gray)`
5. **배포**: 변경 후 `git add → git commit → git push origin master → npx vercel --prod --yes`
6. **관리자 모달 레이아웃 패턴** (시험배정 모달 기준 — 2026-04-23 확립):
   - `showModal(html)` **기본 모드는 modalBox의 padding을 0으로 초기화**한다 (`box.style.padding = ''`). 콘텐츠 자체가 header/body/footer 섹션별 padding을 제공해야 함.
   - 표준 구조:
     ```html
     <div style="width:min(XXXpx,92vw);max-height:88vh;display:flex;flex-direction:column;">
       <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
         <!-- 헤더: 타이틀 + 부제 / 우측 배지 등 -->
       </div>
       <div style="padding:16px 22px;overflow-y:auto;flex:1;">
         <!-- 본문: 섹션 헤더 "font-weight:700;font-size:13px;margin-bottom:8px;" 로 구분 -->
       </div>
       <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
         <!-- 풋터 버튼: 취소/닫기 = btn-secondary, 주 액션 = btn-primary 우측 -->
       </div>
     </div>
     ```
   - 폭 가이드: 단순 상세/확인 → 560px, 폼/배정 → 640px, 복잡한 에디터 → `showModal(html, {fullFlex:true})` 로 860px flex 모드
7. **userCompleted 스냅샷 규칙** (`_writeUserCompleted`):
   - 학생 시험 제출 시 `genTests/{testId}/userCompleted/{uid}` 에 기록
   - `latestScore`/`latestPassed`/`latestAt` 는 매번 업데이트
   - `questions`/`answers`/`score`/`passed`/`date` 등 상세 스냅샷은 **최고점 통과 시에만** 저장 (`passed && score > prevBest`)
   - → 관리자 상세 모달은 `s.score === comp.score && s.date === comp.date` 일 때만 상세 표시
8. **Gemini 모델 단일화** (2026-04-23): 모든 API는 `gemini-3.1-flash-lite-preview` 만 사용. 폴백 체인 추가 금지 (버전 간 결과 차이로 관리자·학생 혼란 발생 → 실패 시 친화적 에러 메시지만 표시)
9. **Gemini API 호출 로깅**: 새 Gemini 호출 추가 시 반드시 `_logApiCall(endpoint)` 또는 `_geminiFetch()` 래퍼 경유 — `apiUsage/{YYYY-MM-DD}` 에 자동 카운트

## 파일 크기 참고 (2026-04-23)
- `public/admin/js/app.js`: ~7960줄 (Gemini 위젯 + 성적 상세 재작성으로 증가)
- `public/admin/index.html`: ~865줄
- `public/js/app.js`: ~4765줄 (API 로깅 + mode 리터럴 표준화 반영)
- `public/index.html`: ~662줄
- SW 캐시: `kunsori-v74`
