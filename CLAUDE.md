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

## 2026-04-24: UX 일관성 정비 — 모달·정렬·라벨·작업 컬럼 통일

당일 10건 배포(SW v75 → v85). 시각/동작 일관성 관점의 정리 작업.

### 1) 관리자 모달 전면 표준화 (~24개)
시험배정·성적상세 모달과 동일 패턴(작업 규칙 6번)으로 통일:
- **Generator 8개**: Page/Chapter/Book × 생성·수정·이동
- **학생/반/공지/숙제파일/결제/시험 수정**: 11개 (반 생성·수정/반 배정/재원생/공지 작성·수정/숙제파일 등록·수정/결제 등록/시험 수정/학생 수정)
- **AI 정리 5개**: 비교/일괄 결과/프리셋 선택/프리셋 매니저/프리셋 편집
- **AI 문제 생성 2개**: 결과 미리보기/프롬프트 편집
- **MCQ 배정 대상 선택 1개**
- 모두 외곽 `width:min(XXXpx,92vw); max-height:88vh; flex column` + 헤더 18·22 / 본문 16·22 / 풋터 14·22 + border + 우측 정렬
- `genEditPage`의 `box.style.width='700px'` override 제거 → inner wrapper가 폭 결정
- **fullFlex 유지**: `qsViewDetail`/`qsEditSet`/시험배정 풀에디터 등 (큰 콘텐츠/리사이즈 필요)

### 2) Generator 정렬 통일 — `_genRecentSort` 헬퍼
```js
function _genRecentSort(arr) {
  const t = x => (x?.updatedAt?.toMillis?.() || x?.createdAt?.toMillis?.() || 0);
  return [...arr].sort((a,b) => t(b) - t(a));
}
```
- **적용**: Chapter/Book 테이블, Chapter 이동/Book 이동 모달
- **`updatedAt` 기록 추가**: `genDoEditChapter` / `genExcludeChapters` / `genDoMoveChapters` / `genDoEditBook`
- 기존 데이터엔 `updatedAt` 없어 처음엔 `createdAt` 기준, 사용 시작하면 점진적으로 채워짐

### 3) Generator OCR Page 넘버링 변경
- **기존**: 전체 Page의 `max(serialNumber) + 1`
- **변경**: 미배정(`!p.chapterId`) Page 수 + 1 부터 순차
- 미배정 0개 → Page 1, 2, 3 / 미배정 3개 → Page 4, 5, 6
- Page table의 미배정 뷰와 번호가 자연스럽게 이어지도록

### 4) 시험관리 5개 메뉴 폴더 최근순 정렬 — `_tpBuildFolders`
- 폴더에 `lastTime` 필드 누적 (포함된 세트의 `updatedAt || createdAt` 중 최신)
- 정렬 기준 이름순 → `lastTime` 내림차순
- 영향: 단어시험 / 빈칸채우기 / 객관식 / 주관식 / 녹음숙제

### 5) 삭제 버튼 라벨 통일 — `🗑 삭제`
이모지(`🗑`)만 있던 5곳에 텍스트 추가:
- Generator Page/Chapter/Book 삭제 (`index.html`)
- AI 정리 프리셋 매니저 행별 (`cleanupRenderPresetManager`)
- 문제 세트 목록 행별 (`_qsRenderRow`)
- 기존 7곳(학생/반/공지/숙제파일/결제/시험)은 이미 `🗑 삭제` 형식

### 6) 시험관리 메뉴 세트 행 클릭 → 보기 모달
- 기존: 행 클릭 → `tpToggleSet` (시험 배정 체크 토글)
- 변경: 행 클릭 → `qsViewDetail` (보기 모달, 문제 세트 목록 메뉴와 동일)
- 좌측 체크박스는 그대로 시험 배정용 (event.stopPropagation 유지)
- **`qsViewDetail` 조회 폴백 체인**: `_qsList → _tpSets → Firestore(genQuestionSets/{id})` — 어느 메뉴에서 호출하든 동작

### 7) 문제 세트 목록 작업 컬럼 정리 (`_qsRenderRow`)
- **배정 → 시험출제** (라벨 변경)
- **`tpOpenPublishModal` 헤더**: `📝 시험 배정` → `📝 시험출제`
- **`보기/수정/이름` 버튼 제거** (행 클릭 시 보기 모달에서 모두 가능)
- 결과: `시험출제` + `🗑 삭제` 만 남아 깔끔

