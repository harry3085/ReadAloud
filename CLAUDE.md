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
8. **Gemini 모델 폴백 체인** (2026-04-27 유료 티어 전환): 모든 API 가 `2.5-flash-lite → 2.5-flash → 3.1-flash-lite-preview` 순으로 폴백. 같은 모델로 503/429 transient 시 1회 재시도(800ms) 후 다음 모델. 4xx 비-transient 는 즉시 502 반환 (다른 모델도 동일 결과 예상). 변경 시 3개 API 전부 동일 순서 유지: `api/generate-quiz.js` / `api/check-recording.js` / `api/cleanup-ocr.js`. 이전 단일 모델 정책(2026-04-23)은 무료 티어 RPD 한계 + preview 결과 편차 우려였는데 유료 티어로 둘 다 해소됨.
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

---

## 2026-04-27 (오후~저녁): 멀티테넌시 본격 전환 — Phase 3·4·5 대거 진행 + super_admin 앱 분리

하루에 배포 60+ (SW v110 → v168). 멀티테넌시 인프라 ~90% 완료.

### 1) Phase 4-3 점진 격리 (11 사이클)
한 컬렉션씩 인덱스 사전 deploy → 클라 쿼리 + addDoc 변경 → push 패턴.
대상 13개 컬렉션 + composite index 11개:
notices · genTests · genQuestionSets · groups · scores · users(13곳 누락 일괄) · payments · hwFiles · genBooks/Chapters/Pages · pushNotifications · userNotifications · genCleanupPresets · apiUsage(학원별)

**중요 함정**: 일괄 적용 시 화면 다발 깨짐(인덱스 누락) → 점진 적용 필수. `firebase.json` 의 `firestore.indexes` 경로 누락 → deploy 가 룰만 반영하고 인덱스 무시한 적 있음(수정됨).

### 2) Phase 4-5 Firestore Rules 강화
헬퍼 추가:
- `myAcademyId()` — Custom Claims 의 academyId
- `isMyAcademy()` — `resource.data.academyId == myAcademyId()` (super_admin 통과)
- `isCreatingForMyAcademy()` — `request.resource.data.academyId == myAcademyId()`
- `isAdminOfMyAcademy()` / `isAdminCreatingForMyAcademy()` — admin + 학원

13개 컬렉션 모두 Rules 에서 academyId 검증. 직접 doc(id) 접근 시도도 차단.
**주의**: `isMyAcademy` 가 비존재 doc 의 `resource.data` 평가 시 거부 → `apiUsage` 등 read 에 `resource == null` 분기 추가.

### 3) Phase 3 — 서버 API 인증 + 학원별 쿼터
신규 `api/_lib/quota.js`:
- `verifyAndCheckQuota({idToken, quotaKind: 'ai'|'recording'|'student'})`
- 토큰 검증 + caller.academyId 추출 + plans/{planId}.limits 조회 + academies.usage 비교
- 한도 초과 시 429 + 친화적 메시지
- 월별 자동 리셋 (`lastResetAt` 이 다른 달이면 카운터 0)

적용 5개 API:
- `generate-quiz` / `cleanup-ocr` / `ocr` → quotaKind 'ai' (aiCallsThisMonth)
- `check-recording` → 'recording' (recordingCallsThisMonth)
- `createStudent` → 학생 한도 인라인 체크 + activeStudentsCount +1

클라 측 idToken 자동 주입:
- `_geminiFetch` 래퍼가 body 에 idToken 자동 박음
- 학생앱 fetch 호출 3곳도 idToken 첨부
- `npm run test-api-auth` 도구로 7/7 401 응답 확인

### 4) super_admin 앱 별도 분리 — `public/super/`
학원장 앱과 권한·역할 분리.

**구조**:
- `public/super/index.html` (헤더 코랄 그라디언트 + 탭 3개)
- `public/super/js/app.js` (Firebase init + role==='super_admin' 검증, 아니면 /admin 추방)
- 학원장 앱 사이드바 / super 앱 헤더 의 상호 링크 모두 제거 (역할 분리 명확화)

**탭 3개**:
- 🏢 **학원 관리**: 합계 카드 5개 + 학원 목록 + 행 클릭 시 학원/학원장 편집 모달 + "+ 신규 학원" 버튼
- 👥 **사용자 검색**: 학원무관 전체 users 클라 캐시 + 이름/email/username/uid 필터 + role 필터 + 컬럼 헤더 정렬 + 행 클릭 시 학원장→학원모달, 학생→사용자편집모달
- 🛠 **도구**: Gemini 공식 대시보드 / Firebase Console / Vercel 외부 링크 (super_admin 만 노출)

**서버 API**:
- `api/superAdmin/updateAcademy.js` — 학원 정보 (name/planId/studentLimit/billingStatus)
- `api/superAdmin/updateAcademyAdmin.js` — 사용자 정보 (name/email/username/password) + Auth + Firestore 동시
- 기존 `api/createAcademy.js` 활용 (usernameLookup 자동 쓰기 추가)
- 모두 super_admin Custom Claims 검증

**레이아웃**:
- viewport 고정 (html/body overflow:hidden)
- main 영역도 overflow:hidden + flex column
- 표 카드만 `.card-scroll` 클래스로 자체 스크롤 + thead `position:sticky;top:0`
- 헤더/탭/검색바/버튼 모두 `flex-shrink:0`

### 5) super_admin 전용 계정 + 직행 로그인
- `npm run create-super-admin --username X --email Y --password Z --apply`
- users.role = 'super_admin' (학원 무관, academyId 없음)
- Custom Claims `{ role: 'super_admin' }`
- 신규 superadmin 계정 생성됨 (orpeo00@gmail.com → 추후 이전)
- doLogin 분기:
  - `profile.role==='super_admin'` → `/super/` 직행
  - `profile.role==='admin'` → `/admin/`
  - `profile.role==='student'` → 학생 홈

### 6) usernameLookup 글로벌 유니크 키 + 이메일 폴백 로그인
- 키 패턴: `usernameLookup/{academyId}_{username}` → `usernameLookup/{username}` 통일
- 마이그레이션 75건 이전 + raloud2_admin 백필
- `_lookupUserByUsername` 단순화
- doLogin 입력에 `@` 포함 시 usernameLookup 우회 → 이메일 직접 로그인 (멀티학원 학원장용)
- `create-academy.js` (CLI/API) 가 학원장 usernameLookup 자동 생성
- **학원장 username 정책 변경**: `{subdomain}_admin` → `{subdomain}` (신규 학원만, 기존 raloud2_admin 그대로)

### 7) Gemini 폴백 체인 (유료 티어 전환)
**작업 규칙 8 갱신** (이전 단일 모델 정책 폐기):
1차 `gemini-2.5-flash-lite` → 2차 `gemini-2.5-flash` → 3차 `gemini-3.1-flash-lite-preview`
- 503/429 transient → 같은 모델 800ms 후 1회 재시도 → 다음 모델
- 4xx 비-transient (400/401/403) → 즉시 502 (다른 모델도 동일)
- 적용: `api/generate-quiz` / `api/cleanup-ocr` / `api/check-recording`

### 8) AI 사용량 위젯 확장 (학원장 앱 대시보드)
- 위젯 제목 "🤖 Gemini 사용량 (오늘)" → "🤖 AI 사용량" (벤더명 노출 X)
- 공식 대시보드 외부 링크 제거 (super 앱에만)
- 상단: 플랜 배지 (LITE/STANDARD/PRO) + 학원명
- 학생/AI 월 호출/녹음 월 평가 분수 + 진행 바 (70% 주황 / 90% 빨강)
- 중간: 오늘 항목별 (녹음숙제/AI Generator/AI OCR)
- AI 호출 로딩 토스트 6곳 "Gemini" → "AI"

### 9) apiUsage 학원별 분리
- doc id: `apiUsage/{date}` → `apiUsage/{academyId}_{date}`
- 마이그레이션 5건 (default_2026-04-23..27) 이전
- byEndpoint flat → nested 변환 (`["byEndpoint.X"]: increment(1)` 가 dot key 로 잘못 저장된 버그 수정)
- 항목명 통일: 녹음숙제 / AI Generator / AI OCR (ocr+cleanup-ocr 합산)
- _geminiFetch wrapper 가 호출 후 1.5초 뒤 위젯 자동 갱신

### 10) Phase 6F 일부 — 레거시 tests 정리
admin/app.js 제거된 함수들 (216줄 ↓):
- editSelectedTest / reprintSelectedTest / openTestEditModal / addEditWordRow / saveTestEdit / reprintTest / deleteTest
- 시험목록의 tests + genTests 병합 → genTests 단일 소스
- toggleTestProgress 의 tests/genTests 분기 제거

`firestore.rules` 제거 컬렉션:
- savedPushList / books / books/{id}/units / folders / units (top-level) / tests
- 기본 deny

### 11) 이중 저장 방지 (5개 시험 모드)
빠른 클릭 / 타이머+수동 동시 fire 로 score 중복 저장 발생 (default 학원에서 단어시험 4건 발견).
모든 _xxSubmit 함수에 가드 추가:
- `_vqSubmit` (vocab) / `_mcqSubmit` / `_fbSubmit` (fill_blank) / `_raSubmit` / `_rv2Submit` / `_uqSubmit`
- 패턴: `if (s._submitted || s._submitting) return; s._submitting = true;` → 성공 후 `s._submitted = true` → finally `s._submitting = false`

### 12) 운영 도구 (CLI 다수 신규)
- `npm run create-super-admin` — super_admin 계정 생성
- `npm run sync-claims` — users.academyId/role 과 Auth Custom Claims 동기 (super_admin 보호)
- `npm run reset-password -- --username X --password Y` — Auth lockout 우회 비번 강제 리셋
- `npm run cleanup:firestore-orphans` — Firestore users 만 있고 Auth 없는 orphan
- `npm run migrate:relocate-lookup` / `relocate-api-usage` / `fix-api-usage` / `backfill-usage` — 1회성 마이그레이션 (재실행 안전)
- `npm run test-api-auth` — API 인증 차단 검증 (7/7 통과)
- `npm run set-usage` — 학원 사용량 강제 설정 (쿼터 검증용)

### 13) sendPush 학원 격리 (이전 무인증 차단)
- idToken 검증 + caller.academyId 기반 학생 조회
- target='all'/group/'uid:X' 모두 자기 학원만 발송
- pushNotifications + userNotifications 저장 시 academyId 박힘

### 14) academies.usage 백필
기존 학원 카운터가 0 이던 문제 — 이번 달 apiUsage 합산해서 백필 완료:
- default(학생65 / AI338 / 녹음3), dongbu(0/0/0), raloud2(3/5/0)

---

## 작업 규칙 갱신 (2026-04-27)

**규칙 8 (Gemini)** — 단일 모델 → 폴백 체인으로 변경 (위 § 7 참조).

**신규 규칙**:
- 멀티테넌시 격리는 3단 방어 — (a) 클라 쿼리 academyId 필터 (b) Firestore Rules myAcademyId 검증 (c) 서버 API idToken 검증. 한 단계라도 빠지면 안 됨.
- 학원별 격리 컬렉션 신규 추가 시 — composite index 사전 deploy → 코드 변경 → push 순서. 일괄 적용 X.
- 새 시험 유형 / 시험 제출 함수 추가 시 `_submitted/_submitting` 가드 필수 (이중 저장 방지)
- super_admin 앱과 학원장 앱은 별도 — 같은 사용자가 권한 둘 다 가져도 직접 이동 링크 X (역할 분리)

---

## 파일 크기 / SW 캐시 (2026-04-27 저녁)
- `public/admin/js/app.js`: ~8500줄 (cleanup 으로 -200, 신규 +100)
- `public/super/index.html`: ~신규 200줄
- `public/super/js/app.js`: ~신규 350줄
- `api/_lib/quota.js`: ~신규 130줄
- `api/superAdmin/*.js`: 2개 신규 (~250줄)
- `firestore.rules`: 멀티테넌시 헬퍼 + 13개 컬렉션 academyId 검증 (~180줄)
- `firestore.indexes.json`: composite index 11개
- SW 캐시: `kunsori-v168`

## 진행률 (2026-04-27 저녁)
- 멀티테넌시 인프라: **~90%**
- super_admin 앱: **~75%** (학원 삭제 / 학원별 한도 override 남음)
- Phase 5 출시 준비: **0%** (도메인 / 약관 / 결제 연동)

다음 세션 후보 (메모리 `project_phase0_status.md` 와 동기화):
- 학원 삭제 모달 (위험 작업 — 신중)
- 학원별 한도 override (academy.customLimits)
- 학원장 앱 사이드바·대시보드 추가 위젯 검토
- 학생앱 admin 잔재 dead code (~1000줄) 통째 제거
- Phase 5 출시 준비 (도메인 / 약관 / 결제)

---

## 2026-04-28 ~ 04-29: 인쇄 옵션 대규모 정비 + AI 자산 default 동기화 + 메모리 4건

당일 SW v184 → v193 (~14건 commit). 사용자 요청 위주 정리/UX 개선.

### 1) 인쇄 모달 셔플 아키텍처 (commit 0e249c6 외)
- 진입 시 사전 결정 → 옵션 변경에도 보존, 섞기 버튼 누를 때만 갱신
  - vocab `q._printSlots = [정답, 오답×3]` (4지문 사전 픽)
  - mcq `q.choices` 클론 (학생앱도 응시마다 셔플)
  - unscramble `q._printChunks` (사전 셔플)
- [🔀 문제 섞기] (모든 유형) + [🔀 선지/청크 섞기] (vocab/mcq/unscramble) 버튼
- 학생앱 `startReadingMcq` 매 응시마다 `q.choices` 셔플 (isAnswer 마커로 자동 추적)

### 2) 인쇄 모달 폭 확대 + 옵션 자동 저장/복원
- `showModal({ width: 'min(1240px, 96vw)' })` — 헤더 버튼 줄바꿈 해소
- 옵션 자동 저장 (localStorage 하이브리드)
  - 키 두 개: `tpPrintOpts:{선택 set IDs 정렬}` (세트별) + `tpPrintOpts:last` (마지막 사용)
  - 복원 순서: 세트별 → last → 기본값
  - 저장 대상 12개 (답지보기·2단·페이지맞춤·세로가로·학원명·글자크기·줄간격·문제간격·vocab(형식·단수·객관식비율·영→한비율))
  - 미저장: 시험명(세트명 자동), 출제일(오늘)

### 3) 단어시험 형식 옵션 단순화 — 슬라이더가 흡수
- 형식 dropdown: 5개 → **3개** (혼합 랜덤 / 객→주 / 주→객)
  - '주관식(스펠링)' '객관식' 제거 — 슬라이더 0% / 100% 가 동일 효과
- 방향 dropdown 제거 — **영→한비율 슬라이더** 로 일원화 (0% = 한→영 / 100% = 영→한)
- **객관식비율 슬라이더** 추가 (방향 옵션 옆 → 형식 옵션 옆으로 이동)
- 각 문제에 `_printFmtRank` / `_printDirRank` 사전 결정 (모달 진입 시) — 슬라이더 변경에도 rank 유지
- 0% / 100% 정확 반영 (`isFinite` 체크로 falsy 폴백 회피)
- 레거시 localStorage 'short'/'mcq' 형식값은 'mixed' 자동 폴백

### 4) AI OCR 클린업 프리셋 default 갱신 + 4학원 일괄 동기화 (ee9f4bf, cf1937c)
- default 학원의 현재 4개 프리셋을 `_CLEANUP_DEFAULT_PRESETS` 에 반영 — 단어장(Snapshot) 갱신, '문장 전체 번역' 신규 추가
- `scripts/diag/dump-cleanup-presets.js` — Firestore → 코드 형식 덤프 (재실행 가능)
- `scripts/migrate/sync-cleanup-defaults.js` — 학원별 name 매칭 후 프리셋 갱신/추가 (DRY-RUN 기본, --apply)
- 4학원 적용 결과: default 변경 없음 / dongbu 4개 신규 / ipark·raloud2 단어장 갱신 + '문장 전체 번역' 신규
- 사용자 자작(이름이 source default 에 없는) 프리셋은 손대지 않음

### 5) AI Generator vocab 프롬프트 default 갱신 (4fd5bd7)
- `api/generate-quiz.js` `SYSTEM_PROMPTS.vocab` 1번 규칙 추가:
  "단어장[Tab] 형식 문서를 그대로 반영" (단어장 클린업 프리셋 출력과 동일 패턴)
- 다른 유형(mcq/fill_blank/unscramble/subjective/recording) 변동 없음
- 학원장이 [📋 AI 프롬프트 편집] 모달에서 [💾 저장] 한 번 누르면 `val === def` 감지로 localStorage 자동 정리 (● 사라짐)

### 6) 메모리 4건 추가 (다음 세션 컨텍스트)
1. **`project_global_config_refactor.md`** — AI 프롬프트(localStorage) → Firestore 이전 + super_admin 글로벌 default 편집 UI. 클린업 프리셋도 동일 패턴 (이미 Firestore 라 default 시드만 옮기면 됨). 3단 fallback (코드 안전망 → 글로벌 default → 학원별 커스텀).
2. **`feedback_storage_choice.md`** — 1인 1PC 타겟이라 사용자 개인 선호(인쇄 옵션 등)는 localStorage. 학원 단위 공유 데이터·super_admin 가시성 필요한 것만 Firestore. Firestore 비용 의식.
3. **`project_v1_polish_cycle.md`** — Phase 5 출시 준비 후 v1.0 polish 사이클. 4 카테고리: 디자인 토큰화 → 컴포넌트 인벤토리 통합 (Lucide 아이콘 채택 — 사이드바가 이미 Feather 스타일) → 로직 패턴 수렴 → UX 플로우 감사. 사용자 트리거 대기.
4. **`project_dashboard_calendar.md`** — 학원장 대시보드 큰 달력 + 학생 생일🎂·결제💳·시험📝 이벤트 통합 뷰. 사전 점검: `users.birthday` / `payments.dueDate` 필드 존재 여부.

### 7) 작업 규칙 추가 (이번 세션 합의)
- **JS `0 || fallback` 함정 금지**: 슬라이더·비율 등 0 이 유효한 입력에서 `parseInt(v) || 50` 쓰면 0 이 falsy 라 50 으로 둔갑. `isFinite(parseInt(v)) ? parseInt(v) : 50` 패턴 사용.
- **데이터 보관 위치 결정**: 새 사용자 설정/선호 추가 시 — (a) 학원 공유 필요? (b) super_admin 가시성 필요? (c) 학원 백업에 포함되어야? — 셋 다 X 면 localStorage. 하나라도 ✓ 면 Firestore. ReadAloudApp 은 1인 1PC 타겟이라 대부분 localStorage 가 정답.

---

## 파일 크기 / SW 캐시 (2026-04-29)
- `public/admin/js/app.js`: ~8700줄 (인쇄 옵션·셔플 +200)
- `api/generate-quiz.js`: vocab 프롬프트 1줄 추가
- `scripts/diag/dump-cleanup-presets.js`: 신규 ~50줄
- `scripts/migrate/sync-cleanup-defaults.js`: 신규 ~150줄
- SW 캐시: `kunsori-v193`

## 진행률 (2026-04-29)
- 멀티테넌시 인프라: **~92%** (Phase 4 완료, Phase 3 완료)
- super_admin 앱: **~85%** (학원 삭제 + 한도 override 완료, Free 플랜 추가)
- 인쇄 시스템: **~95%** (옵션 자동 저장/복원, 셔플, 슬라이더 다 됨)
- Phase 5 출시 준비: **0%**