### 8) 성적 리포트 학생 이름 검색 추가
- 재원생 페이지와 동일한 패턴: 카드 상단 별도 행에 `id="scoreSearch"` input
- placeholder `🔍 이름 검색...` / width:220px / `onkeyup` 라이브 필터
- `renderScoreReportRows`에 `_srData` userName 부분일치 필터 삽입
- 날짜/반/유형은 서버 조회(`loadScoreReport`), 이름은 클라이언트 라이브 필터

## 2026-04-25: AI 문제 생성 안정화 + 시험지 출력 전면 리뉴얼

### 1) AI 문제 생성 파서 견고화 (`api/generate-quiz.js`)
Gemini 3.1 Flash-Lite Preview 가 JSON 모드에서 간헐적으로 깨진 응답을 내는 문제 대응:
- `parseAIResponse` 5단계 폴백
  1. 마크다운 펜스 제거
  2. 바로 `JSON.parse`
  3. 첫 `{` ~ 마지막 `}` 구간 잘라 parse
  4. 트레일링 쉼표 제거 후 parse
  5. `_trySalvageTruncatedQuestions`: `"questions":[...]` 중간에 끊긴 경우 브레이스 깊이 추적해서 마지막으로 완성된 object까지만 살려 `]}` 닫아 복구
- 실패 시 서버 응답에 `rawSnippet` 포함 → 클라이언트 6개 호출 지점에서 `console.warn('[generate-quiz raw]', ...)` 덤프
- 다음 실패 시 F12 콘솔에서 실제 응답이 어떻게 깨졌는지 확인 가능

### 2) AI 문제 생성 UX 강화
- **Page 선택 토큰 추정치 실시간 표시** ([_qgEstimateInputTokens](public/admin/js/app.js))
  - 한글: `chars/2`, 영문/기타: `chars/4`, 프롬프트 오버헤드 1200 tok + 페이지당 30 tok
  - 서버의 `MAX_CHARS_PER_PAGE=3000` 잘라내기 반영
  - 임계치 색상: `<5k 안전(녹)` / `<15k 적정(주황)` / `15k+ 큼(빨강)`
- **Page 상한 10 → 20**
  - `api/generate-quiz.js MAX_PAGES 20` / UI 라벨 `(최대 20개)` / 클라이언트 체크 `> 20`
  - 초과 시 생성 버튼 아래 `qgStatus`에 `⚠️ Page 수를 20이하로 줄이세요 (현재 N개)` 영구 표시
  - 20 이하로 내려가면 경고 자동 제거

### 3) 학생앱 MCQ 한글 해석 노출 정책
답을 암시할 수 있어 풀이 중엔 숨김:
- `public/index.html`: `#mcqQuestionKo` div 제거
- `_mcqRenderStep`: `questionKo` setter 삭제
- **결과 상세** (`_mcqBuildDetail`)엔 그대로 표시 — 제출 후 피드백이라 무방
- 관리자 시험지 프린트에선 `showAnswers` 시에만 표시

### 4) 시험지 출력 전면 리뉴얼
14건 배포로 단어/빈칸/객관식/주관식/언스크램블 공통 프린트 흐름을 대거 개선.

#### 레이아웃 · A4 정합성
- **A4 실물 크기 프리뷰**: `width:210mm;min-height:297mm` (세로) / `297×210mm` (가로), `padding:8mm 10mm` + `box-sizing:border-box`
- **방향 선택**: 툴바 `A4 세로 / A4 가로` select. `@page size` 동적 주입 (`A4 portrait / landscape`)
- **여백 최소화**: `@page margin 0`, 컨테이너 `padding 8px 12px`
- **페이지 경계선 시각화**: `repeating-linear-gradient` 로 297mm(세로)/210mm(가로) 마다 옅은 빨간 선
  - 외곽 div(용지+경계선) / 내부 `.a4-content`(내용) 분리 → 페이지 맞춤 시 경계선은 축소 제외

#### 2단 레이아웃 (구버전 `printMixedExamPDF` 방식 복원)
- 체크박스 `2단 레이아웃`: 내용을 `column-count:2 + column-rule` 로 좌우 분할
- 브라우저의 "시트당 페이지" 설정에 의존하지 않음 — HTML 자체가 2단
- 헤더는 최상단 1번만, 문제가 좌→우로 자연스럽게 흐름
- 이전 시도(thead 반복)는 페이지별 다른 내용 렌더가 CSS로 불가해 폐기