다음 세션 후보 (우선순위 순):
1. **Phase 5 출시 준비** — 도메인 / 약관·개인정보 / 결제 연동 (Toss / Stripe)
2. **글로벌 설정 Firestore 이전** (`project_global_config_refactor.md`) — appConfig/* + super_admin UI. 인쇄 옵션은 제외 (localStorage 유지)
3. **학원장 대시보드 달력** (`project_dashboard_calendar.md`) — 큰 달력 + 학생 생일·결제·시험 이벤트
4. **학원 설정 페이지 (화이트라벨)** (`project_academy_settings_page.md`) — 로고/홍보문구 + 학원장 정보 수정. 출시 후 또는 polish 와 묶음
5. **v1.0 Polish 사이클** (`project_v1_polish_cycle.md`) — 출시 직전. Lucide 아이콘 통일·디자인 토큰화·컴포넌트 통합·로직 수렴

**완료 (이 세션 기준)**:
- ✅ 레거시 Phase 6F 정리 — `books`/`folders`/`units` 규칙·코드 모두 제거됨 (commit 6102675 외)
- ✅ OS 알림 끄기 매뉴얼 — `docs/notif-disable-guide.md` 작성

---

## 2026-04-29 (저녁) ~ 2026-04-30: 알림 시스템 + 녹음숙제 재설계

당일 SW v184 → v206 (~30+ commit). 두 큰 영역의 대규모 정비.

### 1) 학생앱 FCM 알림 시스템 재구축

**FCM 함수 복구** (commit beeed1f) — Phase 6F 정리 시 잘못 제거된 학생용 FCM 코드 ~190줄 복원:
- `VAPID_KEY`, `doRegisterToken`, `registerFCMToken`
- `setupForegroundMessage`, `showNotifModal`, `checkUnreadNotifs`, `updateNotifBadge`
- `requestNotifPermission`, `dismissNotifModal` (window)
- `openNotifPanel`, `readNotif`, `closeNotifPanel`, `markAllNotifsRead` (window)

**중복 표시 fix** (commit 7a77df2 → 4ceed81): 1 푸시가 2번 표시되던 두 원인 모두 해결
- onMessage 리스너 중복 등록 → `_fcmListenerBound` 가드
- sw.js + firebase-messaging-sw.js 둘 다 `onBackgroundMessage` 호출 → SW 분리 (옵션 1):
  · `sw.js` = 캐시·fetch 만, FCM 코드 제거
  · `firebase-messaging-sw.js` = FCM 전용. `messaging.onBackgroundMessage` 핸들러도 제거 (Firebase SDK 자동 표시 사용)
  · `notificationclick` 만 firebase-messaging-sw.js 에 유지

**알림 뱃지 갱신 3건** (commit bd6deb7):
- 자동 로그인 시 `updateNotifBadge` + `checkUnreadNotifs` 호출 빠짐 → 추가
- 새 푸시 도착 시 onMessage 콜백 끝에 `updateNotifBadge()` 추가
- `visibilitychange` 리스너 — 백그라운드 → 포그라운드 복귀 시 자동 갱신

**알림 인지 모달 + claim 패턴** (commit ed82b3a, a8c21a7):
- 로그인 시 미확인 알림 합산 모달 (1건만, 풀스크린 차단 X) — `showUnreadSummaryModal`
  · "미확인 알림 N건" + [지금 확인 / 나중에]
- 멀티 디바이스: `users.fcmToken` (string) → `users.fcmTokens` (array)
  · 마이그레이션: `scripts/migrate/fcm-tokens-to-array.js` 적용 (11건 변환)
  · 학부모 같은 ID 다른 폰 로그인 → `arrayUnion` 으로 토큰 누적
  · 같은 폰을 다른 user 가 로그인하면 새 user 가 토큰 소유권 이전 (claim)
  · 신규 API `api/claimFcmToken.js` (admin SDK 로 다른 user.fcmTokens 에서 arrayRemove)
- 로그아웃해도 토큰 유지 — 학원 알림 (숙제 독촉·긴급 정보) 이 도달해야 한다는 정책. 로그인 끊긴 상태에서도 푸시 도착. 같은 폰에 다른 user 로그인 시 자동 이전됨.

**알림 데이터 격리·정리** (commit cf1937c, 6f8fa13):
- pushNotifications + userNotifications 의 academyId 누락 doc 백필 (`scripts/migrate/backfill-notif-academy.js`)
- 옛 테스트 데이터 일괄 정리 (`scripts/cleanup/wipe-notifications.js` — 88건 삭제)
- userNotifications.academyId 가 빠져있어 admin 의 읽음 현황 모달이 'Missing or insufficient permissions' 로 실패하던 버그 해결

**메시지 관리 (학원장)** (commit 0705864, c3eb975):
- 발송 이력 행에 [♻ 재활용] 버튼 복원 — 옛 commit 45750ee 에서 dead 가 되었던 reuseMsg 함수 다시 호출
- 메시지 관리 카드: 초안 (sent:false) / 발송 이력 (sent:true) 2 섹션 분리
  · 초안 행: 점선 박스 + 노란 배경, 클릭=재활용
  · 발송 이력 행: 실선 박스, 클릭=읽음 현황, ♻=재활용, ✕=cascade 삭제
- `delMsg`: pushNotifications 삭제 시 관련 userNotifications 도 cascade 삭제 (학생 알림함에서도 사라짐)
- 신규 `delDraftMsg` (초안 삭제, cascade 불필요)

### 2) 녹음숙제 — 2단계 검증 + 단일 AI 평가 재설계

**Pre-check 클라이언트 무결성 검사 5종** (commit a681d5a → b9d24ef):
- 길이 (min/maxDurationSec)
- VAD (Voice Activity Detection) — Web Audio API RMS 50ms 윈도우, 임계값 0.012
- A. SHA-256 hash 비교 — 이전 라운드와 동일 녹음 차단 (재제출 부정 방지)
- B. 다라운드 길이 일관성 — 평균 ±30% 벗어나면 reject
- C. 음성 대역 에너지 (300~3400Hz, FFT downsampled 256 샘플) — 음악·소음 차단
- D. spectral entropy — 단조로운 음 (`아아아` 패턴) 감지

**완곡한 알림 메시지 + persistent UI**:
- 토스트 → 화면 상단 빨간 박스 (재녹음까지 유지)
- "직전 회차와 거의 같은 녹음 같아요. 새로 읽어볼까요?"
- "조용한 곳에서 또렷이 읽어볼까요?" 등

**N회 무결성 + 마지막 라운드만 AI 평가** (commit b9d24ef):
- 시험별 `q.recordingCount` 1~4 회 (시험 배정 시 학원장 선택)
- 매 라운드 무결성 통과만 메모리 보관 (Storage 업로드 X)
- N회 다 통과 → [제출] → **마지막 라운드만 Storage 업로드 + AI 1회 호출**
- AI 점수 ≥ 통과점수 → 결과 저장 + 완료
- 미달 → 마지막 라운드만 다시 녹음 (이전 라운드 유지)
- 비용 효과: AI 호출 4회 → 1회, Storage 3개 → 1개

**서버 프롬프트 통합** (commit b9d24ef):
- check + feedback 분리 호출 → 통합 1회 호출 (`buildEvalPrompt`)
- responseSchema 도 통합 (score + missedWords + note + feedback 한 번에)
- `evaluationSeconds` 0/null = 전체 평가, 양수 = 앞 N초만
- 점수 미달이라도 피드백 항상 포함 (학습 효과, 비용 차이 미미)

**시험 배정 모달 — 5 옵션 통합** (commit b414751):
- 녹음 횟수 (1~4)
- 최소 녹음시간 (초, 10~300)
- 최대 녹음시간 (초, 60~1800)
- 평가구간 select (전체 / 60·90·120·180초)
- 성실도 임계값 (%, 20~80)
- 통과점수 (모달 상단 공통)
- 모두 시험 단위 (각 question 객체) 에 저장 — 시험·학년별 자유 조정
- 학원 단위 default 페이지는 만들었다가 같은 commit 에서 제거 (학원 단위 doc 안 건드림으로 단순화)

**AI Generator 정리**:
- `QG_TYPE_OPTIONS.recording.options` 배열 비움 — accuracyThreshold·evaluationSeconds 제거
- `_qgBuildRecordingSet` 도 두 필드 안 박음
- 결과: AI Generator 단계는 페이지 선택만, 옵션 결정은 시험 배정 시점

**결과 화면 + 학원장 화면**:
- 학생: 단일 녹음 + AI 점수 vs 통과점수 비교 + 피드백 항상 표시 + 미통과 시 [🎙 마지막 다시] 버튼
- 학원장: 시험 진행 현황 펼침·성적 리포트 상세 모두 마지막 녹음 1개로 단순화 + 피드백 details

### 3) 그 외 정리

**academyId 격리 누락** (commit 3109807): `tpToggleTestProgress` (시험 진행 현황 펼침) 의 그룹 학생 쿼리에 academyId 필터 빠짐 → 'TEST반' 같이 이름 겹치는 그룹의 다른 학원 학생까지 잡혀 학생 수 부풀려 표시되던 display 버그 해결.

**학생 랭킹 작동** (commit 85776ed): scores Rules 가 `isOwner || isAdmin` 만 허용해 학생이 같은 그룹 점수 조회 불가. 처음부터 빈 랭킹이던 알려진 버그 해결 — `isSignedIn() && resource.data.academyId == myAcademyId()` 추가. 같은 학원 안 모두 read OK (클라이언트 group 필터로 같은 반만 표시).

**랭킹 dead code 정리** (commit 67f17e0): Phase 6E 에서 녹음숙제 탭 UI 제거 시 남았던 `switchRankTab`/`rankHwList` 잔재 ~10줄 제거.

**Page 자연 정렬** (commit 3af7698): AI OCR / AI Generator 의 Books·Chapters·Pages 이름순 정렬에 `localeCompare(... { numeric: true })` 적용 → "Page 1, 2, 3 ... 9, 10, 11" 자연순.

**AI 프롬프트 갱신**:
- vocab (commit 543e402): TYPE A (단어장) / TYPE B (본문) 입력 자동 감지 분기 (1-1~1-9 vocabulary list mode rules)
- subjective (commit aade93a): 프롬프트 완화 — 결합·시제 조정 허용. 검증 함수도 `_findHostPage` 폐기 → 단어 매칭 30% (false positive 회피)
- 난이도(학년) 모든 유형에 적용 (commit 8fd4d0f) — 이전엔 vocab/unscramble 만 prompt 에 포함, 이제 mcq/fill_blank/subjective 도 포함 (recording 은 noAi 라 제외)

**minVoiceActivity 0.7 → 0.4** (commit 93ef43a): 자연 발화 비율이 60~75% 인데 임계값 70% 가 빡빡해서 정상 녹음도 거부되던 문제. 4학원 일괄 갱신 + 신규 학원 default 도 0.4 로 변경.

**OS 알림 끄기 매뉴얼** (commit 3a05cf1): 학생/학부모용 마크다운 1장. iPhone (Safari/Chrome/PWA) + Android (Chrome/PWA) 케이스별 단계 + FAQ.

### 4) 메모리 정리

**신규 추가**:
- `feedback_answer_before_work.md` — 질문엔 답변 먼저, 작업 컨펌 후 진행 (사용자 명시 요청)
- `project_dashboard_calendar.md` — 학원장 대시보드 달력 통합 (생일·결제·시험)
- `project_v1_polish_cycle.md` — 출시 직전 디자인 토큰화·Lucide 아이콘
- `project_global_config_refactor.md` — AI 프롬프트 super_admin 편집 + 학원별 override
- `project_academy_settings_page.md` — 화이트라벨 (로고·홍보문구) + 학원장 정보 수정
- `feedback_storage_choice.md` — 1인 1PC 타겟이라 사용자 선호는 localStorage

**삭제**:
- `project_recording_settings_polish.md` — 시험 배정 모달 통합으로 해소됨
- `project_os_notif_disable_guide.md` — 매뉴얼 작성 완료
- `project_ranking_visibility.md` — Rules 완화로 해결됨

### 5) 작업 규칙 추가

- **JS `0 || fallback` 함정 금지** — 0 이 falsy 라 `parseInt(v) || 50` 쓰면 0 이 50 으로 둔갑. `isFinite(parseInt(v)) ? parseInt(v) : 50` 패턴 사용.
- **데이터 보관 위치 결정 기준** — 학원 공유 / super_admin 가시성 / 학원 백업 포함 셋 다 X 면 localStorage. 1인 1PC 타겟이라 대부분 localStorage 가 정답.
- **답변 먼저, 작업 컨펌 받고 진행** — 질문에는 답변 + 옵션 제시 → 사용자 동의 → 작업. 동시 진행 X.

---

## 파일 크기 / SW 캐시 (2026-04-30)
- `public/admin/js/app.js`: ~8800줄 (학원 설정 페이지 추가 후 제거 / 녹음 옵션 통합 +60)
- `public/js/app.js`: ~4180줄 (FCM 복구 +190 / pre-check +200 / _rv2 재설계)
- `api/check-recording.js`: 통합 프롬프트 (-50)
- `api/claimFcmToken.js`: 신규 ~80줄
- `docs/notif-disable-guide.md`: 신규 OS 매뉴얼
- SW 캐시: `kunsori-v206`

## 진행률 (2026-04-30)
- 멀티테넌시 인프라: **~95%** (Phase 4 완료, Phase 3 완료, FCM 격리·claim·인지모달 추가)
- 녹음숙제 시스템: **~95%** (5 옵션 시험 배정 통합, N회 무결성, 단일 AI 평가)
- 알림 시스템: **~95%** (멀티 디바이스, 합산 모달, 뱃지 정합)
- 학생 랭킹: **~100%** (작동 시작)
- super_admin 앱: **~85%** (변동 없음)
- 인쇄 시스템: **~95%** (변동 없음)
- Phase 5 출시 준비: **0%**

## 다음 세션 후보 (2026-04-30 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제
2. **글로벌 설정 Firestore 이전** ([project_global_config_refactor.md](memory/project_global_config_refactor.md))
3. **학원장 대시보드 달력** ([project_dashboard_calendar.md](memory/project_dashboard_calendar.md))
4. **학원 설정 페이지 (화이트라벨)** ([project_academy_settings_page.md](memory/project_academy_settings_page.md))
5. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))

---

## 2026-04-30 (오후): 글로벌 설정 Firestore 이전 완료 — super_admin 이 AI 프롬프트·클린업 프리셋 default 편집

당일 SW v206 → v209 (5 commit). 메모리 [project_global_config_refactor.md](memory/project_global_config_refactor.md) Option A (글로벌 default 만, 학원별 override 미구현) 구현 완료.

### 1) 인프라 — `appConfig/*` Firestore 이전
- **`firestore.rules`**: `appConfig/{configId}` — 로그인 사용자 read / `isSuperAdmin()` write
- **초기 시드** ([scripts/admin/seed-app-config.js](scripts/admin/seed-app-config.js)): DRY-RUN / `--apply` / `--force`
  - `api/generate-quiz.js` 의 `SYSTEM_PROMPTS` 정규식 + `Function` 평가로 동적 추출 (중복 정의 회피)
  - 코드 상수 `_CLEANUP_DEFAULT_PRESETS` 인라인 복사
  - `appConfig/aiPrompts` 6 유형 + `appConfig/cleanupPresets` 4 프리셋 시드 완료
- **3단 fallback**:
  1. 학원장 커스텀 (AI: localStorage / 클린업: 학원별 `genCleanupPresets`)
  2. `appConfig/*` (글로벌 default — super_admin 편집)
  3. 코드 상수 (안전망)

### 2) super_admin 앱 — 2 탭 추가
- **🤖 AI 프롬프트** (`page-prompts`): 6 유형 버튼 + textarea + 변경 감지 ●
  - `_promptsCache` 메모리 캐시 / `_promptsDirty` 가드 / `setDoc(..., {merge:true})`
  - "갱신 즉시 모든 학원에 반영" 안내문
- **🧹 클린업 프리셋** (`page-presets`): 카드 목록 + 신규/수정/삭제 모달
  - `presets` 배열 통째로 `setDoc` (배열 수정용)

### 3) 학원장 앱 — 글로벌 default 우선 사용
- **`api/generate-quiz.js`**: `getEffectivePrompt(quizType)` 추가
  - GET (`?type=X` / 전체) · POST 양쪽에서 사용
  - `customSystemPrompt` body 우선 → `appConfig/aiPrompts` → 코드 상수
  - **호출당 read 1회** (캐시 미적용 — 즉시 반영 우선, $0.0000006 / call 미미)
- **`public/admin/js/app.js`**: `_getEffectiveCleanupDefaults()` 추가
  - `appConfig/cleanupPresets` 우선 → `_CLEANUP_DEFAULT_PRESETS` fallback
  - 학원 첫 진입 시드 (`_cleanupSeedDefaults`) + 누락 복구 (`cleanupRestoreDefaults`) 양쪽에 적용

### 4) 클린업 프리셋 — AI 프롬프트와 동일한 default 동기화 모델 (commit da1f464)
초기 구현은 super_admin 갱신이 학원에 반영 안 되는 문제 — `cleanupRestoreDefaults` 가 학원에 없는 이름만 추가하고 같은 이름은 절대 안 덮어썼음. 사용자 피드백으로 재설계:

**개념 정렬** (AI 프롬프트와 동일):
- AI 프롬프트 6 유형 ↔ 글로벌 default 4 프리셋 (이름 매칭)
- 둘 다 추가/삭제 불가, 편집·복원만 가능
- 사용자 추가 (커스텀) 만 자유 CRUD

**구현**:
- `_cleanupGetGlobalDefaultsByName(forceRefresh)` — Map 캐시. 매니저 모달 열 때 force-refresh 로 super_admin 갱신 즉시 반영
- `_cleanupRenderPresetManager` 가 글로벌과 비교해서:
  - 기본 프리셋 (이름 매칭): prompt/description 다르면 ● 빨간 점, [↺ 기본값] 버튼 (다를 때만 활성), [🗑 삭제] 숨김
  - 사용자 추가: ● 없음, 복원 없음, [🗑 삭제] 가능
- `cleanupResetPreset(id)` — `updateDoc` 으로 prompt/description 만 덮어씀 (order/isDefault 메타 보존)
- `cleanupDeletePreset` 가드 — 기본 이름이면 `showAlert('삭제 불가')`
- 상단 [↻ 기본값 복원] → [+ 누락된 기본값 추가] 로 명칭 변경 (괄호로 누락 개수 표시, 0개면 비활성)

### 5) 디버깅 함정 3건

**A. firebase-admin 초기화 누락 (commit 7d23f14)** — 진짜 원인
- `api/generate-quiz.js` 가 `getFirestore` 만 import 하고 admin app 초기화 X
- GET 핸들러는 `verifyAndCheckQuota` 안 거쳐서 init 안 일어남
- `getFirestore()` 가 "default app does not exist" throw → catch → 코드 상수 반환
- **= super_admin 이 갱신해도 학원장은 영원히 옛 default**
- 해결: `_ensureAdminApp()` 헬퍼를 `getEffectivePrompt` 진입 시 호출 (`api/_lib/quota.js` 와 동일 패턴)

**B. 학원장 앱 `_qgAiPromptDefaults` 모듈 캐시 (commit b845769)**
- 첫 fetch 후 영원히 캐시 — [↺ 기본값] 눌러도 stale 값
- 해결: `qgOpenPromptModal` 에서 `Object.keys(_qgAiPromptDefaults).forEach(k => delete _qgAiPromptDefaults[k])` (const 라 재할당 X), `qgResetPrompt` 에서 해당 type 캐시 `delete`
- `_qgFetchDefaultPrompt` 에 `{ forceRefresh }` 옵션 추가 (확장 여지)

**C. 클린업 프리셋 — "이름 같으면 기존 유지" 가 너무 보수적**
- 학원이 글로벌 갱신을 받으려면 [🗑 삭제] → [↻ 기본값 복원] 2단계 필요했음
- 게다가 ID 새로 생기니 추적 어려움
- 해결: 위 §4 의 per-preset reset 모델

### 6) 학원장 앱 `qgSavePrompt` 의 자동 cleanup 검증
- localStorage 에 저장 시 `val === def` 면 `_qgSetCustomPrompt(apiType, '')` 로 자동 삭제 (● 사라짐)
- super_admin 이 default 를 학원장 커스텀과 동일하게 갱신한 경우 학원장 다음 [💾 저장] 한 번에 자동 정리됨 — 의도한 동작

---

## 작업 규칙 추가 (2026-04-30 오후)

- **API 함수에서 firebase-admin 사용 시 초기화 보장 필수** — `getFirestore()`/`getAuth()` 호출 전 반드시 `_ensureApp()` 패턴. 한 핸들러에서 다른 헬퍼가 init 했을 거라 가정 X (cold start / 다른 method 분기 시 init 안 일어날 수 있음). `api/_lib/quota.js` 의 `_ensureApp` 참고.
- **글로벌 default 와 학원 커스텀 동기화 UI 표준** (AI 프롬프트·클린업 프리셋 공통):
  - 매번 모달 열 때 글로벌 default fresh fetch (cache invalidate)
  - 글로벌 매칭되는 항목 = 시스템 default → 추가/삭제 X, 편집/복원만
  - 글로벌 안 매칭되는 항목 = 사용자 커스텀 → 자유 CRUD
  - 시스템 default 이름 옆 빨간 ● 로 "글로벌과 다름" 표시
  - 카드별 [↺ 기본값] 버튼은 ● 있을 때만 활성

---

## 파일 크기 / SW 캐시 (2026-04-30 오후)
- `public/admin/js/app.js`: ~8870줄 (+50, 프리셋 동기화 모델 + 헬퍼)
- `public/super/index.html`: ~280줄 (탭 2개 추가)
- `public/super/js/app.js`: ~600줄 (+250, 프롬프트·프리셋 CRUD)
- `api/generate-quiz.js`: +33줄 (getEffectivePrompt + _ensureAdminApp)
- `firestore.rules`: +9줄 (appConfig)
- `scripts/admin/seed-app-config.js`: 신규 ~155줄
- SW 캐시: `kunsori-v209`

## 진행률 (2026-04-30 오후)
- 멀티테넌시 인프라: **~95%** (변동 없음)
- 녹음숙제 시스템: **~95%** (변동 없음)
- 알림 시스템: **~95%** (변동 없음)
- 학생 랭킹: **~100%** (변동 없음)
- super_admin 앱: **~92%** (글로벌 default 편집 UI 추가)
- **글로벌 설정 Firestore 이전: ~100%** (Option A 완료. 학원별 override 는 별도 폴더 — `project_global_config_refactor.md` 의 "추가 메뉴: 학원별 customPrompts 검토" 항목)
- 인쇄 시스템: **~95%** (변동 없음)
- Phase 5 출시 준비: **0%**

## 다음 세션 후보 (2026-04-30 오후 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제
2. **학원장 대시보드 달력** ([project_dashboard_calendar.md](memory/project_dashboard_calendar.md))
3. **학원 설정 페이지 (화이트라벨)** ([project_academy_settings_page.md](memory/project_academy_settings_page.md))
4. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))

**완료 (이 세션)**:
- ✅ AI 프롬프트·클린업 프리셋 글로벌 default Firestore 이전 (Option A)
- ✅ 클린업 프리셋 동기화 모델 (per-preset reset / 기본 삭제 불가)
- ✅ firebase-admin 초기화 함정 작업 규칙 명문화

---

## 2026-05-01: 한도 재설계 (T1~T9) + 성장 리포트 + 말하기 시험 + 다수 청소

당일 SW v209 → v245 (~50+ commit). 인프라·기능·UX 정비 종합 세션.

### 1) 타임존 KST 통일 (`1154510`, `1a23ab6`)
모든 날짜 처리 UTC → KST 통일. 5/1 새벽 KST 기준 자동 리셋 누락 버그 발견.
- `api/_lib/quota.js _currentYearMonth`
- `public/{admin,js,super}/js/app.js _ymdKST` 헬퍼
- 학원·학생 앱 `_logApiCall`, `loadApiUsage`, super 앱 `_todayYMD`, `_thisMonthRange`, `_fmtDate`/`_fmtDateTime`
- 5개 파일 (학생앱·학원장앱·super앱·서버·진단도구) — 19개 인스턴스 KST 변환
- **새 작업 규칙**: KST 통일은 한 번에 — 부분 통일 시 doc ID/표시 어긋남

### 2) 한도 재설계 T1~T9 (커밋 17개)
HANDOFF `quota-redesign-tasks.md` 따라 **5분류 한도 + 학생 구간별 byTier 차등화**.

#### T1 (`62a030e`) — plans-schema.js 5분류 + byTier
- `aiQuotaPerMonth` 단일 → `ocrPerMonth` + `cleanupPerMonth` + `generatorPerMonth` 3분리
- `perTypeQuota.recording.{check,feedback}` → `recordingPerMonth` 단일
- `growthReportPerMonth` 신규
- Free 5명→10명 확대, OCR 30/Cleanup 60/Generator 50
- `STUDENT_TEST_TIERS` 상수 추가
- `scripts/lib/quota-helper.js` 신규

#### T2 (`61784a3`) — quota.js 5분류 분리 + 'ai' deprecated
- `QUOTA_CONFIG` 상수: counterField·limitField·label
- `'ai'` → `'generator'` 자동 매핑 + 콘솔 경고
- `plan.byTier[tier]` 우선, customLimits override
- `??` 사용 (0 함정 방지)

#### T3 (`83689ce`) — API 호출부 quotaKind + growth-report placeholder
- `ocr/cleanup-ocr/generate-quiz` 'ai' → 분류 이름
- `api/growth-report.js` placeholder

#### T4 (`b40f13b`) — academies 5분류 카운터 백필
- 학원 6곳 모두 신 필드 4개 0으로 추가

#### T5 (`5f654cd`) — 학원장 [📊 AI 사용량] 페이지
- 5분류 진행 바 (80%/95% 색상 변경)
- override 시 `(override)` 배지

#### 월 리셋 버그 fix (`d0456ad`)
- `incrementUsage` 의 `needsReset` 시 자기만 1 → 모든 카운터 0 + 자기 1
- default 학원의 4월 잔존값 정리

#### 대시보드 위젯 갱신 (`62f7ae9`)
- AI 월 호출 = OCR + Cleanup + Generator 합산
- `[📊 상세 →]` 링크 추가

#### T6 (`dc6cdfd`, `f36fc94`, `78cb7f8`) — super_admin [⚙️ 한도 관리] 탭
- 4 플랜 × 구간 한도 카드 + 편집 모달 (영향 학원 수 표시)
- 학원별 customLimits 검색·편집
- 한도 변경 이력 (adminLogs `update_plan_quota`/`update_custom_limits`)
- composite index `adminLogs (action ASC + at DESC)` 배포

#### override ● 표시 (`fd14310`, `33015e8`)
- 학원 관리 행 플랜 옆 빨간 ●
- 호버 툴팁 한국어 라벨 (📌 한도 Override\n· OCR: 300 ...)

#### T7 (`c11bba9`) — 학원 모달 [⚙️ Override] 탭
- 5탭 구조 (기본/타임라인/메모/사용량/Override)
- 자체 [💾 Override 저장] 버튼 + 사유 필수
- 저장 후 학원 행 ● 즉시 반영

#### T8 (`581cd8b`) — 80%/95% 한도 토스트
- `quota.js incrementUsage` 가 `res` 받으면 `X-Quota-Used/Limit/Percent/Kind` 응답 헤더
- 5개 API 호출부에 `{ ...q, res }` 전파
- `_geminiFetch` wrapper 가 `_checkQuotaWarning(res)` 자동 검사
- `_quotaWarned[kind]` 메모리 캐시 — 같은 분류·임계 중복 회피

#### 학원 관리 사용량 셀 5분류 (`2162836`)
- AI 3종 + 운영 2종 그룹 (학생 / OCR·정리·생성 / 녹음·리포트)

#### T9 (`e1f32cf`) — 진단 + 인수인계
- `scripts/diag/check-quota-state.js` 신규
- `docs/session-2026-05-01-quota-redesign.md`

#### 옛 customLimits 입력 제거 (`b315d8e`)
- 학원 모달 기본정보 탭의 acLimitAi/acLimitRec 제거
- saveAcademy 충돌 위험 (T7 customLimits 통째 덮어쓰기) 차단

#### deprecated `aiCallsThisMonth` 정리 (`0155b6b`)
- `scripts/migrate/remove-deprecated-ai-counter.js` 신규 + 6학원 적용
- super 앱 `_renderAcmUsage`/`_loadAcademyTop10` stale 5분류 합산 갱신
- 학원 생성 3 파일 5분류 카운터로 대체

#### 학생 한도 byTier 정합 (`d651e53`, `bf0e76a`)
- 학원 생성/편집 모달 학생 한도 select 를 plan.byTier 키 동적
- Free → `[10]` / Lite/Std/Pro → `[30/60/100]`
- plan select 순서 Free→Lite→Standard→Pro (`order` 기준)
- saloud (Free·30) → studentLimit 10 정정

### 3) Claims 오염 진단·수정 (`dc3febc` 외)
- moon3085@naver.com 의 Custom Claims `role='super_admin'` 잘못 박힘 발견
- `auth.setCustomUserClaims` 으로 `academy_admin` 강제 교정
- 학원장 앱 가드 추가:
  ```js
  if (tk.claims?.role === 'super_admin') { window.location.href='/super/'; return; }
  ```
- `sync-claims` 의 super_admin 보호 정책 한계 — 직접 setCustomUserClaims 필요

### 4) AI OCR 안정화
- 이미지 자동 압축 (`64dfd75`): Vercel 4.5MB 한도 → 1800px JPEG q=0.85
  - 압축 임계 3MB / HEIC/HEIF 항상 압축
  - 일괄 토스트 + 썸네일 📦 배지 + 413 명확 메시지
- 파일명 자연 정렬 (`017fd0a`): `localeCompare(... { numeric: true })`
- 다중 페이지 병합 모달 (`304fca7`, `2bf23f3`): 2개+ 선택 + [수정] → 병합 (원본 삭제 옵션)
- Page 헤더 [해제] 버튼 (`80d72bd`): Chapter/Book 패턴 통일

### 5) AI Generator 단순화 (`3214156`)
- 난이도 학년 10단계 → 상/중/하 3단계
  - 클라 `_qgMapDifficulty` + 서버 `_normalizeDifficulty` 매핑 헬퍼
  - 프롬프트 'Target student grade level' → 'Target difficulty'
- 통과점수 옵션 5곳 모두 제거 (시험 배정 모달이 표준)
- 빈칸채우기 규칙 기반 ~120줄 dead code 제거 — 항상 AI 호출

### 6) Growth Report MVP

#### `0356664` — 서버 + Rules + Index + 모달 + PDF
- `api/growth-report.js`: 학생 정보 + scores 30일 + Gemini JSON (responseSchema) + growthReports 저장
- 폴백 체인 (2.5-flash-lite → 2.5-flash → 3.1-flash-lite-preview)
- Firestore Rules: read=학원장+자기학생, create=서버만, update 차단
- 학원장 앱 [개인별 분석] → [📈 AI 성장 리포트] 모달 (5섹션) + PDF 인쇄

#### `0a390a5` — scores 쿼리 멀티테넌시 fix
- `where('userId','==',uid)` → `where('uid','==',uid) + where('academyId','==',MY)` (Rules 통과)

#### `ba85ee3` — 인쇄 색상 fix
- `print-color-adjust: exact !important` 강제 — 배경 색·그라디언트 보존

#### `4884461` — 이력 드롭다운 (옵션 A)
- 모달 헤더 우측 [📚 이력 (N) ▾] — history 10건 사전 fetch
- `grSelectHistory` — 캐시에서 본문만 교체 (재호출 X)

#### `c9f666d` — PDF 파일명·헤더 학생 이름·날짜
- title: `성장리포트_홍길동_2026-05-01_1430.pdf`

#### `d7f7806` — 메뉴명 + 트리 + 이력 표시
- '개인별 분석' → '성장 리포트'
- 학생 트리 (반-학생 + 검색 + 펼치기/접기)
- 학생 선택 시 detail 영역에 이전 리포트 표 (재호출 X)
- [📈 새 리포트 생성] 버튼

#### `c1defff` — 트리 기본 닫힘 + `f68c169` 삭제 버튼
- 이력 표 행 끝 🗑 + 모달 풋터 [🗑 이 리포트 삭제]

### 7) 단어 말하기 시험 (T1~T7)
HANDOFF `HANDOFF-speaking.md` 의도 → 현 시스템(vocab v2) 의 한 형식으로 통합.

#### T1 (`e64ab19`) — 채점 헬퍼
- `_spkGradeAnswer` + `_spkLevenshteinSimilarity`
- `SPK_STRICTNESS_CONFIG` (lenient 0.7 / normal 0.8 / strict 1.0)

#### T2+T3 (`e726b17`) — 학생앱 마이크 UI + `_vqState` 분기
- vocab format 종류에 'speaking' 추가
- `vqSpeakArea` HTML (vocabQuiz 안 조건부)
- `vqSpkStart`/`_vqSpkFinalize` — Web Speech API en-US 5 alternatives
- 30초 타이머 그대로, 2회 재시도, 권한 거부 안전 처리
- 결과 화면(`_vqBuildDetail`) 에 들린 단어 + 정답 표시

#### T4 (`32ffc9c`) — 시험 배정 모달
- `tpVocabFormat` 에 `🎤 말하기` 옵션
- 노란 박스 — 엄격도 select (`tpSpeakingStrictness`)
- speaking 선택 시 방향·비율 옵션 자동 무력화 (ko2en 강제)

#### T7 (`dc5c686`, `9c70c6b`, `af5b7b6`) — 시험 목록 배지
- 학원장: 시험명 옆 작은 🎤 말하기 배지 (유형은 단어시험 통일)
- 학생앱: 시험 카드 시험명 옆 동일 배지

### 8) 학생앱·학원장앱 메뉴 순서 통일
- 사이드바 [빈칸채우기] [언스크램블] 위치 교체 (`0c4ab15`)
- AI Generator `QG_TYPE_OPTIONS` 동일 (`c566948`)
- 학생앱 홈 메뉴 (`2373cb2`, `116e0e4`):
  단어 → 빈칸채우기 → 언스크램블 → 교재이해 → 녹음숙제 → 랭킹

### 9) 자잘한 버그·UX fix
- 메시지 cascade 삭제 academyId 필터 (`60f0d37`) — 권한 거부로 "불러오기 실패" 해결
- 시험 진행 현황 미통과 점수 표시 (`93381b2`) — `c.latestScore` 폴백
- 시험관리 체크박스 클릭 시 스크롤 보존 (`09ea9a2`) — `tpSetsScroll` id + scrollTop 저장/복원

---

## 작업 규칙 갱신 (2026-05-01)

신규:
- **타임존 KST 통일**: 모든 날짜 처리(`apiUsage` doc ID, `lastResetAt`, `scores.date`, `pushNotifications.date`, super 앱 표시 등)는 KST 기준. 부분 통일은 doc ID 와 표시 어긋남.
- **Custom Claims sync 한계**: `sync-claims` 의 super_admin 보호 정책 — 잘못 박힌 super_admin claims 는 자동 안 풀어줌. 직접 `setCustomUserClaims` 호출 필요.
- **응답 헤더로 사용량 통보**: API 가 `incrementUsage({ ...q, res })` 호출하면 `X-Quota-*` 헤더 자동 set. `_geminiFetch` wrapper 가 자동 검사 + 토스트.
- **`needsReset` 모든 카운터 0 리셋**: `incrementUsage` 의 월 자동 리셋 시 ALL_MONTHLY_COUNTERS 모두 0 + 자기 카운터 1. 한 카운터만 리셋 시 다른 분류 잔존 버그.
- **plans `byTier` 키 정합**: 학원 학생 한도 select 는 `plan.byTier` 키 기반 동적. Free=`['10']`, 나머지=`['30','60','100']`. 자유 입력은 `customLimits.maxStudents` 로만.
- **모달 재렌더 시 스크롤 보존**: 체크박스 토글 등 부분 변경에 전체 `innerHTML=` 재렌더 시 스크롤 컨테이너에 id 부여 + scrollTop 저장/복원.
- **`userCompleted` 표시 시 `latestScore` 폴백**: `c.score`/`c.passed`/`c.date` 는 최고점 통과 시에만 박힘. 미통과 학생 표시 시 `c.latestScore`/`c.latestPassed`/`c.latestAt` 폴백 필수.

---

## 파일 크기 / SW 캐시 (2026-05-01)
- `public/admin/js/app.js`: ~9100줄 (+200, 한도 재설계 + 성장 리포트 + 말하기 시험)
- `public/super/js/app.js`: ~3000줄 (+300, T6 한도 관리 + T7 Override 탭)
- `public/js/app.js`: ~4350줄 (+200, 말하기 시험 통합)
- `api/_lib/quota.js`: 5분류 + X-Quota-* 헤더 (~170줄)
- `api/growth-report.js`: ~250줄 (placeholder → 실 구현)
- `firestore.rules`: +growthReports 규칙
- `firestore.indexes.json`: +adminLogs(action+at) / growthReports / scores(uid+academyId+date) / userNotifications×2
- 신규 스크립트: `check-quota-state` / `remove-deprecated-ai-counter` / `reset-monthly-counters`
- SW 캐시: `kunsori-v245`

## 진행률 (2026-05-01 종료 시점)
- 멀티테넌시 인프라: **~95%**
- **한도 재설계 (T1~T9): ~100%** (검증 도구 + 인수인계 완료)
- super_admin 앱: **~95%** (한도 관리 + Override 탭 추가)
- **성장 리포트 MVP: ~95%** (학원장 흐름 완료, 학생앱 진입점은 Phase B)
- **말하기 시험: ~100%** (vocab format='speaking' 통합)
- 알림 시스템: **~95%**
- Phase 5 출시 준비: **0%**

## 다음 세션 후보 (2026-05-01 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관·개인정보 / 결제
2. **SuperAdmin T7 운영 가이드** — `docs/superadmin-operations-guide.md` 한국어 매뉴얼
3. **학원장 대시보드 달력** ([project_dashboard_calendar.md](memory/project_dashboard_calendar.md))
4. **학원 설정 페이지 (화이트라벨)** ([project_academy_settings_page.md](memory/project_academy_settings_page.md))
5. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
6. **Growth Report Phase B** — 학생 앱 진입점 / 기간 자유 선택 / 모드별 추세 차트

**완료 (이 세션, 2026-05-01)**:
- ✅ 타임존 KST 통일 (5 파일)
- ✅ 한도 재설계 T1~T9 (5분류 분리·byTier 차등화)
- ✅ super_admin 한도 관리 탭 + 학원 모달 Override 탭
- ✅ 80%/95% 한도 토스트 (X-Quota-* 헤더)
- ✅ 성장 리포트 MVP (서버 + 모달 + PDF + 이력 + 삭제)
- ✅ 단어 말하기 시험 (vocab format='speaking' + Web Speech API)
- ✅ AI OCR 자동 압축 + 파일명 자연 정렬 + 페이지 병합
- ✅ AI Generator 옵션 단순화 (난이도 3단계 + 통과점수·규칙기반 제거)
- ✅ deprecated aiCallsThisMonth 필드 제거 + super 앱 stale 갱신
- ✅ 학생 한도 byTier 정합 + plan select 순서
- ✅ Claims 오염 진단·수정 + 학원장 앱 가드
- ✅ 메시지 cascade academyId / 시험 미통과 점수 / 시험관리 스크롤 보존

---

## 2026-05-02: orphan 학생 정리 + AI 사용량 카운터 정합 + Storage 가시화 + 라벨 통일

당일 SW v240 → v254 (~22 commit). 멀티테넌시 격리 누락·카운터 불일치·UI 라벨 정비 종합 세션.

### 1) Orphan 학생 정리 (이민서·오은지) — 엑셀 일괄 등록 누락 fix

**증상**: 학원장이 등록한 학생이 화면에 안 보임 + 재등록 시 "중복" 차단.

**근본 원인** (commit `fe9bb2c`): 학원장 앱 `importStudentExcel` 이 `/api/createStudent` 우회하고 client-side `createUserWithEmailAndPassword` + `setDoc(users)` 만 호출 → academyId / usernameLookup / Custom Claims 모두 누락. Phase 4 멀티테넌시 격리에서 빠진 누락 경로.

**수정**:
- 엑셀 일괄 등록도 `/api/createStudent` fetch 경유 (단일 등록과 동일 패턴)
- idToken 한 번 받아 N명 순차 처리 (rate limit 무관)
- 실패 사유 행별 표시 (이전엔 "중복 아이디" 일괄 메시지만)
- 성공 시 `loadStudents('active')` 자동 새로고침

**진단 자산** (`scripts/diag/`, `scripts/admin/`):
- `check-user-state.js` — username 으로 user/lookup/Auth 정합 확인
- `find-orphan-users.js` — 전체 users 정합성 5개 항목 일괄 진단
- `delete-orphan-user.js` — orphan 완전 삭제 (DRY-RUN/--apply)
- 75명 전원 정합성 OK (이민서·오은지만 fix 후 0건)

**부수**: 학생앱 dead `createUserWithEmailAndPassword` import 제거 (commit `6cfee54`) — Phase 4-3 doSignup 제거 후 미사용.

### 2) 멀티테넌시 정합성 audit (4 패턴 전수조사)
- Pattern A: client-side addDoc/setDoc 28개 — 모두 academyId 박음 ✓
- Pattern B: 서버 API 8개 — 모두 academyId stamp + lookup + Custom Claims ✓
- Pattern C: usernameLookup 누락 경로 없음 ✓
- Pattern D: client-side createUserWithEmailAndPassword — 학생앱 dead import 외 사용처 0 ✓

→ 새로 발견된 활성 버그 없음. 엑셀 일괄 등록만의 단일 누락이었음.

### 3) AI 사용량 카운터 정합 — 3단계 진화

**문제 발견**: 학원장 대시보드 "AI 월 호출 19" < "오늘 AI OCR 27" — 월 카운터가 일별 합보다 작은 비논리.

**진화 1: incrementUsage 위치 이동** (commit `0ba2d0b`)
- 이전: 핸들러 끝 (Gemini 응답 + 파서 성공 후) → 파서 실패 시 비용은 청구되는데 카운터 +0
- 변경: `verifyAndCheckQuota` 통과 직후 → 사용자 시도 기준 보수적 카운트
- 4개 API 적용: ocr / cleanup-ocr / generate-quiz / check-recording

**진화 2: 단일 writer 통합** (commit `695ef9c`)
- 이전: client `_logApiCall` (daily) + server `incrementUsage` (monthly) = 두 writer 가 다른 시점에 다른 조건으로 카운트 → 드리프트
- 변경: server `quota.js incrementUsage` 가 academies.usage(월별) + apiUsage(일별) 한 번에 처리 (`endpoint` 인자 추가)
- client `_logApiCall` 함수·호출 모두 제거 (학원장 앱 1곳, 학생앱 2곳)
- `firestore.rules` apiUsage 클라 쓰기 차단 — admin SDK 만
- 효과: 한 번 통과 시 둘 다 +1, 실패 시 둘 다 +1 (단일 시점·단일 트랜잭션)

**진화 3: growth-report 누락 fix** (commit `0df2cbb`)
- growth-report.js 만 옛 패턴 (incrementUsage 핸들러 끝) + endpoint 미전달
- 같은 패턴으로 통일 + endpoint:'growth-report' 추가
- 학원장 대시보드 일별 위젯 / 월별 합산 / super 앱 모두에 성장 리포트 항목 추가
- "AI 월 호출 (OCR+정리+생성+리포트)" 라벨

**진화 4: 카운터 명명 일관화** (commit `e71724e`)
- `growthReportThisMonth` → `growthReportCallsThisMonth` (다른 4개 `XCallsThisMonth` 와 일관)
- Firestore 6학원 마이그레이션 + 코드 9개 파일 일괄 변경
- 마이그레이션 스크립트 `scripts/migrate/rename-growth-report-counter.js`

### 4) 비용 발생 5분류 endpoint 전수조사
| API | endpoint | quotaKind | counter | 한도 |
|-----|----------|-----------|---------|------|
| ocr.js | ocr | ocr | ocrCallsThisMonth | ocrPerMonth |
| cleanup-ocr.js | cleanup-ocr | cleanup | cleanupCallsThisMonth | cleanupPerMonth |
| generate-quiz.js | generate-quiz | generator | generatorCallsThisMonth | generatorPerMonth |
| check-recording.js | check-recording | recording | recordingCallsThisMonth | recordingPerMonth |
| growth-report.js | growth-report | growthReport | growthReportCallsThisMonth | growthReportPerMonth |

**비용 청구 규칙 (검증 완료)**:
- 사전 차단 (401/429): 비용 0, 카운터 0
- Gemini 호출 후 파서 실패: **비용 발생** (Gemini 청구), 카운터 +1
- 폴백 체인 1차 503 → 2차 성공: 카운터 +1 (1회만)
- 학원장 시각: "사용자 시도 = 카운트" 로 통일

### 5) 학원장 대시보드 위젯 재구성 (commit `80cef48`)
- 3행 (학생/AI 합산/녹음) + 일별 항목별 별도 섹션 → **6행 통일** (학생 + 5분류)
- 각 행: `라벨 / 오늘 N · 이번 달 N/한도 + 진도바`
- 순서: 학생 → OCR → OCR정리 → Generator → 녹음숙제 → 성장 리포트
- (사이드바 / 상세 페이지 / super 앱 동일 순서)

### 6) super 앱 사용량 모니터링 5분류 세분화 (commit `3cb4360`, `711f503`, `1f53fbe`)
- `_renderAcmUsage` (학원 상세 모달): 3행 → 6행 (학생 + 5분류) + customLimits override `*` 표시
- `_loadAcademyTop10` (Top 10 테이블): 6컬럼 → 9컬럼 (학생 + 5분류 + Storage). 헤더 이모지 + 글자 병기. `table-layout:fixed + colgroup` 으로 폭 명시
- 상단 카드 5개 정리:
  - `'🤖 Gemini 오늘 X/1000 X%'` → `'🤖 AI 사용량 (오늘) X 전사 호출 (Gemini+Vision)'`
  - `'✨ 이번 달 AI'` → `'🤖 AI 사용량 (이번 달)'` (3번 카드와 명칭·합산 정의 통일)
  - `ALL_AI_ENDPOINTS = ['ocr','cleanup-ocr','generate-quiz','check-recording','growth-report']` 신규 정의
- Gemini 카드: '🤖 Gemini 일일 쿼터' → '🤖 AI 사용량 (오늘 전사)'. 1000 RPD 게이지·% 위험 알림 폐기 (유료 전환 후 한도 없음). 5 col grid 5분류 카드 + Vision/Gemini provider 라벨
- 엔드포인트별 호출 (이번 달): 5분류 통일 + `📷 OCR / 🧹 OCR 정리 / ✨ Generator / 🎤 녹음숙제 / 📈 성장 리포트` 라벨
- 글로벌 경고 배너 (Gemini 쿼터 80%↑) 폐기

### 7) Storage 가시화 + 수동 점검 (commit `b9a153f`, `711f503`)

**스캔 도구** (`scripts/diag/scan-storage-by-academy.js`):
- 경로 매핑: `hwFiles/*` → Firestore hwFiles 컬렉션 / `recordings/genTests/*` → genTests doc.academyId
- `--apply` 모드: academies.usage.storageBytes + storageReconciledAt 갱신
- 백필 1회 적용 — 6학원 (default 20MB / raloud2 977KB / 나머지 0)
- orphan 7개 파일 발견 (1MB) — Phase 6E 잔존 + hwFiles doc 삭제 후 storage 잔존

**super 앱 [🔄 Storage 점검] 버튼**:
- `api/superAdmin.js` 에 `reconcileStorage` 액션 추가 (함수 수 12 그대로 유지 — Hobby 한도 우회)
- super_admin 클릭 → 스캔 → academies 갱신 → Top 10 자동 새로고침 → adminLogs 기록 + 토스트 + alert

**UI 표시 4곳**:
- 학원장 대시보드 위젯 — `💾 Storage (MM-DD HH:mm) 사용 N MB / N GB + 진도바`
- 학원장 상세 페이지 — Storage 카드 + 마지막 점검 시각
- super 앱 학원 상세 모달 사용량 탭 — Storage 행 + override 표시
- super 앱 Top 10 — `💾 저장` 컬럼 (KB/MB/GB 자동)

**Storage 한도 enforce 미구현 (의도)**:
- plan 의 storageGB 는 시각화·약관 근거. 실 enforce 는 Phase B (hook + Storage Rules + Firestore lookup) 에서 도입
- 100 학원 × 200 GB = 20 TB 시 월 ~$595 (Storage $520 + egress $72) — 비용 통제 인프라 향후 필요
- 보관기간 자동삭제 정책 (졸업·휴원 학생 N개월 후) 등 후속 검토

### 8) Storage 악용 방지 (commit `12e4f60`, `a6e68db`)

**악용 위험**: 학원장이 `hwFiles` 에 영상·zip·개인 백업 등 임의 파일 업로드 가능 (이전 Rules: 50 MB / 타입 무제한).

**Storage Rules 강화** (`storage.rules`):
- hwFiles: 50 MB → **20 MB** + **타입 화이트리스트** (PDF/Office/한글hwp/이미지/텍스트). 영상/zip/실행파일/음성 차단
- notices: 동일 화이트리스트 적용 (현재 미사용이지만 미래 보강)
- recHw rule 삭제 (Phase 6E 폐기 컬렉션)

**클라 사전 검증** (`uploadHwFileAdmin`):
- 파일 선택 즉시 size > 20MB / 타입 미허용 시 친화적 alert
- contentType 비어있으면 확장자로 fallback (브라우저 미인식 케이스)
- `_HW_ALLOWED_MIME` / `_HW_ALLOWED_MIME_PREFIX` 상수 (storage.rules 와 동기화)

**모달 안내**: `📋 허용 형식 (단일 파일 최대 20 MB)` 박스 추가 — 파일 선택 input 아래
- ✅ PDF · Word · Excel · PowerPoint · 한글(hwp) · 이미지 · 텍스트
- ❌ 영상 · 압축파일(zip) · 실행파일 · 음성 (학원 Storage 악용 방지)
- input accept 속성도 확장 (Office / 한글변형 / HEIC / CSV 포함)

→ 3중 방어 (모달 안내 + 클라 검증 + Storage Rules)

### 9) 라벨 정비

**자료실 명칭 통일** (commit `f2b0a1e`): 학원앱 + 학생앱 + super 앱 12 spots
- 학원장 사이드바 / 페이지 헤더 / pageLabels / 등록·수정 모달 타이틀: `숙제파일 관리` → `자료실`, `📁 숙제파일 등록` → `📁 자료 등록` 등
- 학생 앱 홈 카드: `숙제 파일` → `자료실`
- super 앱 학원 데이터 영향 분석 모달 / 안내 문구
- 데이터 필드명 (hwFiles 컬렉션, storagePath, 함수·DOM id) 그대로 유지 — 마이그레이션 회피

### 10) 메모리 추가
- [`project_super_usage_monitoring_revamp.md`](memory/project_super_usage_monitoring_revamp.md) — 1차 정비 완료 (5분류 통일·라벨·Storage), 다음 phase 에서 중복 제거 + 추세 차트 (SuperAdmin Phase B T10) 묶음 권장
- [`feedback_firebase_admin_init.md`](memory/feedback_firebase_admin_init.md) — getFirestore 호출 전 _ensureApp 필수 (이전 세션 추가, 잔여)
- `MEMORY.md` 인덱스 갱신

### 11) AI 평가 실패율 — Phase B 보류
super 앱 systemHealth 의 `Phase B (Cloud Function)` placeholder 그대로 유지. 베타 운영 시작 후 24h 데이터 누적 시점에 Cloud Function 일일 집계 (SuperAdmin Phase B T9) 로 진행 결정. 현 인프라 (시도 기준 카운터) 로는 측정 불가.

---

## 작업 규칙 추가 (2026-05-02)

신규:
- **단일 writer 패턴** — 같은 데이터를 client/server 양쪽에서 쓰면 시점·조건 차이로 드리프트 발생. 한 쪽 (가능하면 server admin SDK) 만 쓰도록 통일. 이번 apiUsage 케이스가 표본.
- **incrementUsage 위치는 quota gate 직후** — Gemini/Vision 호출 후 파서까지 통과해야 카운트하면 비용 청구는 됐는데 카운터 미반영. 사용자 시도 기준 보수적 카운트 유지.
- **클라 업로드 보호 3중 방어** — 모달 안내 + client size/type 사전 검증 + Storage Rules. 한 단계 우회되도 다음 단계가 막음.
- **Storage 한도는 enforce X (현재)** — 시각화·약관 근거 역할. 실 차단은 Phase B (hook + Rules.firestore.get) 도입 시점.
- **Vercel Hobby 12 함수 한도 우회** — 신규 endpoint 필요 시 기존 dispatcher (예: `superAdmin.js`) 에 action 추가. 단점은 단일 함수 비대화·인증 분기 혼합.

---

## 파일 크기 / SW 캐시 (2026-05-02 종료)
- `public/admin/js/app.js`: ~9200줄 (+100, 위젯 재구성·Storage 표시·hwFile 검증)
- `public/super/js/app.js`: ~3050줄 (+50, 5분류 통일·Storage 점검 버튼·라벨)
- `public/js/app.js`: ~4350줄 (-약간, _logApiCall 제거)
- `api/_lib/quota.js`: ~210줄 (+40, daily writer 통합)
- `api/superAdmin.js`: ~430줄 (+90, reconcileStorage)
- `api/growth-report.js`: incrementUsage 위치 이동 + endpoint 인자
- `api/ocr.js` / `cleanup-ocr.js` / `generate-quiz.js` / `check-recording.js`: incrementUsage 패턴 통일
- `storage.rules`: hwFiles 화이트리스트 + 20MB
- `firestore.rules`: apiUsage 클라 쓰기 차단
- 신규 스크립트: `scan-storage-by-academy` / `check-user-state` / `find-orphan-users` / `delete-orphan-user` / `rename-growth-report-counter`
- SW 캐시: `kunsori-v254`

## 진행률 (2026-05-02)
- 멀티테넌시 인프라: **~96%** (엑셀 일괄 등록 누락 fix, 75명 정합 검증)
- 한도 재설계 T1~T9: **~100%** (변동 없음)
- super_admin 앱: **~96%** (Storage 점검 버튼·5분류 세분화·카드 통일)
- AI 사용량 인프라: **~100%** (단일 writer 통합·5분류 정합·growth-report 포함)
- Storage 가시화: **~80%** (수동 점검 + UI 4곳. 자동 cron + hook + enforce 는 Phase B)
- 알림·녹음숙제: **~95%** (변동 없음)
- 인쇄 시스템: **~95%** (변동 없음)
- Phase 5 출시 준비: **0%** (변동 없음)

## 다음 세션 후보 (2026-05-02 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제
2. **학원장 대시보드 달력** ([project_dashboard_calendar.md](memory/project_dashboard_calendar.md))
3. **학원 설정 페이지 (화이트라벨)** ([project_academy_settings_page.md](memory/project_academy_settings_page.md))
4. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))

**Phase B (베타 운영 후) 묶음 작업** — 데이터 30일+ 누적 시점:
- super 앱 사용량 모니터링 정비 ([project_super_usage_monitoring_revamp.md](memory/project_super_usage_monitoring_revamp.md))
- AI 평가 실패율 (T9 Cloud Function 일일 집계)
- 일별 추이 차트 (T10)
- Storage 자동 reconcile cron (Pro 전환 후) + 클라 업로드/삭제 hook
- Storage 한도 실제 enforce (Storage Rules + Firestore lookup)
- 보관기간 자동삭제 정책 (졸업·휴원 학생 녹음)

**완료 (이 세션, 2026-05-02)**:
- ✅ 엑셀 일괄 등록 멀티테넌시 격리 누락 fix (orphan 학생 0건)
- ✅ AI 사용량 단일 writer 통합 (daily/monthly 정합)
- ✅ growth-report 카운터 누락 + 명명 일관화
- ✅ 학원장 대시보드 위젯 5분류 통일
- ✅ super 앱 사용량 모니터링 5분류 세분화 + 카드 명칭 통일
- ✅ Storage 가시화 + 수동 점검 버튼 + 4곳 UI
- ✅ Storage 악용 방지 (hwFiles 타입 화이트리스트 + 20MB)
- ✅ 자료실 라벨 통일 (학원장·학생·super 앱)
- ✅ 비용 발생 5분류 endpoint 전수조사 + 비용 규칙 검증

---

## 2026-05-02 (저녁): 코드 리뷰 지시서 16건 진단 + 11건 적용

LLM 생성 코드 리뷰 지시서 (`CLAUDE_CODE_지시서코드안정화_2026-05-02.md`) 받아
보안·정합성·품질 16건 진단 → 검증 후 11건 적용. SW v257 → v260 (4 commit).

### 진단 결과 — 검증·정책 충돌·범위 조정
| TASK | 결과 |
|------|------|
| 1. deleteUser 인증 누락 | ✅ Critical 사실 — 즉시 fix |
| 2. activeStudentsCount drift | ✅ 사실 — fix |
| 3. customLimits whitelist stale | ✅ 사실 — fix |
| **4. incrementUsage 이동** | ❌ **스킵** — 우리 정책 (사용자 시도 기준 보수적 카운트, 2026-05-02 결정) 과 정반대 |
| 5. createStudent race + customLimits | ✅ 사실 — fix |
| 6. quota-helper 중복 | ✅ — fix |
| 7. Rules users cross-tenant | ✅ — fix |
| 8. 폐기 인덱스 (recSubmissions) | ✅ — fix |
| 9. check-recording 헬퍼명 | ✅ — fix |
| 10. testMode vs mode | ✅ — 조사 후 마이그레이션 |
| 11. /super rewrite | ✅ — fix |
| 12. SW APP_SHELL admin/super | 보류 — 캐시 전략 변경 위험 |
| 13. CLAUDE.md stale | (현재 entry 가 처리) |
| 14. 멀티 디바이스 fcmTokens | ✅ — fix |
| 15. CORS 화이트리스트 | ✅ — 헬퍼 도입 (env 미설정 시 wildcard 폴백) |
| 16. 모듈 분리 | 보류 — 별도 PR (1-2일 작업) |

### 적용 4 stages

**1단계** (commit `4dfc4a0`, SW v257)
- TASK-1: `api/deleteUser.js` 인증 추가 — idToken + admin 권한 + academyId 격리 + 자기삭제 차단
  · 클라 호출부 3곳 (deleteUserFull / deleteSelectedStudent / deleteSelectedOutStudent) idToken 첨부
- TASK-2: `_adjustActiveStudentCount(delta)` 헬퍼 + bulkAction/restoreStudent/restoreSelectedStudent 에 +/-N 호출
  · deleteUser 가 active student 삭제 시 -1 도 함께
- TASK-3: `superAdmin.js` customLimits 화이트리스트 5분류 + maxStudents/storageGB 로 갱신, 옛 키는 console.warn
- TASK-9: check-recording.js 헬퍼명 `_verifyQuota`/`_incUsage` → `verifyAndCheckQuota`/`incrementUsage`

**2단계** (commit `b5a43a4`, SW v258)
- TASK-5: `createStudent.js` Firestore 트랜잭션으로 read+예약 increment 묶음
  · 효과적 한도 = customLimits.maxStudents > plan.byTier[tier].maxStudents > academy.studentLimit > Infinity
  · Auth/Firestore 실패 시 예약 카운터 -1 롤백
- TASK-7: `firestore.rules` users cross-tenant 차단
  · read: 본인 / 같은 학원 / super_admin
  · update/delete: 본인(자기 doc) / 같은 학원 admin / super_admin
  · `firebase deploy --only firestore` 배포 완료
- TASK-8: `firestore.indexes.json` recSubmissions 인덱스 제거
- TASK-11: `vercel.json` /super /super/ rewrite 추가
- TASK-14: `sendPush.js` 가 user 도큐먼트 fetch 시 fcmToken + fcmTokens 둘 다 수집 (이전엔 fcmToken 단일만)
  · dedup·invalid token 정리는 이미 처리되고 있어 자동 적용

**3단계** (commit `5159ef1`, SW v259)
- TASK-10: scores.testMode 잔존 정리
  · 진단: 286건 중 mode 220 / mode+testMode 66 / testMode 만 0
  · 마이그레이션 (`scripts/migrate/remove-score-testmode.js`) — mode==testMode 인 66건 testMode 필드 삭제
  · 코드 폴백 4곳 (`s.mode || s.testMode`) 제거
  · 검증: 286건 모두 mode 만 보유
- TASK-15: `api/_lib/cors.js` 헬퍼 도입
  · env `ALLOWED_ORIGINS` 미설정 시 wildcard 폴백 (현 동작 유지)
  · 6개 API (deleteUser/createStudent/createAcademy/check-recording/claimFcmToken/sendPush) 의 3줄 수동 헤더 → setCors 1줄
  · 배포 후 Vercel env 등록 시 외부 도메인 차단 활성화

**4단계** (commit `f462654`, SW v260)
- TASK-6: `getEffectiveLimits` 단일화
  · `api/_lib/quota.js verifyAndCheckQuota` 의 인라인 한도 결정 → helper 호출
  · `scripts/lib/quota-helper.js` 를 `api/_lib/quota-helper.js` 와 완전 동기 (mirror)
  · 스모크 테스트 + check-quota-state 진단 정상

### 주요 신규 자산
- `api/_lib/cors.js` — CORS 화이트리스트 헬퍼
- `scripts/diag/check-score-mode.js` — scores 컬렉션 mode/testMode 잔존 진단
- `scripts/migrate/remove-score-testmode.js` — testMode 필드 안전 제거 마이그레이션

### 작업 규칙 추가
- **LLM 생성 코드 리뷰 지시서 검증 우선** — 청구 내용을 spot-check 후 적용. 일부 항목은 정책 충돌 (TASK-4) 또는 컬렉션 혼동 (TASK-10) 가능성. 데이터 진단 → 코드 변경 → 검증 순서.
- **Vercel Hobby 12 함수 한도 우회** — 신규 함수 대신 기존 `superAdmin.js` dispatcher 에 action 추가 (이전 세션에 reconcileStorage 적용한 패턴).

### 보류 / 후속
- TASK-12 (SW APP_SHELL admin/super) — 첫 로드 캐시 전략 변경 위험. Phase 5 polish 시 검토
- TASK-15 활성화 — Vercel env `ALLOWED_ORIGINS=https://raloud.vercel.app` 등록 (사용자 작업)
- TASK-16 (admin app.js 9KLOC 모듈 분리) — 별도 1-2일 PR. v1.0 polish 사이클에서

---

## 파일 크기 / SW 캐시 (2026-05-02 종료)
- `public/admin/js/app.js`: ~9230줄 (+30, race transaction + activeStudentsCount 헬퍼)
- `public/super/js/app.js`: ~3060줄 (+10, showAlert/showConfirm 헬퍼)
- `api/_lib/cors.js`: 신규 ~30줄
- `api/_lib/quota.js`: -10줄 (인라인 → helper 호출)
- 신규 진단/마이그레이션: check-score-mode / remove-score-testmode
- SW 캐시: `kunsori-v260`

## 진행률 (2026-05-02 최종)
- 멀티테넌시 인프라: **~98%** (Rules users cross-tenant 강화, deleteUser 인증, fcmTokens 멀티 디바이스)
- 한도 재설계: **~100%** (customLimits.maxStudents 정합, race 트랜잭션, helper 단일화)
- 보안: **~95%** (deleteUser P0 fix, CORS 헬퍼, Rules 강화)
- AI 사용량: **~100%** (변동 없음)
- Storage: **~80%** (변동 없음)
- Phase 5 출시 준비: **0%**

---

## 2026-05-03 ~ 2026-05-07: 결제 v2 Phase 1·2·3 + 화이트라벨 브랜딩 + 다수 UX/버그 정리

당일 SW v260 → v293 (~33 commit). 결제 시스템 v2 전체 구축 + 학원별 화이트라벨 도입 + 시험관리 학생 제외 등 운영 기능 보강.

### 1) 결제 v2 시스템 — Phase 1·2·3 전 단계 완료

**Phase 1 — 데이터 모델 + 그리드** (이전 세션 진행, 마무리 정리만):
- `billings/{id}` 컬렉션 (academyId/yearMonth/items[]/totalAmount/status)
- `academies.paymentSettings` (tuitionChannel + materialsChannel + messageSettings)
- `users.tuitionPlan` (amount/dueDay/active)
- 결제 설정 마법사 (2단계) + 자동 청구서 lazy 생성 (`_ensureCurrentMonthBillings`)
- Excel 스타일 그리드 (학원비/교재비 채널 분리) + 항목 사이드 패널

**Phase 2 — 학원장 안내 메시지**:
- `_billingBuildMessage` 빌더 (3 템플릿 polite/brief/reminder × 2 채널)
- 채널 정보 인라인 (각 채널 옆에 계좌 묶음 — 스택 형태 아님)
- 미납자 일괄 메시지 (카드 슬라이드 흐름)
- **학원-wide 템플릿 편집기** (`_billingOpenTemplateEditor`):
  - 학생별 편집본 폐기 → 학원 단위 customTemplates 단일화
  - 데이터 placeholder를 **노란 배경 chip (contenteditable=false)** 으로 표시 — 수정 불가
  - 일반 텍스트(인사말·서명)는 자유 편집
  - 페이스트 시 plain text only (`onpaste` 핸들러)
  - DOM walker `_billingTplExtractTemplate` 로 chip → placeholder 환원해 저장

**Phase 3 — 결산·타임라인·이력 (3 탭 추가)**:
- 📋 청구 그리드 (기존 default)
- 📊 **월간 결산** ([_renderBillingSummary](public/admin/js/app.js)) — 채널별 청구·입금·미수 + CSV 다운로드 (UTF-8 BOM, Excel 한글)
- 📅 **타임라인 (3개월)** ([_renderBillingTimeline](public/admin/js/app.js)) — 학생 × 최근 3개월. ✅◐○ 아이콘 + 미수금 표시. 미수금 많은 순 정렬
- **학생 12개월 결제 이력** — 학생 수정 모달 하단 [💳 12개월 결제 이력 보기] 버튼. 누적 청구·입금·미수 + 평균 납부 지연 일수

**결제 v2 후속 fix**:
- 인사말/서명을 default 템플릿에 일반 텍스트로 인라인 (chip 외라 자유 편집)
- `{학원명}` placeholder 빈 치환 버그 — `_loadMyAcademyContext` 에서 academies/{id}.name fetch 추가 (`window.MY_ACADEMY_NAME`)
- 결제관리 반/상태 **필터 무동작** — ES module `let` 변수에 inline onchange `_billingFilterGroup=this.value` 직접 할당이 글로벌 스코프에 잡혀 module 변수 갱신 안 됨. `window._billingChangeFilterGroup(val)` 별도 함수로 분리
- 결제관리 행별 [🗑 삭제] — 청구서 삭제 + `users.tuitionPlan.active=false` 동시 (자동 청구 영구 OFF, 다음 진입 시 재생성 차단)

### 2) 화이트라벨 브랜딩 시스템 — Phase A·B·C 전 단계 완료

**Phase A — 핵심 인프라**:
- [public/js/branding-presets.js](public/js/branding-presets.js): 7색 프리셋 (코랄/블루/그린/퍼플/오렌지/핑크/네이비)
  - `applyPresetToCss(preset)` 가 `--brand-*` 변수 + `--teal`/`--c-brand` 별칭 동시 set
  - 학원장 앱 32곳 `var(--teal)` / 학생 앱 4곳 `var(--c-brand)` 자동 따라옴 (CSS 토큰화 이미 완료된 점 활용)
  - `bgGradient` 7스톱 fade — 학생 앱 홈 배경 색별 변경
- [api/_lib/branding-presets-cjs.js](api/_lib/branding-presets-cjs.js): 서버용 CJS 미러 (manifest API 사용)
- [api/uploadLogo.js](api/uploadLogo.js): PNG 5MB → sharp `192/512` 자동 리사이즈 → Storage. Free 플랜 차단
- [api/manifest.js](api/manifest.js): `?academy=xxx` 쿼리로 학원별 PWA manifest 동적 생성 (5분 캐시)
- 학생 앱 `_loadMyAcademyContext` 에서 academies doc 1회 fetch 통합 → `_applyAcademyBranding` 호출
- 로그인 화면 푸터 **Powered by LexiAI 🤖** (모든 플랜)

**Phase B — 학원장 [🎨 학원 브랜딩] 페이지**:
- 사이드바 신규 메뉴 + `goPage('branding')` 라우팅
- 좌측 학생 앱 미리보기 (sticky) + 우측 색상 팔레트 7개 + 로고 업로드 + 캐치프레이즈 (40자)
- Free 플랜 잠금 — 노란 안내 카드 + 모든 입력 disabled
- 학원장 앱 자체 브랜딩 적용 — `_applyAdminBranding` 가 헤더 로고·학원명·CSS 변수 일괄 갱신

**Phase C — 인프라 정리**:
- `firestore.rules` academies update 화이트리스트에 `branding` 추가
- `storage.rules` `academies/{id}/logos/` — read 모두, write 차단 (server admin SDK 만)
- [scripts/migrate/backfill-branding.js](scripts/migrate/backfill-branding.js) — 6학원 기본값 백필 완료
- SW: `storage.googleapis.com` 항상 네트워크 (로고 변경 즉시 반영)

**브랜딩 후속 fix**:
- `branding-presets.js` 의 `export {...}` 구문이 일반 `<script>` 로 로드 시 SyntaxError → 파일 전체 미실행 → `window.BRANDING_PRESETS` 미등록 → `_applyAdminBranding` throw → 학원장 무한 로딩. export 제거하고 `window.*` 글로벌만 사용
- `_renderBrandingPage` onclick 핸들러 escape 실수 — 백틱 템플릿 안 `\\'` 가 `\` (escaped backslash) + `'` (string 종료) 로 파싱 → `Free` identifier 노출 → `Unexpected identifier 'Free'`. `_brandingShowLockMsg()` 별도 함수로 분리
- iOS apple-touch-icon 동적 갱신 (manifest 보다 우선시되는 메타) — `_applyAcademyBranding` 에서 `link[rel="apple-touch-icon"].href` 도 갱신
- 학원장 앱 `theme-color` meta 부재로 모바일 주소창 색 미반영 — admin/index.html 에 추가
- 시험지 인쇄 워터마크 + 헤더 로고 학원 로고 반영 — `_tpBuildPrintHtml` 의 `logoUrl` 변수가 `window.MY_ACADEMY_LOGO` 우선 (헤더 42×42 + 워터마크 32% 둘 다 자동)
- `{학원명}` placeholder 빈 치환 버그 (위 결제 섹션과 동일 — 같은 fetch 추가로 해결)

### 3) 시험관리 운영 기능

**문제 세트 다중 삭제** (시험관리 6개 유형 페이지):
- 패널 헤더 [🗑 삭제] 빨간 버튼 (체크 1개 이상 활성)
- `tpDeleteSelectedSets` — 이름 5개 미리보기 + 확인 모달 + 일괄 deleteDoc
- `qsEditSet` 폴백 체인 누락 fix (`_qsList → _tpSets → Firestore`) — 시험관리에서 [수정] 시 "세트 못 찾음" 에러

**시험(genTests) 단건 삭제**:
- 최근 시험 테이블 행별 [🗑 삭제] 버튼 (작업 컬럼 신규)
- `tpDeleteGenTest` — `genTests/{id}` + 하위 `userCompleted/{uid}` cascade 삭제. `scores`는 보존 (이력 가치)
- 버튼 폭/이모지 크기 후속 조정 (12px 텍스트 + 15px 이모지, white-space:nowrap)

**시험에서 학생 제외** ([tpExcludeStudent](public/admin/js/app.js)):
- 응시 현황 펼침 학생 카드 우상단 [✕] 버튼 (4가지 카드 변형 모두 적용)
- 4단계 처리:
  1) `genTests/{id}.excludedUids` 에 `arrayUnion(uid)`
  2) `genTests/{id}/userCompleted/{uid}` 삭제
  3) `scores` 에서 testId+uid 매칭 일괄 삭제 (성장 리포트 자동 제외)
  4) 펼침 화면 자동 갱신
- 학생 앱 `filterMyTests` 에 `excludedUids` 체크 추가 → 시험 목록에서 숨김
- **복구 UI 없음** (단순·명확) — 다시 보게 하려면 시험 새로 배정. 확인 모달에 명시
- `arrayUnion` import 추가 (admin app)

**🎤 말하기 배지 일관 표시**:
- 시험관리 최근 시험 테이블 시험명 셀에 `_testNameSpeakingBadge(t)` 호출
- 성적 리포트 testName 컬럼에 작은 🎤 배지 — `loadScoreReport` 가 genTests 1회 fetch 해서 `testId → speaking` 맵 생성, `_srData[i]._isSpeaking` 첨부
- 시험목록 메뉴 + 시험관리 + 성적 리포트 3곳 일관 표시

### 4) AI Generator 부분 캐시 race fix
- `loadQuizGenerate` 의 `if (!_genPages.length && !_genBooks.length)` — 둘 다 비어야 fetch
- 시험관리 메뉴는 books/chapters 만 fetch (pages 안 함) → `_genBooks.length > 0` 상태에서 AI Generator 진입 시 if 블록 skip → pages 비어있어 카운트 0
- AI OCR 다녀오면 정상화 (사용자 우회로)
- 수정: 3개 컬렉션 각각 비어있을 때만 개별 fetch (Promise.all 부분 병렬)

### 5) 운영 진단 도구

**학생 정보 placeholder 진단** ([scripts/diag/check-student-fields.js](scripts/diag/check-student-fields.js)):
- 의심 패턴 (Admin/학원장/test/홍길동/010-0000-0000 등) 일괄 검출
- 다수 학생 동일값 (default 의심) + phone/parentPhone 비숫자 값 검사
- 진단 결과: default 학원 6명 phone='admin' 발견 → [reset-admin-phone.js](scripts/migrate/reset-admin-phone.js) 로 빈 문자열 reset 적용

**blurt 단어 진단** ([scripts/diag/check-blurt-word.js](scripts/diag/check-blurt-word.js)):
- 학원장 보고: blurt 입력했는데 오답 처리 + 정답 표시가 "Blurt"
- genQuestionSets + genTests 광범위 검색 (vocab/fill_blank 등 sourceType 무관) + 문자 코드 dump
- 결과: 데이터 정상 (소문자 5자, hidden char 없음). 채점 시뮬레이션 정답 처리됨
- 의심: 입력 시 hidden char/공백 또는 CSS text-transform:capitalize 표시 이슈
- **채점 정규화 변경 보류** — 다음 사례 시 ans.input raw 값 진단 후 결정

### 6) 그 외 fix
- `qsEditSet` 폴백 체인 (위 § 3 참조)
- 결제관리 [🗑 삭제] 버튼 폭 확대 + 이모지 크기 강조

---

## 작업 규칙 추가 (2026-05-06)

신규:
- **ES module `let` 변수에 inline onchange/onclick 으로 직접 할당 X** — 글로벌 스코프에 잡혀 module 변수 미갱신. `window.X(val)` 별도 함수로 분리해서 호출.
- **백틱 템플릿 안 `\\'` 함정** — JS parser 가 `\\` (escaped backslash) + `'` (string 종료) 로 해석해 이후 토큰이 raw identifier 노출 (SyntaxError). 핸들러 안 alert 메시지에 따옴표 필요하면 별도 함수로 분리.
- **`<script>` 로 로드되는 파일에 `export` 키워드 X** — module 컨텍스트 외에선 항상 SyntaxError, try-catch 로 감쌀 수 없음. `window.*` 글로벌 노출만 사용 또는 type="module" 통일.
- **`_genPages`/`_genChapters`/`_genBooks` 캐시 갱신은 컬렉션별 개별 조건** — 어떤 메뉴를 거쳤는지에 따라 일부만 채워질 수 있어 `(!A && !B)` 같은 일괄 가드 X.

---

## 파일 크기 / SW 캐시 (2026-05-07)
- `public/admin/js/app.js`: ~12000줄 (+~3000, 결제 v2 + 브랜딩 페이지 + 시험관리 운영)
- `public/js/app.js`: ~4400줄 (+~50, FCM/브랜딩/excludedUids)
- `public/super/js/app.js`: 변동 없음
- `public/js/branding-presets.js`: 신규 ~120줄 (7 프리셋 + applyPresetToCss)
- `api/_lib/branding-presets-cjs.js`: 신규 ~17줄 (서버 미러)
- `api/uploadLogo.js`: 신규 ~155줄 (sharp 192/512)
- `api/manifest.js`: 신규 ~95줄 (PWA 동적)
- `firestore.rules`: academies update 화이트리스트 +`branding`
- `storage.rules`: +`academies/{id}/logos/`
- 신규 진단/마이그레이션: backfill-branding / check-student-fields / reset-admin-phone / check-blurt-word
- 의존성 추가: `sharp ^0.34.5`
- SW 캐시: `kunsori-v293`

## 진행률 (2026-05-07)
- 결제 v2: **~95%** (Phase 1·2·3 완료. 자동화 cron / PG 결제 연동은 Phase 5 묶음)
- 화이트라벨 브랜딩: **~95%** (Phase A·B·C 완료. 도메인/서브도메인 라우팅은 출시 직전 별도)
- 시험관리 운영: **~95%** (다중 삭제 + 학생 제외 + 말하기 배지 일관)
- 멀티테넌시 인프라: **~98%** (변동 없음)
- 한도 재설계: **~100%** (변동 없음)
- 보안: **~95%** (변동 없음)
- AI 사용량: **~100%** (변동 없음)
- Storage: **~80%** (변동 없음)
- Phase 5 출시 준비: **0%**

## 다음 세션 후보 (2026-05-07 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
2. **학원장 대시보드 달력** ([project_dashboard_calendar.md](memory/project_dashboard_calendar.md))
3. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
4. **AI 평가 실패율** (Phase B Cloud Function — 베타 운영 후)

**완료 (이 세션, 2026-05-03~05-07)**:
- ✅ 결제 v2 Phase 1·2·3 (그리드·메시지·결산·타임라인·이력)
- ✅ 화이트라벨 브랜딩 Phase A·B·C (7색·로고·캐치프레이즈·PWA manifest)
- ✅ 시험관리 다중 삭제 + 학생 제외 + 말하기 배지 일관
- ✅ AI Generator 부분 캐시 race + 결제관리 필터 + qsEditSet 폴백 다수 버그 fix
- ✅ 학생 phone='admin' 6명 정리 + blurt 진단 도구
- ✅ ES module / 백틱 escape / export 함정 작업 규칙 명문화