#### 페이지 맞춤 (자동 축소)
- 체크박스 `페이지 맞춤`: 내용이 A4 1장을 넘으면 `zoom` 으로 비례 축소
- `_tpApplyFitToPage`: `scrollHeight` 측정 → `ratio = target / actual` 계산
- **`.a4-content`에만 적용** (외곽 박스·경계선은 고정 유지)
- 프리뷰·프린트 팝업 양쪽 동일 로직 (`window.__FIT` / `__ORIENT` 주입)

#### 대표 로고 헤더 삽입
- `/icons/icon-192.png` (앱 시작 화면·홈 헤더의 대표 로고)
- 헤더 왼쪽 42×42 크기, `object-fit:contain`
- 팝업 `about:blank`에서도 로드되도록 `location.origin + /icons/...` 절대 URL 사용
- 인쇄 스크립트가 모든 `<img>` 로드 완료 후 `window.print()` 호출 (2초 타임아웃 안전장치)

#### 유형별 렌더 개선

| 유형 | 개선 |
|------|------|
| **객관식** (`_printRenderMcq`) | 번호 `1-1/1-2` → `1/2/3` 순차, 출처 Page는 답지 보기 시에만, 출처+해석을 한 줄에 `출처: Page · (해석)` 결합 |
| **빈칸채우기** (`_printRenderBlank`) | `문장의 빈칸에 알맞은 단어를 쓰세요.` 반복 → `※` 상단 공통 안내 1회, 번호를 영어 문장 앞으로 이동 |
| **주관식 해석** (`_printRenderSubj`) | `위 문장을 우리말로 해석하시오.` 반복 → `※` 상단 공통 안내 1회, 번호를 영어 문장 앞으로 이동, 답란도 번호 폭만큼 들여쓰기 |
| **언스크램블** (`_printRenderUnscramble`) | `다음 단어/구를 배열하여 위 뜻의 영문을 쓰시오.` 안내 / `단어/구 묶음` 라벨·점선 박스 제거, 칩만 바로 노출 |
| **단어시험 주관식** (`_printRenderVocab` short) | `align-items:center` → `align-items:baseline` 로 문제/정답 **베이스라인 정렬**, 답란은 `padding-bottom + border-bottom` 로 자연스러운 밑줄 |

## 2026-04-26: AI Generator 품질·UX · 시험지 워터마크 · 메뉴명 정리

### 1) AI 문제 생성 본문 원문 변형 방지 ([api/generate-quiz.js](api/generate-quiz.js))
Gemini 가 본문에 없는 문장을 창작하는 현상 차단. 대상: **언스크램블 / 빈칸 / 주관식 / 녹음**.

**프롬프트 강화**:
- `"Pick sentences from passages (unmodified)"` → `"Copy VERBATIM — every word/form/spelling must match. Do NOT paraphrase, summarize, combine, translate-back, or fabricate."`
- `"CRITICAL: If you cannot find enough suitable verbatim sentences to meet the requested count, RETURN FEWER questions. NEVER invent or modify a sentence to reach the count."` 명시
- 난이도 분포 `30/50/20 고정` → `다양하게 포함, 정확 분포 불필요` 로 완화 (창작 유혹 제거)

**서버 검증 추가**:
- `_normalizeForMatch(s)`: 소문자 + `[^\p{L}\p{N}\s]` 제거 + 공백 정규화
- `_findHostPage(sentence, pages)`: 정규화된 passage 에 substring 으로 존재해야 통과 (어순·어휘는 유지 필수)
- 각 validator (`validateUnscramble/Recording/Subjective/FillBlank`) 가 매칭 실패 시 해당 문제 폐기
- `fill_blank` 은 `___` 를 `blanks` 로 채운 완성 문장을 기준으로 검증
- `sourcePageId` 도 실제 매칭된 페이지로 자동 교정 (AI 가 엉뚱한 id 를 줘도 복구)

### 2) 부족분 재시도 루프 (1회 한정)
검증으로 폐기되어 목표 개수를 못 채웠을 때 자동 보충:
- 1차 `validated < requested` 이면 부족분만 재요청
- 이미 채택된 문장을 `ALREADY-USED sentences:` 블록으로 프롬프트에 동봉 → 중복 회피
- `_keyOf(q, type)` 헬퍼: 유형별 대표 문자열 (문장/문제문/단어) 추출
- `buildUserPrompt(..., { avoidList })` 확장
- 응답 body 에 `retried: boolean`, `retryUsage` 노출

### 3) 언스크램블 청크 수 ±1 허용
- 프롬프트: `Target chunk count is N — you may use N-1, N, or N+1 chunks` (자연스러운 언어학적 경계 우선)
- typeInstructions 에 `(±1 allowed)` 명시
- validator 는 원래부터 2-10 범위로 허용 중 → 별도 변경 불필요

### 4) 시험지 프린트 — 워터마크 + 이름/반/점수 박스 확대 ([_tpBuildPrintHtml](public/admin/js/app.js))
- **대표 로고 워터마크**: `/icons/icon-192.png` 를 용지 중앙 배치
  - `position:absolute; top:148.5mm (portrait) / 105mm (landscape); width:32%; max-width:75mm; opacity:0.07; pointer-events:none; z-index:0`
  - 외곽 div `position:relative; overflow:hidden`, 내부 `.a4-content` `position:relative; z-index:1` 로 내용이 워터마크 위
- **이름/반/점수 박스 확대** (2배):
  - font `10px → 16px`, line-height `1.7 → 1.8`
  - 이름 width `80 → 160px`, 반 `50 → 100px`, 점수 `45 → 90px`
  - padding `4/8 → 8/14`, border-radius `4 → 6`
  - `background:white` 추가로 워터마크 비침 방지

### 5) 객관식 시험지 — 4지문 1열 세로 배치 ([_printRenderMcq](public/admin/js/app.js))
- `grid-template-columns:1fr 1fr` (2x2) → `1fr` (세로 4줄)로 변경
- 문제 1줄 + ①②③④ 각 1줄 = 총 5줄 구성

### 6) 관리자 메뉴명 변경 (내부 route ID 유지)
- `Generator` → `AI OCR`
- `AI 문제 생성` → `AI Generator`
- 변경 범위: 사이드바 nav-item / 페이지 타이틀 / 안내문구 / 에러 토스트
- `goPage('generator')` / `goPage('quiz-generate')` 같은 내부 ID 는 그대로 → 기존 링크·핸들러 영향 없음
- 변경 파일: `public/admin/index.html`, `public/admin/js/app.js`

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

## 2026-04-27: 시험지 출력 옵션 확장 + Wordsnap 클립보드 입력 + 세트 폴더 변경

당일 3건 배포 (SW v107 → v110). 출력·콘텐츠 편집 관련 실사용 편의 기능 추가.

### 1) 시험지 출력 — 글자크기·줄간격·문제간 간격 조정 옵션 (v108)
관리자 시험관리의 🖨 시험지 출력 프리뷰 툴바에 세밀 조정 입력 3개 추가. 현장에서 내용량에 따라 바로 조정 가능하도록.

**추가된 입력** (`tpOpenPrintModal`):
- 📐 스타일 조정 row — 글자크기(9~20px) / 줄간격(1.0~2.5 배) / 문제간격(0~60px) number input + ↺ 리셋 버튼
- 기본값: `_TP_PRINT_DEFAULTS = { fontSize:13, lineHeight:1.7, qGap:18 }` — 단일 소스로 fallback·리셋·placeholder 공통 참조
- 세션 한정 (localStorage 저장 없음) — 매번 열 때 기본값으로 초기화

**구현 방식 — CSS 변수 주입**:
- `.a4-content` inline style 에 `--p-font / --p-line / --q-gap` 주입
- 5개 렌더 함수(`_printRenderSubj/Vocab/Unscramble/Blank/Mcq`)의 하드코딩 px → `var(--p-font)` 등으로 교체
- 선지·칩·작은 주석 같은 "계층 시각 요소" 는 `calc(var(--p-font) - 1px)` 로 상대 스케일
- 프린트 팝업(`window.open`)은 `area.innerHTML` 을 그대로 복제 → CSS 변수가 inline style 에 박혀있어 자동 전달, 별도 `window.__*` 필요 없음

**부수 변경**:
- `_printRenderVocab` 의 2단 자동 축소(narrow 분기) 제거 — 사용자 값 그대로 적용 (1단/2단 일관성 ↑)
- `_tpAdjustAnswerLines` 가 unitless line-height(예 1.7)도 올바르게 처리하도록 fontSize × 배수 계산 추가

### 2) AI Generator 단어시험 — Wordsnap 클립보드 입력 (v109, 초기명 Wordshap → v110 에서 개명)
AI 호출 없이 '영단어[Tab]해석' 클립보드를 즉시 `genQuestionSets` 세트로 저장하는 경로 추가.

**UI 배치** (`_qgRenderOptions`):
- 문제 유형 = `word` (단어시험) 선택 시에만 `qgOptionsPanel` 끝에 📋 Wordsnap 섹션 렌더 (DOM 순서상 ✨ AI 로 문제 생성 버튼 바로 위)
- textarea + 📥 붙여넣기(navigator.clipboard) 보조 버튼 + 📋 Wordsnap 실행 버튼
- 입력 시 라이브 상태 (`✓ N개 단어 · ⚠ M줄 오류`)

**함수 이름** (당일 Wordshap → Wordsnap 일괄 rename, 최종): `_qgBuildWordsnapSection` / `_qgParseWordsnap` / `qgRunWordsnap` / `qgWordsnapPaste` / `_qgWordsnapUpdateStatus` · element id `qgWordsnapInput` / `qgWordsnapStatus` / `qgWordsnapBtn`.

**파서** (`_qgParseWordsnap`):
- 각 줄 `trim()` → `\t` 첫 발견 위치로 split (해석에 탭이 있어도 안전)
- 검증: 빈 줄 스킵 / tab 없음 / 영단어·해석 누락 / 영단어 60자↑ / 해석 200자↑ / 중복(lowercase 기준)
- 반환: `{ questions, errors }` — questions 는 `{ type:'vocab', word, meaning, example:'', exampleKo:'', sourcePageId:'', sourcePageTitle:'', difficulty:'medium' }`

**저장** (`qgRunWordsnap`):
- AI 플로우 우회 — `_qgShowResultModal` 안 거치고 `addDoc(collection(db,'genQuestionSets'), ...)` 직접
- `aiModel: 'Wordsnap 수동 입력'`, `sourceType: 'vocab'`
- 활성 `_qgActiveBook/_qgActiveChapter` 있으면 세트명 + `sourcePages` 단일 엔트리에 반영 → 문제세트 목록 폴더 트리에 자동 분류
- 저장 후 `goPage('quiz-sets')` 로 자동 이동

### 3) 문제세트 수정창에 📚 Book 폴더 선택 추가 (v110)
Wordsnap 수동 입력 시 활성 Book 을 안 골라 (미지정) 으로 저장되는 경우, 또는 기존 세트의 폴더 위치를 바꾸고 싶은 경우를 위해 수정 모달에서 폴더 변경 가능하게 확장.

**UI** (`_qsRenderEditModal`):
- 세트 이름 input 옆(`grid-template-columns:1fr 280px`) 에 📚 Book 폴더 `<select>` 추가
- 옵션: `(미지정)` + `_qsBooks` 전체 목록 (loadQuestionSets 에서 이미 로드됨)
- 현재값: `_qsEditCurrentBookId()` — sourcePages 내 bookId 최빈값 (`_qsPrimaryBookId` 로직과 동일)

**저장 로직** (`qsSaveEdits`):
- `chosenBookId !== originalBookId` 이면 모든 `sourcePages` 엔트리의 `bookId` 를 선택값으로 덮어쓰고 `chapterId` 는 비움 (구 Book 소속 chapter 불일치 제거)
- 같으면 기존 sourcePages 그대로 유지
- 원래 sourcePages 가 비어있던 수동 세트에 Book 선택 시 `[{ pageId:'', pageTitle:'', bookId, chapterId:'' }]` 단일 엔트리 자동 생성
- `updateDoc` 에 `sourcePages` 포함하여 저장 → 문제세트 목록 하단 폴더 트리에 즉시 반영

**상태 확장**:
- `_qsEditState` 에 `sourcePages` 필드 추가 (deep clone) — 기존에는 `{setId, name, sourceType, questions}` 만

---

## 파일 크기 참고 (2026-04-27)
- `public/admin/js/app.js`: ~8514줄 (+404: 스타일 조정 CSS 변수 / Wordsnap 섹션·파서·저장 / 수정창 Book 폴더)
- `public/admin/index.html`: ~868줄
- `public/js/app.js`: ~4764줄
- `public/index.html`: ~661줄
- `api/generate-quiz.js`: ~948줄
- SW 캐시: `kunsori-v110`
