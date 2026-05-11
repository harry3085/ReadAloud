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

---

## 2026-05-07 (이어서): 학원장 대시보드 큰 달력 + 시험 화면 통일 + 화이트라벨 깜빡임 제거

당일 후속 SW v307 → v322 (~17 commit). 대시보드 재구성 + 시험관리/목록 통일 + 화이트라벨 FOUC 제거 종합.

### 1) 학원장 대시보드 큰 달력 통합 (P1~P5)
사전 점검: `users.birth` 채워진 비율 6% (4/66 명), 결제·시험 데이터는 정합. 메모리·핸드오프의 `users.birthday` 추측이 틀림 — 실제 필드는 **`users.birth`** (input id 만 `euBirth`).

**구조 (commit `c1ad60e`)**:
- 좌측(공지·AI 사용량) + 우측(큰 달력 + 사이드 패널 280px) 2열 그리드
- 작은 달력·최근 시험 결과·재원생 현황 카드 제거 (공간 양보)
- 사용자 결정: 생일은 6% 채움이라 보류, 결제·시험만 표시

**핵심 함수** ([public/admin/js/app.js](public/admin/js/app.js)):
- `_bigcalState` (cur, events, selected) — module 스코프
- `_bigcalLoadEvents(year, month)` — billings.yearMonth(기존 인덱스) + genTests.createdAt(기존 인덱스)+클라 date 필터 → **추가 인덱스 deploy 0**
- `_bigcalRender()` / `_bigcalRenderSide()` — 그리드/사이드
- `bigcalInit/ChangeMonth/GoToday/_SelectDate` — 진입 시 오늘 자동 선택, 월 이동 ◀ ▶ + [오늘]

**CSS** (`.bigcal-*` 클래스, `.cal-*` 와 분리):
- 셀 min-height 108px (commit `669bb2c` 1.5배 확대), MAX_SHOW 5건 (commit `0c3b422`)
- 모바일 600px↓ 텍스트 → 6×6 색점, 사이드 패널 아래 스택

### 2) 결제 학생 이름 표시 fix (commit `52dfe82`)
**원인**: P2 코드가 `b.items[].userName` 에서 학생명 찾음 → items 는 청구 항목(수강료/교재비) 배열, 학생 정보 X.
**실제 데이터 모델**: billings doc 레벨에 `studentUid`, `studentName`, `groupName`, `totalAmount`, `paidAmount`, `status` ('paid'|'partial'|'unpaid').
**수정**: doc 1건 = 1행, partial 색 amber(`#d97706`) 신규 (범례·CSS 추가).

### 3) 결제 행 클릭 → 인라인 상세 모달 (commit `b7e6606`, `799fd28`)
- `_bigcalShowBillingDetail(billingId)` — billings doc 1건 fetch, 표준 모달 패턴(560px / header·body·footer)
- 본문: 청구/납부/미납 3박스 + 항목 리스트(타입·채널·금액·납부 배지) + 메모(있으면 노란 박스)
- 풋터: [닫기] / [결제관리에서 열기 →]
- **페이지 ID 함정**: 실제 id 는 `page-payment` / `nav-payment` / `goPage('payment')` 인데 처음엔 `'billing'` 으로 호출해 빈 화면. 사이드바 onclick 과 일치 확인 필수.

### 4) 항목 체크박스 납부 토글 (commit `3b31677`)
대시보드 모달에서 항목별 체크박스 → 즉시 Firestore 저장 + 모달 재오픈(요약 갱신) + 캘린더 셀·사이드 즉시 반영.
- `_bigcalApplyItemUpdate(billingId, mutator)` 헬퍼 — doc fetch → mutator 적용 → totalAmount/paidAmount/status 재계산 → updateDoc
- 결제관리 캐시(`_billings`) + `_bigcalState.events` 양쪽 동기화
- 일괄 [✓ 전체 납부 처리] 버튼 (모두 납부면 [↺ 전체 미납 되돌리기])

### 5) 상단 카드 fix
- **미납** (`statUnpaid`, commit `7b84b02`): 레거시 `payments` 컬렉션 → 결제 v2 `billings` (이번 달 yearMonth 의 status!=paid 카운트). 기존 인덱스 academyId+yearMonth 활용.
- **오늘 시험** (`statTests`, commit `e6d5402`): scores.date==today (오늘 응시 점수) → genTests.date==today (오늘 출제된 시험). 운영 관점·달력 데이터 소스와 통일.

### 6) 시험 목록 ↔ 시험관리 화면 통일

**6a) 시험 목록 행 클릭 → 시험관리와 동일 학생별 카드** (commit `93bd203`)
이전: `toggleTestProgress` (반별 chip 단순 표시)
신규: `tpToggleTestProgress` 재사용 — 4가지 카드 변형(✅ 통과 / ⚠ 미통과 / ⏳ 대기 / 🎤 녹음 + AI 피드백) + ✕ 학생 제외 뱃지
- `tpToggleTestProgress(testId, prefix?)` 시그니처 확장: `'tp'`(시험관리) | `'tl'`(시험 목록)
- `_tpLastPrefix` module 변수로 prefix 유지 → `tpExcludeStudent` 자동 갱신도 같은 prefix
- 시험 목록 row ID 패턴: `test-row-` → `tl-row-`, `progress-` → `tl-progress-` (시험관리 `tp-` 와 분리해 동시 DOM 충돌 방지)
- `_TEST_TYPE_CONFIG[_activeTestType]` 의존 제거 → `t.testMode || t.mode` 로 isRec 직접 판별

**6b) 시험 대상 표기 반별 구분** (commit `de80bc2`)
이전: 다중 대상 시 `'N명/반 선택'` 단일 카운트
신규: `'1반 전체 / 2반 3명'` 식 반별 분리
- `_buildTargetName(targets)` 헬퍼 — `targets[].groupName` 기준 반별 분류
- 표시 시점에 `t.targets` 보고 즉석 생성 → 기존 `'N명/반 선택'` 으로 저장된 데이터도 자동 새 표기
- 신규 배정(mcq + 일반) 도 새 표기로 doc 저장 → 점진 일관화
- 반 전체로 잡힌 그룹은 학생 카운트에서 중복 제거

**6c) 시험관리 최근시험 표 — 시험 목록과 컬럼 통일** (commit `3243a04`)
이전: 시험명 / 대상 / 문항 / 통과·응시·대상 / 평균 / 출제일 / 작업 (7컬럼)
신규: **No / 시험명 / 대상 / 교재 / 문항수 / 출제일 / 통과·응시·대상 / 평균 / 작업** (9컬럼)
- 유형 컬럼 X (각 시험관리 페이지가 이미 유형별)
- 체크박스 X (시험관리는 행별 [🗑 삭제] 방식)
- 출제일 `t.date` → `_fmtTestDateTime(t)` (YY-MM-DD HH:mm)
- 대상 회색 텍스트 → badge-teal 배지
- 진행상태(통과/응시/대상)·평균은 비동기 채움(`_tpLoadTestStats`) 그대로

### 7) LexiAI 화이트라벨 깜빡임 제거 (4 commit)

**증상**: 학원장이 로그아웃 후 재로그인할 때 / 학원장 앱 진입 시 LexiAI 로고·이름이 짧게 노출. 색상도 LexiAI 코랄로 돌아옴 → 흰 글씨 안 보임.

**원인 3개**:
1. 학원장 앱 헤더에 `LexiAI` 텍스트·이미지가 **HTML 직접 박힘** — Firestore branding fetch 전에 노출
2. 학생앱 `onAuthStateChanged` 첫 호출 시 `appConfig/branding`(LexiAI 기본) 을 localStorage 에 **강제 캐시** → 학원장 학원 cache 가 LexiAI 로 덮임
3. 비로그인 시 `_applyAcademyBranding({name:''})` 호출이 **헤더를 LexiAI 로 강제 갈아치움** → 인라인 FOUC script 가 모처럼 적용한 cache 가 다시 LexiAI 로 덮임. 색 프리셋(`applyPresetToCss`) 도 default 코랄로.

**수정 (commit `d170f91`/`733a79f`/`09655d4`)**:
- 학원장 앱 `<head>` 에 인라인 FOUC script 추가 — DOMContentLoaded 전 cache 읽어 `.header-logo img`·텍스트·title 즉시 적용
- `_applyAdminBranding` / `_applyAcademyBranding` 끝에 `localStorage.setItem` 추가 — `lexiLogo192` / `lexiAppName` / **`lexiBrandPreset`**(색 프리셋 ID) 3 키 cache
- 색 프리셋도 cache 적용 — `branding-presets.js` 가 인라인 script 보다 위에 로드되어 BRANDING_PRESETS·applyPresetToCss 즉시 사용 가능 (DOM 대기 X, CSS 변수 set 만)
- 학생앱 `onAuthStateChanged` 의 LexiAI 기본 강제 cache 제거 + 비로그인 시 `_applyAcademyBranding` 호출 자체 제거 → cache 단일 진입점 (`_applyAcademyBranding`/`_applyAdminBranding` 만 set)

**결과**: 학원장 첫 진입 후 cache 박힘 → 학생앱·학원장앱 양쪽 모두 첫 페인트부터 학원 로고+이름+색. 비로그인 학생앱 첫 방문은 그대로 LexiAI fallback (HTML default).

---

## 작업 규칙 추가 (2026-05-07 이어서)

신규:
- **페이지 ID 일치 필수** — 사이드바 `goPage('X')` / `<div id="page-X">` / `<div id="nav-X">` 셋이 같은 X 여야 함. 다른 이름 호출 시 빈 화면. 신규 페이지 추가 시 grep 으로 일관성 확인.
- **localStorage cache 단일 진입점** — 같은 키를 여러 곳에서 set/clear 하면 한 곳이 set 한 직후 다른 곳이 덮어쓰는 무한 루프. 한 함수만 set/clear, 다른 곳은 read 만.
- **헤더·title 등 HTML 박힌 brand 데이터는 인라인 FOUC script 로 cache 적용** — `<head>` 안 inline `<script>` 가 dependency(branding-presets.js 등) 보다 아래여야 즉시 사용 가능. DOMContentLoaded 안에서 DOM 갈아치움. 색 프리셋(CSS 변수) 은 DOM 대기 없이 즉시 적용 가능.
- **billings 데이터 모델** — `studentName`/`totalAmount`/`paidAmount`/`status` 는 **doc 레벨**. items[] 는 청구 항목(수강료·교재비) 배열로 학생 정보 X. items[].paid 토글 시 doc.totalAmount/paidAmount/status 재계산해서 같이 updateDoc.

---

## 파일 크기 / SW 캐시 (2026-05-07 이어서)
- `public/admin/js/app.js`: ~12300줄 (+~300, 큰 달력 + 결제 모달 + 시험 통일)
- `public/admin/index.html`: 변동 없음 (3열 → 2열 그리드, FOUC script 추가)
- `public/admin/style.css`: +.bigcal-* 클래스 (~50줄)
- `public/js/app.js`: 변동 적음 (cache set + FOUC 호출 제거)
- `public/index.html`: FOUC script 색 프리셋 추가
- 신규 진단: `scripts/diag/check-calendar-data.js`
- SW 캐시: `kunsori-v322`

## 진행률 갱신 (2026-05-07 이어서)
- **학원장 대시보드 달력: ~95%** (큰 달력 + 결제·시험 통합 + 인라인 모달 + 항목 토글. 생일 카테고리는 보강 후보)
- 화이트라벨 브랜딩: ~95% → **~98%** (FOUC 깜빡임 해결, 첫 페인트부터 학원 색·로고·이름)
- 시험관리 운영: ~95% → **~98%** (학생별 카드 통일·대상 반별 표기·컬럼 통일)
- 결제 v2: ~95% (변동 없음)
- 멀티테넌시 인프라·한도·보안·AI 사용량: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-07 이어서 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
2. **달력 생일 카테고리 추가** — `users.birth` 입력 강화 + 4번째 점 색 ([project_dashboard_calendar.md](memory/project_dashboard_calendar.md) 후속 보강)
3. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
4. **AI 평가 실패율** (Phase B Cloud Function — 베타 운영 후)

**완료 (이 세션 이어서, 2026-05-07)**:
- ✅ 학원장 대시보드 큰 달력 통합 (P1~P5, 결제·시험·인라인 모달·항목 토글)
- ✅ 결제 학생 이름 fix (billings doc 레벨) + partial 상태 색 분리
- ✅ 상단 카드 fix (미납 → billings, 오늘 시험 → genTests)
- ✅ 시험 목록·시험관리 학생별 카드 통일 + 대상 반별 표기 + 컬럼 통일
- ✅ LexiAI 깜빡임 제거 (FOUC + 색 프리셋 캐시 + 비로그인 갈아치움 제거)
- ✅ 페이지 ID 일치 + localStorage 단일 진입점 + billings 데이터 모델 작업 규칙 명문화

---

## 2026-05-08: 시험출제 출제수 옵션 + 공통 대상 picker 통합 + 메시지·공지·자료실 다중 선택 + 성장 리포트 정비

당일 SW v322 → v337 (~16 commit). 큰 두 흐름:
1. **공통 대상 셀렉터(picker) 헬퍼 추출** — 시험출제·메시지·공지·자료실·객관식 5곳 모두 단일 패턴
2. **성장 리포트 학생 detail 정비** — 30일 기준 통계·페이지네이션·컬럼 폭·이력 표

### 1) 시험출제 모달 — 출제 문제수 옵션 (랜덤 픽)
[tpOpenPublishModal](public/admin/js/app.js) 시험 정보 그리드 4열로 확장. `tpQuestionCount` input (default = 풀 전체, min=1, max=풀 전체) + "전체 N문제 중 랜덤" 안내. tpPublish 에서 입력값 < 풀 시 `slice().sort(() => Math.random() - 0.5).slice(0, N)` 셔플 후 픽. 확인 모달에 `(전체 N 중 랜덤)` 표시. `isFinite(parseInt(...))` 패턴으로 0/NaN 함정 회피.

### 2) 메시지 관리 1차 정비 (Phase 직전)
**4가지 변경**:
- 학생 검색 input + 후보 드롭다운 (단일 선택 — 옛 select 폐기)
- 내용 textarea rows 4→12 + resize:vertical
- 발송 이력 행 클릭 → **그 행 바로 아래 인라인 펼침** (옛 별도 카드 폐기, `showMsgReadStatus` 함수 제거)
- 메시지 관리(저장 초안) ↔ 발송 이력 두 섹션 분리 + 가운데 **드래그 리사이저** (localStorage `msg_split_ratio` 저장/복원)

이후 사용자 피드백으로 학생 검색은 다중 선택 picker 로 다시 교체 (Phase B).

### 3) 공통 대상 picker 헬퍼 추출 (Phase A·B·C·D·E)

**Phase A — UI 레이블 "그룹" → "반" 통일**
- 메시지관리 4곳 (page-sub / 라디오 / "그룹 선택" / alert 메시지)
- 변수명·DB 필드 (`group`) 는 그대로 — 마이그레이션 위험 회피
- 다른 곳 (공지·자료실) 은 이미 "대상" 으로 표기됨

**Phase B — 공통 picker 헬퍼 + 메시지관리 + sendPush API**
- [_picker / pickerInit / pickerGetTargets / pickerSummarize](public/admin/js/app.js#L3409-L3577) (~200줄)
- 단일 글로벌 state — 한 번에 한 picker 활성. cfg = `{ boxEl, summaryEl, allowAll, emptyText, height, onChange }`
- `targets[] = [{type:'all'|'class'|'student', id, name, groupName?}]`
- `_pickerFetchStudents` 1분 캐시. window.pickerToggleAll/Class/Student 노출
- 시험출제 모달 — 옛 인라인 셀렉터·`tpModalToggleGroup`/`tpModalToggleStudent`/`_tpUpdateModalSummary` 모두 폐기, `pickerInit({allowAll:false, height:280})` 호출
- 메시지관리 — 라디오(전체/반/학생) + 학생 검색박스 모두 폐기, `pickerInit({allowAll:true})` 인라인. `pushNotifications` 신 schema 저장 (`targets[]` + `targetSummary`)
- `api/sendPush.js` 확장 — `targets[]` 배열 받아 type 별 학생 UID 수집 + dedupe + FCM 발송. usersByUid Map 으로 다중 대상 안전 처리. 옛 단일 `target` 분기도 호환 유지 (안전망)
- 객관식 시험배정 (`mcqOpenTargetPicker`) 도 동일 picker 사용. `_mcqTargets` 는 onChange 콜백으로 동기화 유지

**Phase C — 공지관리도 picker**
- 공지 작성/수정 모달 — 단일 `<select>` 폐기, `pickerInit({allowAll:true})`
- `notices` 신 schema (`targets[]` + `targetSummary`)
- 학생앱 ([public/js/app.js](public/js/app.js)) — `_noticeMatchesMe` / `_noticeLabel` / `_noticeIsAll` 헬퍼. 신/구 schema 모두 처리 (이전 데이터 호환)

**Phase D — 발송이력 카드 그리드 + ✕ 학생 회수**
- `_msgRenderSentDetail` — 인라인 펼침을 학생 카드 그리드로 (`auto-fill, minmax(160→98px,1fr)`)
- 미읽음 빨강 / 읽음 초록 + 작은 색점 (✓/!) 학생명 옆
- ✕ 클릭 → `userNotifications/{id}` deleteDoc → 학생 알림함에서 사라짐 (Rules `delete: if isAdminOfMyAcademy()` 통과)
- **이미 폰에 도착한 OS 푸시는 회수 불가** — 단 학생이 앱 알림함을 열면 거기엔 없음 (본문 자세히 보기 차단). 사용자 컨펌

**Phase E — 자료실 (hwFiles)**
- `openHwFileModal` / `editHwFile` — 단일 select 폐기, picker (allowAll=true)
- `hwFiles` 신 schema (`targets[]` + `targetSummary`). 단일 대상 케이스에는 옛 `group/targetUid` 도 함께 채움 (학생앱 폴백)
- 학생앱 `loadHwFiles` 도 신/구 schema 호환 필터 (`_hwFileMatchesMe` / `_hwFileLabel`)

### 4) 메시지 박스 폭 고정 — CSS Grid `1fr` 함정 해결

가로 스크롤이 사라지지 않는 문제 — 핵심 원인은 **CSS Grid `1fr` 트랙의 기본값 `min-width:auto` (= min-content)**.

부모 grid (page-message: `grid-template-columns:380px 1fr`) 의 1fr 칸은 안쪽 콘텐츠의 min-content 만큼은 보장하려 함. 행 안 nowrap 텍스트가 한 단어로 길면 → min-content 가 그 단어 너비 → 칸 자체가 늘어남 → 가로 스크롤.

**수정**:
- `msgListCard` 에 `min-width:0; overflow:hidden` 추가 → grid 칸이 부모 폭에 강제 한정
- 행 outer: `width:100%; max-width:100%; box-sizing:border-box; overflow:hidden`
- 안쪽 flex item: `flex:1 1 0; min-width:0; overflow:hidden`
- 부모 스크롤 컨테이너 (savedMsgDrafts/Sent): `overflow-x:hidden`
- msgSentWrap / msgSentInline: `width:100%; max-width:100%; overflow:hidden`

### 5) 메시지 본문 미리보기 한 줄 + 말줄임

이전: 50자 한 줄 (slice). 변경 시도: 200자 3줄 (line-clamp). 사용자 피드백 — "한 화면에 더 많은 행 노출 위해 한 줄 + 말줄임".

`_bodyPreview` 헬퍼 — `replace(/\s+/g, ' ')` 로 줄바꿈 공백 변환 + `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. 행 높이 일정.

학생 카드 그리드 — `minmax(160→98px,1fr)`, padding `8/28 → 5/20`, 학생명 옆 큰 ✅/🔴 → **작은 색점 (✓/!)**, 반 정보 9px, ✕ 16×16. 같은 공간에 약 2.5배 학생 노출.

### 6) 성장 리포트 학생 detail 정비

**진단 — 유형 배지 `-` 표시 원인**:
- [scripts/diag/check-score-mode-values.js](scripts/diag/check-score-mode-values.js) — scores 컬렉션 mode 값 분포 진단 도구
- 결과: 337건 중 36건 (`mixed` 30 / `meaning` 4 / `spelling` 2) 이 표준 5개 키 (vocab/fill_blank/unscramble/mcq/subjective/recording) 외 값
- 옛 학생앱이 단어시험 form 을 mode 필드에 직접 저장 (CLAUDE.md 의 2026-04-23 마이그레이션 (`word`→`vocab`) 때 누락)
- 마이그레이션: [scripts/migrate/unify-vocab-mode.js](scripts/migrate/unify-vocab-mode.js) — `mixed/meaning/spelling` → `vocab` 일괄 변경. `_modeOldValue` 백업 필드 + `_modeMigratedAt` 타임스탬프 (가역적). DRY-RUN/--apply.
- 적용 후: vocab 101→137 (+36), 알 수 없는 값 0건. 학원장 화면 유형 배지 `-` 사라짐

**시험 목록 표 컬럼 재배치** (4 라운드 조정):
- 최종: `<colgroup>` + `table-layout:fixed`
- No 40 / 유형 100 (언스크램블 한 줄) / **교재명 가변** / **시험명 가변** / 점수 70 (nowrap) / 정답·전체 70 / 날짜 90
- 고정 합 360px, 잔여를 교재·시험명이 균등 분할
- 잘리면 hover `title` 툴팁으로 전문 노출
- 페이지네이션 40건/페이지 (`initPagination('personalScoreBody', scores, ..., 7, {pageSize:40})`)

**상단 3카드 30일 통일**:
- 응시 횟수 / 평균 점수 / 80점 이상 — 옛 누적 → **최근 30일** (AI 리포트 분석 범위와 일치)
- `scores30d = scores.filter(s => s.date >= today-30d)` 별도 계산
- 카드 위 헤더 `📊 최근 30일 통계 YYYY-MM-DD ~ YYYY-MM-DD` 명시
- 응시 내역 표는 그대로 누적 (`(전체 누적 · 40건씩 페이지)` 라벨 명시) → 같은 학생에서 카드(30일) vs 표(누적) 가 다른 숫자임을 사용자가 명확히 인지

**이전 성장 리포트 표 정비**:
- 5건씩 페이지네이션 (`initPagination('grHistoryBody', history, ..., 6, {pageSize:5})`)
- table-layout:fixed + colgroup: 생성일 90 / 평균 54 / 응시 54 / 요약 가변(가장 넓음) / 👁 32 / 🗑 38
- 요약 폰트 11→12px + 한 줄 자르기 + hover title 툴팁
- 표 안 👁/🗑 사이즈 16px line-height:1 통일

### 7) 🗑 이모지 사이즈 통일 (1차)
- 결제 항목 단독 🗑: 11 → **16px** (font-size + line-height:1)
- 결제 행 / 시험 행 [🗑 삭제] 결합형 span: 14·15 → **16**
- 성장 리포트 표 🗑/👁: 16 (신규)
- `<button class="action-btn danger">🗑 삭제</button>` 형태 9곳 (HTML) 은 텍스트와 🗑 가 같은 폰트 사이즈라 그대로 유지. 별도 패스 (CSS 클래스 `.icon-del` 도입 + 9곳 span 변환) 후보

---

## 작업 규칙 추가 (2026-05-08)

신규:
- **CSS Grid `1fr` 트랙은 기본 `min-width:auto`** — 안쪽 nowrap 콘텐츠가 한 단어로 길면 min-content 가 그 단어 너비로 계산돼 트랙 자체가 늘어남 → 가로 스크롤. **grid item 에 `min-width:0` + `overflow:hidden` 명시 필수**. flex item 의 `min-width:0` 함정과 동일 패턴.
- **공통 picker 패턴** — 시험출제·메시지·공지·자료실·객관식 모두 단일 `_picker` 헬퍼 사용. 새 화면 추가 시: `pickerInit({boxEl, summaryEl, initialTargets, allowAll, emptyText, height, onChange})` 호출 → `pickerGetTargets()` 로 읽음. targets[] 형식 통일 (`{type:'all'|'class'|'student', id, name, groupName?}`).
- **신/구 schema 호환 필터** — targets[] 신 schema 도입 시 학생앱 클라 필터에 `Array.isArray(f.targets) && f.targets.length` 분기 + 옛 단일 필드 폴백. 마이그레이션 X (사용자가 옛 데이터 삭제 예정인 경우만 호환 폴백 안 해도 됨).
- **알림 회수의 한계** — `userNotifications/{id}` deleteDoc 은 학생 알림함만 정리. 폰 OS 푸시 배너 (이미 도착) 는 회수 불가. UX 안내 필수.
- **scores 누적 통계 vs 30일 통계 구분 라벨** — 같은 화면에 두 기준 혼재 시 헤더에 명시 필수 (`📊 최근 30일 통계 YYYY-MM-DD ~ YYYY-MM-DD` 등).
- **table-layout:fixed + colgroup 권장** — 컬럼 폭이 콘텐츠 길이에 휘둘리는 게 싫을 때. width 없는 col 들끼리는 잔여 폭 균등 분할.

---

## 파일 크기 / SW 캐시 (2026-05-08)
- `public/admin/js/app.js`: ~12970줄 (+~670, picker 헬퍼·다중 선택·성장 리포트 정비)
- `public/admin/index.html`: ~977줄 (+~10, picker box 영역·overflow-x 추가)
- `public/js/app.js`: ~4810줄 (+~50, 공지·자료실 신/구 schema 호환 필터)
- `api/sendPush.js`: targets[] 처리 (+~50줄)
- 신규: `scripts/diag/check-score-mode-values.js` / `scripts/migrate/unify-vocab-mode.js`
- SW 캐시: `kunsori-v337`

## 진행률 (2026-05-08)
- 멀티테넌시 인프라: ~98% (변동 없음)
- 결제 v2: ~95% (변동 없음)
- 화이트라벨 브랜딩: ~98% (변동 없음)
- 시험관리 운영: ~98% (변동 없음)
- **공통 대상 셀렉터 통합: ~100%** (5개 화면 picker 단일화)
- **시험출제 옵션: ~100%** (출제 문제수 추가)
- **메시지·공지·자료실 다중 선택: ~100%** (Phase A·B·C·D·E 완료)
- **성장 리포트 정비: ~95%** (30일 통계·페이지네이션·이력 표·mode 마이그레이션)
- 학원장 대시보드 달력: ~95% (변동 없음)
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-08 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관·개인정보 / 결제 PG 연동
2. **🗑 이모지 사이즈 전체 통일 2차** — CSS 클래스 `.icon-del` 도입 + `<button class="action-btn danger">🗑 삭제</button>` 9곳 span 변환
3. **달력 생일 카테고리 추가** — `users.birth` 입력 강화 + 4번째 점 색
4. **v1.0 Polish 사이클** ([project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
5. **AI 평가 실패율** (Phase B Cloud Function — 베타 운영 후)
6. **`_modeOldValue` 백업 필드 정리** — unify-vocab-mode 안정 확인 후 별도 cleanup 스크립트로 36건의 백업 필드 제거 (선택)

**완료 (이 세션, 2026-05-08)**:
- ✅ 시험출제 모달 출제 문제수 옵션 (랜덤 픽)
- ✅ 메시지 관리 1차 정비 (학생 검색·textarea 3배·인라인 펼침·드래그 리사이저)
- ✅ 공통 picker 헬퍼 추출 + 5개 화면 단일화 (Phase A~E)
- ✅ pushNotifications/notices/hwFiles 신 schema (`targets[]` + `targetSummary`) — 학생앱 신/구 호환
- ✅ 발송이력 카드 그리드 + ✕ 학생 회수
- ✅ CSS Grid `1fr` `min-width:auto` 함정 fix (메시지 박스 가로 스크롤)
- ✅ 성장 리포트 학생 detail — 30일 기준 통계 + 컬럼 재배치 + 페이지네이션
- ✅ scores.mode 옛 단어시험 키 마이그레이션 (mixed/meaning/spelling → vocab, 36건)
- ✅ 이전 성장 리포트 표 페이지네이션 (5건) + 폭 재조정
- ✅ 🗑 이모지 사이즈 1차 통일 (단독 + 결합 span 16px)

---

## 2026-05-08 (저녁): super_admin LexiAI 기본 브랜딩 + PWA 흐름 정비 + 시험화면 토큰화

당일 SW v322 → v339 (~17 commit). 화이트라벨 시스템 후속 — Free 학원·미설정 학원의 기본값을 super_admin이 변경 가능하도록 + PWA 설치 흐름 정비 + 시험 풀이 화면 색 토큰화.

### 1) super_admin [🎨 LexiAI 브랜딩] 탭

`appConfig/branding` 도큐먼트 — Free 학원·미설정 학원의 fallback. super_admin 전용 편집:
- **🎨 색상 프리셋** (7개 중 default 선택)
- **🖼️ 기본 로고** (PNG 5MB → sharp 192/512 자동 리사이즈)
- **🏷️ 기본 앱 이름** (defaultAppName — 'LexiAI' 또는 학원장 추가 안내문)
- **✨ 기본 캐치프레이즈** (defaultCatchphrase 40자)

저장 위치:
- Firestore `appConfig/branding` (super_admin write 전용, **read public** — 로그인 전 화면 fallback)
- Storage `appConfig/branding/logos/{original|192|512}.png`

API 확장 (`api/uploadLogo.js`):
- `target='lexiai'` 파라미터 → super_admin 만 가능, `appConfig/branding` 경로
- 일반 학원 업로드와 분리 (학원 admin / super_admin 둘 다 사용)

미리보기 (`_renderLexiAIBranding`): 학생 로그인 화면 형태로 색·로고·이름·캐치프레이즈 즉시 반영.

### 2) Fallback 체인 일관화

학생 앱 / 학원장 앱 / `api/manifest.js` 모두 일관:

| 학원 플랜 | 색·로고·이름 |
|-----------|-------------|
| **Free** | 항상 super_admin LexiAI 기본 (학원 자체 brand 무시) |
| **Lite+** | 학원 자체 branding 우선 → 비어있으면 LexiAI 기본 → 코드 default(coral) |

학생 앱 `_loadMyAcademyContext`: `academies` + `appConfig/branding` 병렬 fetch → `window.LEXIAI_BRANDING` 노출 → `_applyAcademyBranding` 가 fallback 적용.

학원장 앱 `_applyAdminBranding` 동일 패턴.

### 3) PWA 설치 흐름 전면 정비

**학생 앱**:
- 로그인 화면 [📱 홈화면 추가] 버튼 **제거** (로그인 전이라 LexiAI 로 등록되던 문제)
- 학생 메인 화면 우상단 점3개 메뉴에 **[홈화면에 추가]** 항목 추가 (내 정보 변경 / 로그아웃 사이)
- standalone 모드면 자동 숨김

**학원장 앱**:
- manifest link + apple-touch-icon + service worker 등록 추가
- 헤더 우측 로그아웃 옆에 **[📱 바로가기]** 버튼 추가
- `_loadMyAcademyContext` 가 `updateAdminManifest(academyId)` 호출 → 학원별 manifest URL 갱신
- standalone 모드면 자동 숨김

**`api/manifest.js`**:
- `admin=1` 파라미터 추가 → start_url=`/admin/`, scope=`/admin/`, name 에 ` 관리자` 추가
- `id` 필드로 학생 PWA 와 별개 인스턴스로 등록 → 같은 디바이스에 학생/학원장 별도 아이콘 가능

**iOS 호환**:
- `apple-touch-icon` 메타 동적 갱신 (manifest 보다 우선시)
- iOS Safari 안내 alert (`installAdminApp`/`installApp`) — 공유→홈화면 추가 절차

**인앱 브라우저 감지** (`public/index.html`):
- UA 패턴 매칭: 카카오톡 / 네이버 / 페북 / 인스타 / Line / WeChat / Daum / Android WebView
- 로그인 화면 상단에 노란 안내 배너 — OS별 브라우저 전환 가이드 + [📋 주소 복사] 버튼

### 4) FOUC 제거 — LexiAI 정적 아이콘 교체

- 정적 `/icons/icon-192.png` + `/icons/icon-512.png` 를 super_admin 업로드 LexiAI 로고로 직접 덮어씀
- `scripts/admin/sync-lexiai-icons.js` 신규 — Storage 에서 다운받아 정적 파일 갱신
- 첫 방문자도 캐시 비운 사용자도 LexiAI 로고 첫 페인트부터 표시
- 추가로 학생 앱 inline `<head>` script — localStorage `lexiLogo192`/`lexiAppName` 캐시 → DOMContentLoaded 즉시 적용 (재방문자 FOUC 제거)

### 5) 시험 풀이 화면 색상 토큰화

학생 앱의 시험 화면이 코랄 hex 박혀 학원 브랜딩 미반영이던 문제 — 일괄 변수화:

- `public/js/app.js` 13곳: `#E8714A` → `var(--c-brand)`, `#D85A30` → `var(--c-brand-dark)`, `#FFE0D4` → `var(--c-brand-cream)`, `linear-gradient(150deg,...)` → `var(--brand-header-gradient)`
- `public/style.css`: 4종 그라디언트 + login-input/progress-bar-wrap/choice-btn.correct/notice-tag/hw-done 등
- `public/index.html`: vocabQuiz 합체 카드 헤더 그라디언트 + 마이크 버튼 + 타이머 SVG circle stroke (속성 → style 변환) + 정보 모달 타이틀

이제 학원이 [브랜딩]에서 색 변경 시 **시험 풀이 화면 (단어/객관식/빈칸/언스크램블/녹음숙제) 모두 학원 색 즉시 반영**.

### 6) 자동 로그아웃 후 흰 버튼 버그 fix

학원장 앱 1일 자동 로그아웃 → `/` 학생앱 redirect → 학생앱 로그인 화면이 **흰 버튼**으로 표시되던 버그.

**원인**:
- `applyPresetToCss` 가 빈 string/undefined 도 `setProperty` 호출
- 빈 값으로 set 하면 `:root` 의 default 가 무효화 → `var(--brand-login-gradient)` = 'none' → 배경 안 보임

**2단 방어**:
1. **`setIf` 가드** — `applyPresetToCss` 가 truthy 값일 때만 setProperty (누락 키는 default 살아남음)
2. **branding-presets.js 로드 즉시** `applyPresetToCss(BRANDING_PRESETS.coral)` IIFE 호출 — onAuthStateChanged 가 발화 안 해도 첫 페인트부터 코랄 색

### 7) 그 외 수정

- AI Generator [메뉴 진입 시 카운트 0 표시 race fix](public/admin/js/app.js) — `loadQuizGenerate` 의 `if (!_genPages && !_genBooks)` 조건이 시험관리에서 books만 fetch한 상태 후 진입 시 skip → pages 비어있어 카운트 0. 각 컬렉션 비어있을 때 개별 fetch
- 결제관리 [반/상태 필터 무동작](public/admin/js/app.js#L1449) — ES module `let` 변수 inline onchange 직접 할당 실패. `window._billingChangeFilterGroup(val)` 별도 함수
- 결제관리 행별 [🗑 삭제] — 청구서 삭제 + `users.tuitionPlan.active=false` (자동 청구 영구 OFF)
- 시험관리 [🗑 삭제] — 다중 (`tpDeleteSelectedSets`) + 단건 (`tpDeleteGenTest`) + 학생 제외 (`tpExcludeStudent` cascade)
- `qsEditSet` 폴백 체인 추가 — `_qsList → _tpSets → Firestore` (시험관리에서 호출 시 "세트 못 찾음" 해결)
- 학생 phone='admin' 6명 정리 ([scripts/migrate/reset-admin-phone.js](scripts/migrate/reset-admin-phone.js))
- 'Powered by LexiAI' 뒤 🤖 이모지 제거 (3곳)
- 정적 HTML '큰소리 영어' → 'LexiAI' 일괄

### 8) 핸드오프 문서

`docs/dashboard-cards-handoff.md` — 학원장 대시보드 카드 구조 + 큰 달력 통합 작업 정리. 다음 세션에서 새 챗으로 이어서 진행 가능.

---

## 작업 규칙 추가 (2026-05-08 저녁)

신규:
- **`<script src="...">` 동기 로드 파일은 IIFE 끝에서 default 적용** — 비동기 fetch 결과를 기다리는 코드만 있으면 이벤트 미발화 시 흰 화면 위험. `branding-presets.js` 의 `applyPresetToCss(BRANDING_PRESETS.coral)` 가 표본.
- **`setProperty` 빈 값 함정** — `style.setProperty(name, '')` 또는 `undefined` 호출 시 `:root` 의 default 가 무효화되어 `var()` 가 빈 값으로 평가됨 → background:none. 가드 필수: `if (val) setProperty(...)`.
- **PWA 별도 인스턴스 분리** — 같은 도메인에 두 PWA(학생/학원장) 등록하려면 manifest 의 `id` 필드 다르게 + `start_url` 다르게. `id` 필드 미사용 시 같은 PWA로 인식돼 한 쪽만 등록.
- **인앱 브라우저 UA 패턴 표준** — 카카오/네이버/페북/인스타/Line/WeChat/Daum + Android WebView (`;\s*wv\)`). 신규 인앱 추가 시 같은 패턴 보강.

---

## 파일 크기 / SW 캐시 (2026-05-08 저녁)
- `public/admin/js/app.js`: ~13000줄 (변동 적음)
- `public/super/js/app.js`: ~3400줄 (+200, LexiAI 브랜딩 탭)
- `public/js/app.js`: ~4900줄 (+50, 학생앱 brand fetch + dropdown install item)
- `public/js/branding-presets.js`: ~140줄 (+20, setIf 가드 + IIFE default 적용)
- `api/uploadLogo.js`: target='lexiai' 분기 추가
- `api/manifest.js`: admin=1 파라미터 + id 필드 + LexiAI defaultAppName fallback
- `firestore.rules`: appConfig/branding read public 분기
- `storage.rules`: appConfig/branding/logos/ 경로 추가
- 신규: `scripts/admin/sync-lexiai-icons.js` / `docs/dashboard-cards-handoff.md`
- SW 캐시: `kunsori-v339`

## 진행률 (2026-05-08 저녁)
- 화이트라벨 브랜딩: **~99%** (Phase A·B·C·D 모두 완료, super_admin 기본 + Free fallback + 시험 화면 토큰화)
- super_admin 앱: **~98%** (LexiAI 브랜딩 탭 추가)
- PWA 설치 흐름: **~100%** (학생/학원장 별도 PWA + iOS/Android/PC 분기 + 인앱 안내)
- 결제 v2: ~95% (변동 없음)
- 시험관리 운영: ~98% (변동 없음)
- 멀티테넌시 인프라: ~98% (변동 없음)
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-08 저녁 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관·개인정보 / 결제 PG 연동
2. **학원장 대시보드 큰 달력** ([docs/dashboard-cards-handoff.md](docs/dashboard-cards-handoff.md) + [memory/project_dashboard_calendar.md](memory/project_dashboard_calendar.md))
3. **자동 로그아웃 후 학원 색 유지** — localStorage academyId 저장 → redirect 시 `/?academy=xxx` 로 추방 → 학생앱이 학원 brand 미리 적용
4. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
5. **AI 평가 실패율** (Phase B Cloud Function — 베타 운영 후)

**완료 (이 세션 저녁, 2026-05-08)**:
- ✅ super_admin [🎨 LexiAI 브랜딩] 탭 — 색·로고·앱이름·캐치프레이즈
- ✅ Fallback 체인 일관화 (Free → LexiAI / Lite+ → 학원→LexiAI→default)
- ✅ PWA 설치 흐름 정비 — 학생 앱 점3개 메뉴, 학원장 앱 [📱 바로가기], manifest admin=1 분리, id 필드
- ✅ 인앱 브라우저 감지 + 노란 안내 배너
- ✅ 정적 아이콘 LexiAI 교체 (FOUC 제거) + sync 스크립트
- ✅ 학생 앱 시험 화면 색상 토큰화 (모든 풀이 화면)
- ✅ 흰 버튼 버그 fix (setIf 가드 + 즉시 default 적용)
- ✅ 결제 필터 / qsEditSet 폴백 / AI Generator race / blurt 진단 / phone='admin' 정리 등
- ✅ 대시보드 카드 핸드오프 문서

---

## 2026-05-08 (밤): SSR 도입 — iOS PWA 학원명 자동 노출 + 결제 패널 Eventual Consistency fix

당일 SW v337 → v365 (+28). 두 큰 흐름:
1. **iOS PWA [홈화면 추가] 시 학원명 자동 노출** — 8회 시도 끝에 SSR 도입으로 해결 (Phase 1 학생 + Phase 2 학원장)
2. **결제 패널 항목 입력 즉시 반영** — Firestore eventual consistency + closeModal wrapper 함정

### 1) iOS PWA 학원명 문제 — SSR 로 최종 해결

**증상**: iOS Safari·Mac Safari·Mac Chrome 의 [공유 → 홈화면 추가] 시 input 에 학원명 안 나오고 'LexiAI' 또는 'L E X I A I' (super_admin 입력값) 표시. Android Chrome 은 자동 학원명.

**시도하다 실패**:
1. apple-mobile-web-app-title 메타 동적 갱신 (setAttribute / createElement) — iOS 가 첫 캡처만 사용
2. manifest link href 동적 변경 (`replaceWith`) — 브라우저가 다시 fetch X
3. manifest API `Cache-Control: no-store` — 도움 안 됨
4. URL `?academy=xxx` 자동 reload — `_applyAcademyBranding` 안에서 doLogin navigation 도중 trigger 되어 학생앱 무한 로딩
5. 정적 메타 제거 + JS createElement 추가 / 정적 `<title>` 빈 값 — 효과 없음
6. SW HTML intercept (workbox-style) — `FetchEvent.respondWith received an error: TypeError: Type error` 페이지 자체 못 열림

**진단으로 결정적 단서**:
- [scripts/diag/dump-default-academy.js](scripts/diag/dump-default-academy.js) — `academies/default.name = "큰소리 영어"` 정상 박혀있음
- 그러나 사용자 [홈화면 추가] = 'LexiAI'. super_admin defaultAppName 변경 시 즉시 반영 → **iOS 가 manifest.name 우선 사용 결정적 증거**

**진정한 해결 — SSR (Phase 1 학생 + Phase 2 학원장)**:

| 변경 | 내용 |
|------|------|
| `public/index.html` → `public/_app.html` rename | Vercel 정적 파일 우선 동작 우회 |
| `public/admin/index.html` → `public/admin/_app.html` rename | 동일 |
| [api/render-index.js](api/render-index.js) 신규 | GET / 호출 받아 `academies/{id}` fetch + `_app.html` template `fs.readFileSync` + `<title>` / `apple-mobile-web-app-title` / `application-name` / **manifest link href** 학원명·`?academy={id}` 로 치환 후 응답 |
| [api/render-admin.js](api/render-admin.js) 신규 | render-index 와 동일 패턴. ` 관리자` suffix + manifest URL `&admin=1` |
| `vercel.json` rewrites | `/`, `/index.html` → `/api/render-index`. `/admin`, `/admin/`, `/admin/index.html` → `/api/render-admin` |
| `public/sw.js` APP_SHELL | `/`, `/index.html` 제거 (SSR 응답 캐시 방지) |

**핵심 fix (Phase 1 deployed 후 추가)** — `<link rel="manifest" href>` 도 `?academy={id}` 박힘. iOS 가 manifest 우선 사용하므로, SSR 응답 시점부터 manifest URL 이 학원별이어야 학원명 노출.

**Vercel 캐시**: `Cache-Control: public, s-maxage=300, stale-while-revalidate=60` + `Vary: Cookie` (학원별 분리)

**Pro 플랜 전환**: Hobby 한도 12개 거의 다 차서 새 함수 2개 (render-index, render-admin) 추가 위해 사용자가 Pro 전환.

**알려진 함정 메모**:
- HTTP 헤더 값은 ASCII 만 허용 — `X-Ssr-Academy: 큰소리영어` (한글) → 'Invalid character in header content' throw → 진단 헤더 제거 필요
- SW HTML intercept — Vercel·iOS Safari 환경에서 응답 객체 reconstruction (`new Headers`/`response.text()`/Content-Encoding) 처리에 throw 가능. 안전한 회귀 어려움 — 결국 SSR 로

### 2) 결제 패널 항목 입력 즉시 반영 fix

**증상**: 결제관리 항목 입력·완료 시 그리드에 즉시 안 보이고 다른 화면 갔다 와야 반영.

**원인 1 — `_billingPanelDone` 의 350ms 고정 대기**:
- onblur 의 async `updateDoc` 가 더 오래 걸리면 `_renderBillingGrid` 가 fresh fetch 하다가 stale 응답 받음

**원인 2 — Firestore Eventual Consistency**:
- `await updateDoc()` 직후 `await getDocs(query(...))` 가 server stale snapshot 받을 수 있음
- 클라 측 in-memory `_billings` 는 이미 갱신됐으나 다시 fetch 하면 옛 데이터로 덮음

**원인 3 (진짜) — `closeModal` wrapper 가 단순 정의에 의해 덮어씌워짐**:
- 라인 3134 `_origCloseModal` wrapper (결제 패널 닫을 때 `_renderBillingGrid` 호출) 가 라인 4960 의 단순 `closeModal = () => {...}` 에 의해 덮임
- ES module top-down 실행 → 마지막 등록자만 유효 → wrapper 한 번도 작동 안 함

**3중 fix** ([app.js:_billingPanelDone / _renderBillingGrid / closeModal](public/admin/js/app.js)):
1. **`_billingPending` Set** 도입 + `_billingTrack(promise)` 헬퍼 — `_billingAddItem` / `_billingUpdateItem` / `_billingDeleteItem` 모두 추적. `_billingPanelDone` 이 모든 pending 끝까지 await 후 closeModal
2. **`_renderBillingGrid` 에 `{refetch: false}` 옵션** — 패널 닫을 때 in-memory 캐시만으로 렌더 (Firestore 재query 시 eventual consistency 회피)
3. **라인 4960 `closeModal` 정의 자체에 결제 패널 정리 hook 인라인** — `_billingPanelId !== null` 이면 정리 + render. ✓ 완료 / ✕ 취소 / 바깥 클릭 등 모든 닫기 경로에서 작동

### 3) 부수 변경

- **scores.mode 마이그레이션 추가 (오늘 두 번째)** 없음. 이미 오전에 완료
- **alert 안내문 정리** — SSR 로 학원명 자동이라 "input 학원명 직접 수정" 안내 제거. iOS alert 에 "[더 보기] 눌러주세요" 안내 추가 (공유 시트에서 [홈화면 추가] 안 보일 때)
- **rename 이력**: `public/index.html` / `public/admin/index.html` 가 사라지고 `_app.html` 로. 외부 참조 (SW APP_SHELL, manifest start_url 등) 영향 없음 — vercel.json rewrites 로 `/` 와 `/index.html` 모두 SSR API 로 라우팅됨

### 작업 규칙 추가 (2026-05-08 밤)

신규:
- **iOS Safari [홈화면 추가] 다이얼로그는 manifest.name 을 우선 사용** — 정적 HTML `<title>` / 메타가 아님. 첫 페이지 로드 시점의 manifest URL 이 학원별이어야 학원명 노출. JS 로 link.href 변경한 후의 manifest 응답은 무시.
- **HTTP 헤더 값은 ASCII 만** — 한글 학원명을 `X-Sw-Academy` 같은 헤더에 박으면 'Invalid character in header content' throw. URL encode 또는 헤더 자체 제거.
- **`closeModal` 같은 글로벌 함수 wrapper 패턴 주의** — wrapper 등록 후 단순 정의가 다시 등록되면 wrapper 무효. ES module top-down 실행에서 마지막 등록자만 유효. 충돌 가능성 있으면 정의에 인라인 hook 추가가 안전.
- **Firestore eventual consistency** — `await updateDoc()` 직후 `await getDocs(query)` 는 stale snapshot 가능. 즉시 화면 갱신은 in-memory 캐시 활용 (fetch 생략 옵션).
- **Vercel rewrites 의 정적 파일 우선 동작 우회** — `/` 요청 시 정적 `/index.html` 이 있으면 정적 파일 응답 (rewrites 안 통함). SSR 도입 시 `index.html` → `_app.html` rename 필수.

---

## 파일 크기 / SW 캐시 (2026-05-08 밤)
- `api/render-index.js`: ~140줄 신규
- `api/render-admin.js`: ~140줄 신규
- `public/_app.html` (rename from index.html): 변동 없음
- `public/admin/_app.html` (rename): 변동 없음
- `vercel.json`: rewrites 4줄 추가/변경
- `public/sw.js`: APP_SHELL `/`, `/index.html` 제거. v337 → v365
- `scripts/diag/dump-default-academy.js`: 신규 진단 도구
- `docs/ios-pwa-academy-name-handoff.md`: 핸드오프 문서 (작업 끝나면 archive 또는 결과 추가)

## 진행률 갱신 (2026-05-08 밤)
- 화이트라벨 브랜딩: **~100%** (Phase A·B·C·D 완료 + iOS PWA 학원명 자동 노출 SSR 도입)
- 결제 v2: ~96% (즉시 반영 fix 추가)
- 멀티테넌시 인프라: ~98% (변동 없음)
- super_admin 앱: ~98% (변동 없음)
- 시험관리 운영: ~98% (변동 없음)
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-08 밤 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관·개인정보 / 결제 PG 연동
2. **학원장 대시보드 큰 달력** ([docs/dashboard-cards-handoff.md](docs/dashboard-cards-handoff.md))
3. **자동 로그아웃 후 학원 색 유지** — localStorage academyId 저장 → redirect 시 `/?academy=xxx`
4. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
5. **super_admin defaultAppName 정정** — 'L E X I A I' → 'LexiAI' (사용자 직접, super 앱)
6. **`_modeOldValue` 백업 필드 정리** (선택)

**완료 (이 세션 밤, 2026-05-08)**:
- ✅ iOS PWA 학원명 자동 노출 — SSR 도입 (Phase 1 학생 + Phase 2 학원장)
- ✅ 결제 패널 항목 입력 즉시 반영 (3중 fix: pending 추적 + refetch:false + closeModal hook 인라인)
- ✅ scores.mode 옛 단어시험 키 마이그레이션 (mixed/meaning/spelling → vocab, 36건)
- ✅ alert 안내문 정리 (학원명 직접 수정 제거 + iOS '더 보기' 안내)
- ✅ Vercel Pro 전환 — 함수 한도 회복

---

## 2026-05-09: 단어시험 스펠링 채점 인지 함정 fix + 박스 높이

당일 SW v365 → v367 (3 commit). 학원장이 "정답 입력했는데 알파벳 한 개가 오답 처리됨" 보고 → 진단 → 코드 인지 함정 발견 → fix.

### 1) 보고된 사례
- default 학원, '26마더텅 중 1 ch9 Words' 문제 세트
- '위에' / 'on top of' — 'n' 박스 빨강
- '질서 있게' / 'in an orderly fashion' — 'orderly' 의 'r' 박스 빨강
- 학원장 스크린샷 두 장: 빨간 박스 외 나머지 모두 초록 (정답)

### 2) 진단 (문제 없음 확인)
- [scripts/diag/inspect-vocab-chars.js](scripts/diag/inspect-vocab-chars.js) — `q.word` 데이터 char 단위 dump. 두 단어 모두 순수 ASCII. NBSP / zero-width / 좁은 공백 0개
- [scripts/diag/inspect-vocab-submissions.js](scripts/diag/inspect-vocab-submissions.js) — `userCompleted/{uid}.answers[i].input` 학생 응시 답안 dump. mismatch 0건
- 단, **userCompleted 는 통과 응시만 questions/answers 저장** (CLAUDE.md 작업 규칙 7) — 미통과 응시는 Firestore에 안 남아 직접 검증 불가

### 3) 진짜 원인 — 결과 박스 코드의 인지 함정
[public/js/app.js _vqRenderSpellFeedback](public/js/app.js):
```js
const showCh = isCorrect || match ? (userCh || correctCh) : correctCh;
```
mismatch 박스에 **항상 정답 글자**(`correctCh`) 표시. 학생이 빈 칸 또는 다른 글자를 친 경우에도 박스에는 정답 글자만 보임 → 학원장/학생 입장 "정답 입력했는데 빨강" 으로 인식.

스크린샷의 빨간 박스에 보이는 'n' / 'r' 은 **학생이 친 글자가 아니라 정답 글자**. 코드가 학생 raw input 을 시각적으로 안 보여줘서 진짜 입력값을 알 길이 없음.

### 4) Fix — 결과 박스 + 채점 정규화
**결과 박스 표시 변경**:
- mismatch 박스: 학생이 실제 친 글자 (`userCh`) 표시. 빈 입력은 `_`
- mismatch 박스 하단: 작은 회색 `→정답글자` (정답 비교 가능)
- 코드: `mainCh = match ? userCh : (userCh || '_')` + `subCh = (!match && userCh) ? correctCh : ''`

**정규화 헬퍼 추가** ([public/js/app.js _vqNormStr / _vqNormCh](public/js/app.js)):
```js
function _vqNormStr(s) {
  return String(s||'').normalize('NFKC')
    .replace(/[NBSP/U+2009/U+202F]/g,' ')   // 좁은 공백류 → 일반 공백
    .replace(/[U+200B-U+200D/U+FEFF]/g,'')   // zero-width 제거
    .replace(/\s+/g,' ').trim().toLowerCase();
}
function _vqNormCh(ch) { /* 길이 유지 per-char 비교용 */ }
```

**4곳 비교 로직 통일**:
- `_vqIsAnsCorrect` (정답 판정)
- `_vqSubmit` (점수 집계) — `_vqIsAnsCorrect` 호출로 단순화
- `_vqRenderSpellFeedback` (per-char 박스 색)
- `_vqBuildDetail` (결과 detail 모달)

### 5) 박스 높이 +10px
- 입력 박스 + 결과 박스 둘 다: `height = boxW+8` → `boxW+18`
- 작은 박스 34→44 / 중간 38→48 / 큰 박스 42→52 px
- 폭/폰트는 그대로

### 6) 영향 범위 (사용자 확인용)
- ✅ 시험 내용 (`genTests` / `genQuestionSets`) — 변동 없음
- ✅ 이미 저장된 점수 (`scores`) — 변동 없음
- ⚠ 다음 응시부터 새 채점 적용 — 정규화 강화로 NBSP 데이터 들어와도 정답 처리
- ⚠ 결과 화면 다시 보기 — 새 박스 표시 (학생 raw input + 정답 작게)

### 7) 다음 응시 시 진짜 원인 즉시 진단 가능
빨간 박스에 학생이 친 글자가 그대로 보이므로:
- 빈 박스 (`_`) 면 → 미입력 (모바일 터치 누락)
- 다른 글자면 → 옆 키 / 모바일 IME 자동수정
- 정답 글자면 → 데이터 hidden char (정규화로 이미 자동 처리되지만 추가 케이스 발견 시)

---

## 작업 규칙 추가 (2026-05-09)

신규:
- **결과 화면 박스에는 정답이 아닌 학생 raw input 표시** — `showCh = isCorrect||match ? (userCh||correctCh) : correctCh` 같이 mismatch 시 정답 글자만 보여주면 사용자/학생이 자기가 친 글자라 인식. 빨간 배경 + 학생 입력 + (필요 시) 정답 작은 회색 패턴 사용.
- **`userCompleted` 진단 한계** — 통과 응시만 questions/answers 스냅샷 저장 (CLAUDE.md 규칙 7). 미통과 사례 분석 시 Firestore에 데이터 없으니 화면 측 fix (학생 raw input 표시) 가 우선.
- **스펠링 채점 정규화 표준** — `String.normalize('NFKC')` + NBSP/U+2009/U+202F → space + zero-width 제거 + collapse spaces + lowercase + trim. per-char 비교용은 길이 유지 버전 별도 (`_vqNormCh`). 미래 OCR/AI/clipboard 데이터 hidden char 안전망.

---

## 파일 크기 / SW 캐시 (2026-05-09)
- `public/js/app.js`: ~4925줄 (+25, _vqNormStr/_vqNormCh + 결과 박스 변경)
- 신규 진단: `scripts/diag/inspect-vocab-chars.js` / `scripts/diag/inspect-vocab-submissions.js`
- SW 캐시: `kunsori-v367`

## 진행률 (2026-05-09)
- 단어시험 채점 견고성: **~100%** (인지 함정 + 정규화 + 박스 높이)
- 화이트라벨 브랜딩: ~100% (변동 없음)
- 결제 v2: ~96% (변동 없음)
- 멀티테넌시 인프라: ~98% (변동 없음)
- super_admin 앱: ~98% (변동 없음)
- Phase 5 출시 준비: 0%

**완료 (이 세션, 2026-05-09)**:
- ✅ 단어시험 스펠링 결과 박스 — 학생 raw input 표시 (mismatch 시 정답 글자 → 학생 친 글자로)
- ✅ 빈 입력 박스 `_` 표시 + 박스 하단 작은 회색 `→정답글자`
- ✅ 채점 정규화 헬퍼 (_vqNormStr / _vqNormCh) — NFKC + NBSP/zero-width 처리
- ✅ 4곳 비교 로직 통일 (정답 판정·점수 집계·박스 색·detail)
- ✅ 박스 높이 +10px (입력 + 결과 양쪽)
- ✅ 진단 스크립트 2개 (vocab chars / submissions)

---

## 2026-05-09 (이어서): 알림 줄바꿈 + 학생관리 수강정보 + 엑셀 양식 통일 + 결제 마법사 '말일' 버그

당일 SW v367 → v373 (~7 commit). 학생관리에 결제 v2 의 수강료·납부일 표시 통합 + 엑셀 라운드트립 양식 통일 + 결제 마법사 '말일' 버그 fix 등 운영 정비.

### 1) 학생앱 알림함 메시지 줄바꿈 표시 (commit `9a79285`)
[loadMessages](public/js/app.js#L4853) 알림 패널 행의 body div 에 `white-space: pre-wrap` + `word-break: break-word` 누락. esc() 가 `\n` 그대로 출력해도 CSS 기본값 (normal) 이 collapse → 한 줄로 보임. 해결: 행 안 body div 에 두 속성 추가. 알림 모달 (notifModalBody) 은 이미 적용되어 있어 그대로.

옛 메시지도 같이 적용됨 — body 텍스트는 Firestore 그대로, 표시만 변경.

### 2) 학생관리 표에 수강료·납부일 컬럼 + 가림 토글 (commit `dc3e98c`, `89b7ce6`)

**컬럼 추가** (재원/휴원/퇴원 모두 동일):
- 표 맨 끝 위치 (등록일·휴원일·퇴원일 뒤로)
- 형식: `200,000` (숫자, 콤마 구분, '원' 빼고) / `5일` / `말일` / `학원기본`
- 학생 수정 모달 select 라벨과 완전 일치

**가림 토글** ([_tuitionVisible](public/admin/js/app.js#L1271-L1286)):
- 재원/휴원/퇴원 페이지 셋 다 우상단 [💰 수강정보 보기] / [🙈 수강정보 가리기] 버튼
- 기본 가림 (`***`), 클릭 시 노출. 페이지 새로고침 시 자동 가림 (모듈 변수 초기화)
- 모듈 전역 변수 — 셋 페이지가 같은 상태 공유. 동일 id `tuitionToggleBtn` 3개에 querySelectorAll 로 라벨 동기화
- 옵션 A 채택 (B/C/D 검토 후) — localStorage 저장 X (지나가다 누가 보는 문제 회피)

**표시 헬퍼** (`_tuitionCells`):
- amt = 0 → '-' (자동 청구 미설정)
- dueDay = -1 → '말일'
- dueDay = 0 또는 미설정 → '학원기본'
- 1~31 → 'N일'
- 가림 시 모두 `***`

### 3) 엑셀 샘플·import·export 양식 통일 (commit `dc3e98c`, `240209f`, `f862b45`)

이전 상태 — 샘플(9컬럼) / import(11컬럼) / export(13컬럼, 'No' + '반' 우선) 가 제각각 → 학원장이 export 받은 파일 그대로 import 못함.

**통일 양식 (import 기준 11 컬럼)**:
| 열 | 항목 |
|---|------|
| A | 아이디 * |
| B | 이름 * |
| C | 반 |
| D | 생일 |
| E | 학교 |
| F | 학년 |
| G | 연락처 |
| H | 부모님성함 |
| I | 부모님연락처 |
| J | 수강료 (숫자, 빈값 OK) |
| K | 납부일 |
| (L+) | 참고용 — 등록일 / 휴원일 / 퇴원일 (import 시 무시) |

**import 받아들이는 납부일 형식** (사용자 어떻게 입력하든 OK):
- 숫자 (`5`)
- 한글 단위 (`5일`)
- `말일` / `-1`
- `학원기본` / `학원 기본값`
- 빈값 (= 학원 기본값)

**export 표시·샘플** — 학생 모달 select 라벨과 완전 일치 (`5일` / `말일` / `학원기본`). 빈 셀은 자동 청구 미설정.

**휴원/퇴원 export 도 풀 컬럼** (반·연락처·부모님 등) — 휴원/퇴원생 데이터 엑셀 편집 후 재원생으로 import 라운드트립 가능.

### 4) 결제 마법사 '말일' 저장 안 되던 버그 (commit `24c46b6`) ⭐
**진짜 원인**: [_renderWizardStep1](public/admin/js/app.js#L3343) 의 select 첫 옵션이 `<option value="0">말일</option>` — value=0 인데 라벨 "말일" 충돌. 사용자가 "말일" 선택해도 `dueDay=0` 저장됨. 이후 `0 || 15` 함정 (`_ensureCurrentMonthBillings` 의 `_billingSettings?.defaultDueDay || 15`) 으로 매월 15일에 청구서 생성.

학생 수정 모달은 `value="-1"=말일` 정상이라 학생 단위 "말일" 은 OK. 학원 단위 default 만 깨져있던 비대칭 버그.

**수정 (5곳)**:
1. `_renderWizardStep1`: select 첫 옵션 `value="-1"` + selected 처리
2. `openPaymentSettingsWizard` prefill: `|| 15` → `isFinite(eDD) && (eDD === -1 || (eDD >= 1 && eDD <= 31)) ? eDD : 15`
3. saveSettings (라인 3520): defaultDueDay 저장 시 동일 검증 — `-1` 유효
4. `_ensureCurrentMonthBillings` (3259): defaultDueDay fallback 안전화
5. `_syncCurrentMonthBilling` (5999): 동일

**옛 데이터 (defaultDueDay=0)** 자동 마이그레이션 안 함 — 학원장이 설정 다시 열어 "말일" 재선택 + 저장하면 -1 로 갱신. 안전 운영 전략.

---

## 작업 규칙 추가 (2026-05-09 이어서)

신규:
- **`white-space: pre-wrap`** 은 사용자 입력 텍스트 (메시지 본문, 메모 등) 표시 div 에 필수. esc() 만으로는 `\n` 이 visible 줄바꿈으로 표시 안 됨. CSS 기본값 (normal) 이 공백·줄바꿈 collapse.
- **민감 정보 가림 토글 패턴** — 모듈 전역 변수 + 우상단 토글 버튼 + querySelectorAll 로 여러 페이지 라벨 동기화. localStorage 저장 X (지나가다 노출 회피). 페이지 새로고침 = 자동 가림.
- **엑셀 라운드트립 양식 통일** — 샘플·import·export 컬럼 순서·라벨 동일. 참고용 컬럼 (등록일·상태일 등) 은 끝에 두고 import 시 무시. 사용자가 export 받은 파일을 그대로 수정해서 재 import 가능해야 함.
- **`X || fallback` 함정 — 0 도 의미 있는 값일 때** — `|| 15` 가 `0` (의도된 0 또는 옛 잘못된 0) 을 fallback 으로 덮어쓰면 디버깅 어려움. `isFinite(x) + 범위 체크` 패턴 권장. 특히 select option value 와 의미값 매핑 일관성 필수 (학원 마법사 vs 학생 모달 dueDay 충돌이 표본 — `value="-1"=말일` 통일).
- **select option `value` 와 의미값 매핑 일관성** — 같은 도메인 (예: 납부일) 에서 여러 화면 간 매핑 다르면 한 쪽 저장값을 다른 쪽이 오해석. 모든 화면이 동일 mapping 사용해야 (`-1`=말일, `0`=학원기본, `1~31`=일).

---

## 파일 크기 / SW 캐시 (2026-05-09 이어서)
- `public/admin/js/app.js`: ~13050줄 (+~80, 학생관리 컬럼·토글·엑셀 통일·말일 버그 fix)
- `public/admin/_app.html`: 학생관리 헤더 + 안내문 갱신
- `public/js/app.js`: 알림 줄바꿈 1줄 변경
- SW 캐시: `kunsori-v373`

## 진행률 (2026-05-09 이어서)
- 단어시험 채점 견고성: ~100% (변동 없음)
- 결제 v2: ~96% → **~98%** (학원 default '말일' 버그 fix + 학생관리 통합)
- 학생관리 운영: ~95% → **~98%** (수강료 가림 토글 + 엑셀 라운드트립)
- 화이트라벨 브랜딩·멀티테넌시·super_admin: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-09 이어서 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
2. **PWA [홈화면 추가] 학원명 노출** — manifest·메타 시도 다 안 통함, 사용자가 input 직접 수정 안내 (alert 에 적용 완료). SSR 도입은 부담 큼 — 보류
3. **학원장 대시보드 달력 보강** — 생일 카테고리 추가 (`users.birth` 입력 강화 + 4번째 점 색)
4. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))

**완료 (이 세션 이어서, 2026-05-09)**:
- ✅ 학생앱 알림함 줄바꿈 표시 (white-space:pre-wrap)
- ✅ 학생관리 표 수강료·납부일 컬럼 + 가림 토글 (재원/휴원/퇴원 모두)
- ✅ 엑셀 샘플·import·export 양식 통일 (라운드트립 가능)
- ✅ 납부일 형식 학생 모달 select 라벨과 통일 (5일 / 말일 / 학원기본)
- ✅ 결제 마법사 '말일' value=0 vs -1 충돌 fix (5곳)
- ✅ PWA 홈화면 추가 학원명 alert 안내문 (input 직접 수정 가이드)

---

## 2026-05-10: 단어 말하기 시험 동음이의어 자동 처리 (cereal/serial)

당일 SW v376 → v377 (1 commit). Web Speech API 의 동음이의어 인식 한계 (cereal 을 정확히 발음해도 `serial` 로 들림) 해결. Metaphone 알고리즘 검토 후 폐기 → AI 기반 사전 등록 채택.

### 1) 보고된 증상 + 베타 데이터 진단
학원장 보고: "너그러움" 엄격도여도 cereal 같은 단어는 학생이 어떻게 발음해도 오답 처리. 다른 단어도 비슷한 케이스 있을 것 같음.

신규 진단 도구 [scripts/diag/analyze-speaking-errors.js](scripts/diag/analyze-speaking-errors.js):
- `genTests` 중 `vocabOptions.format='speaking'` 시험 스캔 → `userCompleted/{uid}.answers[]` 추출
- 단어별 오답 횟수 + 학생이 들린 단어 (`spkHeard`) 빈도 카운팅
- 동음이의어 후보 자동 탐지: 들린 단어가 정답 오답의 50% 이상 같은 단어로 인식되면 의심

베타 결과:
- **piece/peace** 2/2 (100% 일관 — 완벽한 동음이의어)
- soar / weird / be served — 2~4건 오답이지만 들린 단어 다양 (Web Speech API 의 일반적 인식 오류)
- 전체 오답률 ~20% — 임계값 문제가 아닌 발음 인식 한계 영역

### 2) 설계 비교 — Metaphone vs AI 동음이의어
| | Metaphone | AI 동음이의어 (채택) |
|---|-----------|---------------------|
| 방식 | 자음 추출 알고리즘 | AI 가 단어별 사전 등록 |
| 범위 | **모든 단어** 자동 적용 | **등록된 쌍만** 매칭 |
| cereal/serial | ✅ 통과 | ✅ 통과 |
| **cat/cot** | ❌ 둘 다 KT → 잘못 통과 | ✅ 등록 안 됨 → 오답 (정상) |
| **mat/mate** | ❌ 둘 다 MT → 잘못 통과 | ✅ 오답 (정상) |
| **bit/beat** | ❌ 둘 다 BT → 잘못 통과 | ✅ 오답 (정상) |

핵심 차이: Metaphone 은 **폭넓고·거침** (false positive 다발). AI 동음이의어는 **좁고·정밀** (의미 인지). 1차 목표(단어 지식 평가) 를 깨뜨리지 않으면서 발음 인식 한계만 보정.

사용자 결정: false positive 회피 우선 → AI 동음이의어. UI/인쇄/단어장에 노출 X (말하기 모드 채점에서만 사용) — 학습자 혼란 방지.

### 3) 구현 — 3개 파일

**[api/generate-quiz.js](api/generate-quiz.js)**
- `typeInstructions.vocab` 에 homophones 지시 추가 (true homophone 만, cat/cot 같은 false positive 명시 차단)
- `validateVocab` 가 homophones 정규화 (lowercase·trim·dedupe·max 5개·자기자신 제외)
- POST handler 에 `mode: 'homophones-only'` 분기 신설 + `HOMOPHONES_PROMPT` 상수 + `handleHomophonesOnly` 헬퍼
- **`appConfig/aiPrompts.vocab` (super_admin 편집) 손대지 않음** — typeInstructions·validator 단계에서 처리. 학원장이 vocab 프롬프트 편집해도 homophones 자동 생성됨

**[public/admin/js/app.js qgRunWordsnap](public/admin/js/app.js)**
- 클립보드 파싱 후 → AI 호출 1회 (`mode: 'homophones-only'`, words 만 보냄) → questions 채워서 Firestore 저장
- AI 실패 시 빈 배열 fallback (저장 흐름 안 끊음)
- 토스트에 동음이의어 건수 표시
- 토큰: 정상 vocab 호출의 1/10 수준 (문제 생성 X, 단어 리스트만)

**[public/js/app.js _spkGradeAnswer](public/js/app.js)**
- 시그니처에 `homophones` 추가 (4번째 인자)
- 정답 후보 = `[정답, ...homophones]` 모두에 대해 매칭 시도
- `viaHomophone` 플래그 반환 (디버깅 가능)
- 호출부 `q.homophones` 전달

### 4) 적용 시점 + 비용 모델
- **세트 생성 시점에 1회 AI 호출** → 그 세트로 시험 100번 출제해도 추가 비용 0
- **출제 시 AI 의존도 0** (네트워크/할당량 영향 없음)
- 시험 배정 → genTests 복사 시 homophones 따라옴
- **기존 단어 세트는 영향 없음** (homophones 필드 없으면 빈 배열 fallback → 기존 동작 그대로). 적용하려면 새로 만들어야

---

## 작업 규칙 추가 (2026-05-10)

신규:
- **AI 기반 사전 등록 vs 알고리즘 기반 처리 — false positive 회피 우선** — Metaphone·Soundex 같은 폭넓은 알고리즘은 false positive 가 학습 효과를 깨뜨림 (cat/cot 같이 다른 단어를 같다고 처리). 의미 인지가 필요한 도메인 (단어 지식 평가 등) 에선 AI 기반 사전 등록이 정확. 학습자가 직접 검토·편집 가능한 점도 장점.
- **노이즈 데이터는 채점 데이터 (질) 가 아니라 인식 시스템 한계 (양)** — 임계값 (similarityThreshold) 으로 풀려 하지 말고 도메인 사전 (homophones) 으로 풀기. 베타 데이터 분석으로 노이즈 패턴 분류 후 결정.
- **세트 단위 사전 처리 vs 출제 단위 즉석 처리** — 비용·일관성 측면에서 세트 생성 시 1회 처리가 우선. 출제는 횟수 많고 시점이 학생 기다리는 critical path. 단, 기존 데이터엔 적용 안 되는 trade-off 명시 필요 — 사용자 결정 (a) 새로 만들기 / (b) 일괄 채우기 버튼 추가 중 선택.

---

## 파일 크기 / SW 캐시 (2026-05-10)
- `api/generate-quiz.js`: ~1290줄 (+~135, mode='homophones-only' 분기 + HOMOPHONES_PROMPT + handleHomophonesOnly + typeInstructions.vocab 확장 + validateVocab 정규화)
- `public/admin/js/app.js`: ~13070줄 (+~30, qgRunWordsnap AI 호출 추가)
- `public/js/app.js`: ~4940줄 (+~15, _spkGradeAnswer 시그니처 확장 + 정답 후보 루프)
- 신규 진단: `scripts/diag/analyze-speaking-errors.js` / `scripts/diag/dump-speaking-completion.js`
- SW 캐시: `kunsori-v377`

## 진행률 (2026-05-10)
- **단어 말하기 시험: ~100% → 동음이의어 보강 (변동 없음)**
- 단어시험 채점 견고성: ~100% (변동 없음)
- 결제 v2: ~98% (변동 없음)
- 학생관리 운영: ~98% (변동 없음)
- 화이트라벨 브랜딩·멀티테넌시·super_admin: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-10 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
2. **학원장 대시보드 달력 보강** — 생일 카테고리 추가 (`users.birth` 입력 강화)
3. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
4. **(선택) 동음이의어 일괄 채우기 버튼** — 기존 단어 세트에 적용. 베타 운영 후 빈도 보고 결정

**완료 (이 세션, 2026-05-10)**:
- ✅ 단어 말하기 시험 동음이의어 자동 처리 (AI Generator + Wordsnap 양쪽)
- ✅ Metaphone vs AI 동음이의어 비교 분석 + AI 채택 (false positive 회피)
- ✅ 베타 데이터 분석 도구 신규 (analyze-speaking-errors.js)
- ✅ `_spkGradeAnswer` 정답 후보 [정답 + homophones] 루프 매칭
- ✅ super_admin 편집 vocab 프롬프트 보존 (typeInstructions 단계 처리)

---

## 2026-05-10 (이어서): 녹음숙제 회차별 표시 + 학생 통과/불통 단순화 + 발음 피드백 강화 + 말하기 detail fix

당일 SW v377 → v379 (2 commit). 녹음숙제 베타 진단 → 사용자 결정 3건 + 말하기 시험 베타 fix 3건.

### 1) 녹음숙제 — 회차별 audio + 미통과 AI 피드백 + 학생 단순화 (commit `6a538cb`, SW v378)

**사용자 결정 3건** 묶음 처리:

| 항목 | 결정 | 변경 |
|------|------|------|
| 회차별 표시 | B (audio 모두) | 모든 라운드 Storage 업로드 (이전엔 마지막만) |
| 발음 피드백 | B (행동 지시) | check-recording.js 프롬프트 강화 |
| 점수 표시 | 학생만 단순화 | 학생 ✅통과/❌미통과 28px만, 학원장은 점수 그대로 |

**[_rv2Submit](public/js/app.js) 변경**:
- `for` 루프로 모든 `_rv2.savedRounds[i]` Storage 업로드
- path 패턴: `recordings/genTests/{testId}/{uid}/round{N}_{ts}_{i}.{ext}`
- recordingsDetail = `[{round, audioUrl, duration, voiceActivity}, ...]`, 마지막 회차에만 score/missedWords/note/feedback 추가
- AI 호출은 마지막 1회 (정책 그대로 — 비용·일관성)
- Storage 비용 N배 (최대 4배) 감수 — 학원장 진단 가치 우선

**미통과 분기 강화** (이전 합의 묶음):
- 이전: `scores.recordings=[]` 빈 배열, `userCompleted` 에 `latestFailedScore` 만
- 변경: 통과와 동일하게 `scores.recordings + userCompleted.recordings` 저장 (audio + AI feedback)
- **옛 마커 cleanup** — 통과/미통과 시 `latestErrorStage`/`latestErrorMessage`/`latestAttemptAt`/`latestFailedScore`/`latestFailedAt` 등 `null` 셋팅 (분기 충돌 방지)
- '에러 → 미통과' 케이스 빨간 카드 잘못 표시 fix

**학원장 카드 분기 변경** (`tpToggleTestProgress` line 12657):
- 우선순위: `completedAt` 통과 > `latestFailedAt+recs` 미통과 > `latestFailedScore` 옛 데이터 > `latestErrorStage` 에러 > 대기
- 통과/미통과 공통 큰 카드 (회차별 audio 플레이어 N개 + 성실도% + 마지막 점수 배지 + AI 피드백 details)
- 노란 테두리/배경으로 미통과 시각 구분

**학생앱 결과 화면** (`_rv2RenderResult`):
- 점수 grid (32px 큰 박스) 폐기
- "✅ 통과" / "❌ 미통과" 28px 헤드라인만
- 점수 학생에게 노출 X (학원장만 점수 봄)

**AI 발음 피드백 프롬프트 강화** (`api/check-recording.js buildEvalPrompt`):
- 문제: `weakPronunciation.issue` 가 한국어 음역만 적던 케이스 (예: "유진처럼 발음했어요. '유진'에 가깝게" — 학생 행동 지시 0)
- CRITICAL 규칙 추가:
  · 한국어 음역 단독 금지
  · 강세·자음·모음·길이·혀 위치 등 구체적 행동 지시 필수
  · IPA 표기 권장 (`[ˈjuːdʒiːn]`)
  · GOOD/BAD 예시 명시
  · 유용한 지시 못 만들면 weakPronunciation 비우기 (모호한 피드백 X)

### 2) 말하기 시험 베타 fix 3종 (commit `5de29ae`, SW v379)

사용자 보고: "piece 가 너그러움에서도 peace 로 들리면 오답 / 4회 진행 / 결과 내답 빈칸"

**Fix A — 학원장 detail 말하기 분기 추가 (확정 버그)**:
- `_adminVocabBuildDetail` (admin/app.js line 4210) 가 `a.format='speaking'` 분기 누락
- 말하기 모드는 `ans.input` 이 정답 시 `q.word`, 오답 시 빈 문자열이라 표시 부적절
- 학원장은 항상 '내답: (미입력)' 만 봄 → spkHeard 노출 안 됨
- 학생앱과 동일 분기 추가 — `들린 단어: "peace"` 표시
- `isCorrect` 는 `a.spkCorrect` 로 판정 (input 신뢰 X)
- 형식 라벨 '🎤 말하기' 추가
- **🔊 동음이의어 매칭** 보라 배지 추가 (heard != q.word 이지만 spkCorrect=true 인 경우)

**Fix B — vqSpkStart 안전 가드** (4회 진행 edge case):
- 정상 흐름은 attempt=2 도달 시 finalize. `rec.start()` 실패 등 edge case 시 무한 시도 가능
- 추가:
  · 시작 시 `attempt >= 2` 면 즉시 `_vqSpkFinalize(false, lastHeard)`
  · `onresult` 시 `s.spk.lastHeard` 캐시 (가드 발동 시 사용)
  · `rec.start()` 실패 시 `attempt -= 1` 롤백 (진짜 시도 못 했으니)
- 정상 시나리오엔 영향 X

**Fix C — 동음이의어 진단 스크립트** (`scripts/diag/dump-homophones.js`):
- vocab 세트의 `homophones` 채움 현황 dump
- `--word=piece` 로 특정 단어 어느 세트에 있는지 검색
- `--academy` 필터, `--missing-only` 필터
- **진단 결과**: 32 세트 모두 0% 커버리지 (동음이의어 작업 이후 새로 만든 세트 0건)
  → 사용자가 piece 테스트한 세트는 옛 세트, 정책대로 적용 안 됨이 정상
  → 새 세트 만들어 검증 필요 (옵션 a 결정대로)

### 3) 그 외 토론·진단

- **503 UNAVAILABLE 에러 분석** — 녹음숙제 컴플레인 (학생 끊김) 직접 관련 가능성. 폴백 체인 (2.5-flash-lite → 2.5-flash → 3.1-flash-lite-preview) 누적 시간 ~36s 가 클라 30s timeout 과 충돌. A+B+C+D (이전 세션) 로 데이터 보존되지만 학생 경험은 동일. 베타 누적 후 클라 timeout 확대 또는 안내 토스트 검토
- **403 Forbidden 가능 원인** — API 키 권한·IP 제한·preview 모델 권한·결제 정지. 의심 1순위 IP 제한 (Vercel 서버 IP 다양). 폴백 정책상 첫 모델 403 시 즉시 502 (모델별 권한 다를 수 있는데 폴백 안 함)
- **AI 평가 실패율 리포트 위치** — SuperAdmin Phase B T9 (Cloud Function 일일 집계 필요). 현 인프라는 시도 기준 카운터만 → 성공/실패 분리 불가. 베타 후 묶음 작업 권장
- **DEP0169 url.parse 경고** — 외부 라이브러리 (firebase-admin·sharp 등) 의 deprecated API. 우리 코드 X (grep 0건). 무해 — CVE 발급 안 됨

---

## 작업 규칙 추가 (2026-05-10 이어서)

신규:
- **녹음숙제 회차별 audio 보관 정책** — 모든 라운드 Storage 업로드 (이전 "마지막만" 정책 폐기). 학원장 진단 가치 > Storage 비용. AI 평가는 여전히 마지막 1회만 (비용·일관성). path 패턴 `recordings/genTests/{testId}/{uid}/round{N}_{ts}_{i}.{ext}` 로 회차 식별 가능.
- **userCompleted 마커 cleanup 필수** — `setDoc({...}, {merge:true})` 라 옛 필드 안 지워짐. 통과/미통과 새 응시 시 옛 `latestErrorStage`/`latestFailedScore` 등 `null` 셋팅 필수. 안 하면 분기 우선순위 충돌로 잘못된 카드 표시 (예: '에러 → 미통과' → 빨간 에러 카드 오표시).
- **말하기 모드 채점 결과 표시는 spkHeard 사용, 통과 판정은 spkCorrect 사용** — `ans.input` 은 신뢰 불가 (정답 시 `q.word`, 오답 시 빈 문자열). 학생앱·학원장 detail 모두 같은 패턴이어야 함. 학원장 detail 말하기 분기 누락은 표본 버그.
- **AI 발음 피드백 프롬프트 — 한국어 음역 단독 금지** — `weakPronunciation.issue` 에 "유진처럼 발음" 같은 음역만 적으면 학생이 무엇을 고쳐야 할지 모름. IPA + 강세·자음·모음·혀 위치 등 구체적 행동 지시 필수. 유용한 지시 못 만들면 빈 배열 반환 (모호한 피드백 X).
- **edge case 무한 시도 안전 가드** — `vqSpkStart` 같이 사용자가 반복 누를 수 있는 핸들러는 시작 시 attempt 가드 + 실패 시 카운트 롤백. 정상 시나리오엔 영향 없도록 보수적으로.
- **세트 단위 사전 처리 데이터의 검증 — 진단 스크립트 우선** — 동음이의어처럼 세트 생성 시 채워지는 데이터는 베타 운영 시작 시점에 진단 스크립트 (dump-homophones.js 같은) 부터 만들어 커버리지 확인. 사용자 보고 받기 전에 본인이 세트 만들었는지 의심.

---

## 파일 크기 / SW 캐시 (2026-05-10 이어서)
- `public/js/app.js`: ~5000줄 (+50, _rv2Submit 회차별 + cleanup + 결과 단순화 + vqSpkStart 가드)
- `public/admin/js/app.js`: ~13130줄 (+50, 카드 분기 + _adminVocabBuildDetail 말하기 분기)
- `api/check-recording.js`: +20줄 (발음 피드백 CRITICAL 규칙)
- `scripts/diag/dump-homophones.js`: 신규 ~110줄
- SW 캐시: `kunsori-v379`

## 진행률 (2026-05-10 이어서)
- 단어 말하기 시험: ~100% (변동 없음 — 학원장 detail 표시·가드 보강)
- 녹음숙제 시스템: **~95% → ~98%** (회차별 audio·미통과 AI 피드백·학생 단순화·발음 피드백 강화)
- 단어시험 채점 견고성: ~100% (변동 없음)
- 결제 v2: ~98% (변동 없음)
- 학생관리 운영: ~98% (변동 없음)
- 화이트라벨 브랜딩·멀티테넌시·super_admin: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-10 이어서 갱신)
1. **녹음숙제 사용자 베타 피드백 수렴** — 회차별 audio 재생, AI 발음 피드백 구체성, 학생 통과/불통 단순화, 에러→미통과 cleanup 효과 확인
2. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
3. **학원장 대시보드 달력 보강** — 생일 카테고리 추가 (`users.birth` 입력 강화)
4. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
5. **AI 평가 실패율 (SuperAdmin Phase B T9)** — 베타 30일+ 누적 후 Cloud Function 일일 집계 묶음 작업
6. **(선택) 동음이의어 일괄 채우기 버튼 + 학원장 편집 UI** — 베타 운영 후 빈도 보고 결정. A 진단 / B 보기 / C 편집 묶음

**완료 (이 세션 이어서, 2026-05-10)**:
- ✅ 녹음숙제 회차별 audio 모두 Storage 업로드 + 학원장 카드 표시
- ✅ 미통과 분기 AI 피드백·recordings 저장 (이전엔 빈 배열)
- ✅ userCompleted 옛 마커 cleanup (latestErrorStage·latestFailedScore null 셋팅)
- ✅ 학생앱 결과 화면 통과/불통 단순화 (점수 숨김)
- ✅ AI 발음 피드백 프롬프트 강화 (IPA·강세·자음·구체 행동 지시 필수)
- ✅ 학원장 _adminVocabBuildDetail 말하기 분기 추가 (들린 단어 표시 + 동음이의어 매칭 배지)
- ✅ vqSpkStart 안전 가드 (4회 진행 edge case 차단 + rec.start 실패 시 롤백)
- ✅ 동음이의어 진단 스크립트 dump-homophones.js + 베타 데이터 0% 커버리지 확인

---

## 2026-05-11: 객관식 문법 카테고리 + 학원장 커스텀 프롬프트 Firestore 이전 + UX 정비

당일 SW v379 → v404 (~25 commit). 큰 작업 두 갈래:
1. **객관식 시험에 문법 카테고리 추가** — 본문이해 vs 문법 (subType 분리)
2. **학원장 커스텀 AI 프롬프트 다중 PC 동기화** (localStorage → Firestore)

그 외 다수 UX fix (학생별 카드 클릭, 랭킹 기간 토글, 점수 비공개 정책, 라벨 통일 등).

### 1) 객관식 시험에 문법 카테고리 (commit `4f4a758`, `b02f075`, `7f35747`, `38f6e45`, `c4f8584`, `af60c49`, `b869b44`)

**데이터 모델**: `q.subType: 'content' | 'grammar'` 필드. 세트 단위로 한 종류 (혼합 X). 옛 mcq 데이터는 'content' 폴백.

**Backend ([api/generate-quiz.js](api/generate-quiz.js))**:
- `SYSTEM_PROMPTS.mcq_grammar` 신설 — 시제·관사·전치사·관계절·조건문·수동태 등
- POST handler `subType:'grammar'` 받으면 `promptKey='mcq_grammar'` 사용
- `validateMCQ` 가 `q.subType` 박음
- `appConfig/aiPrompts.mcq_grammar` 키 자동 폴백

**프롬프트 편집 UI** (super_admin + 학원장):
- super 앱 `PROMPT_TYPES` 에 `mcq_grammar` 추가, 라벨 `📖 객관식 (본문이해)` / `📐 객관식 (문법)`
- 학원장 앱 `_qgAiPromptTypes` 에 추가, `_QG_PROMPT_ALIAS_LABELS` 매핑
- super_admin Firestore 미정의 키는 서버 default fetch 로 폴백 (코드 SYSTEM_PROMPTS 보며 편집 가능)

**AI Generator UI**:
- `QG_TYPE_OPTIONS.mcq.label` '내용이해_객관식' → '본문이해·문법_객관식'
- options 에 '문제 종류' select (본문이해 / 문법) 추가
- `_qgCallMcq` 가 subType + customPrompt key 분기
- 문법 선택 시 세트명 default 에 `' · 문법'` suffix

**시험명 옆 배지**:
- `_testNameGrammarBadge(t)` 신설 — testMode='mcq' + first question.subType='grammar' → 보라 `📐 문법`
- `_testNameBadges(t)` 통합 헬퍼 (말하기 + 문법 미래 확장)
- 시험 목록·시험관리·성적 리포트 testName 옆 배지 적용

**학생앱**:
- `_makeTypeCard` mcq 분기에 isGrammar 판정 + `📐 문법` 배지
- 홈 카드 라벨 '교재이해' → '본문이해·문법'

**라벨 통일** (모든 곳 '본문이해' 로):
- '교재이해' / '내용이해' → '본문이해'
- 콤마 → 가운데점 ' · ' → '·' (컴팩트 표기)
- 학원장 사이드바 + page-title + pageLabels + AI Generator 옵션 + 학생앱 카드/타이틀 + growth-report MODE_LABELS

### 2) MCQ 후처리 모듈 (commit `ab5687c`, `bc727e2`)

핸드오프 문서 (다른 LLM 협업 결과) 반영. `api/_lib/quiz-post-process.js` 신설:

**`shouldUseAn(word)`** — vowel sound 판정:
- AN 예외 (자음 글자/모음 소리): `hour, honest, honor, heir, mvp, fbi, x-ray, sos, mri, nba, nfl, sat, fyi`
- A 예외 (모음 글자/자음 소리): `university, uniform, useful, unique, user, usual, utopia, european, europe, one, once, year, young, yellow, yesterday`
- `.startsWith()` 매칭 — derived form (universities, honestly 등) 자동 커버
- 일반 규칙: a/e/i/o/u → an (예외 후), 그 외 자음 → a

**`validateAndFixArticleQuestion(q)`** — q.choices 에 a/an 둘 다 있고 빈칸 다음 단어 판정 가능하면 isAnswer 자동 토글. the/X 정답은 손대지 않음. `_autoFixed: true` 마커.

**`shuffleChoices(q)`** — Fisher-Yates 로 결과 모달 정답 위치 편향 제거. (응시·인쇄 시 또 셔플되지만 무관 — 학원장 검토 시점에 균등 분포 보장.)

**`postProcessMCQ(arr)`** — 보정 → 셔플 순서. `autoFixedCount` 반환.

**`validateMCQ` 직후 호출** — mcq 전체 (subType 무관) 적용. 본문이해도 a/an 정답 묻는 케이스 가능.

**학원장 결과 모달**: status 에 `🔧 N건 자동 보정 (a/an)` 안내 (보정 시만).

**`SYSTEM_PROMPTS.mcq_grammar` 강화**:
- NEW CONTENT (본문 verbatim 금지, 일상 주제로 새 문장)
- SHORT (모바일 친화 — question ≤12 / choices ≤5 / questionKo ≤30자 / explanation ≤60자)
- RANDOM ANSWER POSITION (1~4 균등)
- questionKo Type A/B 분기 (모달·관사 = 한글 번역 포함, 그 외 = 짧은 지시문)
- a/an 규칙 + 예외 단어 명시 (artificial/hour/university/year 등)

**진단 스크립트**: `scripts/diag/test-quiz-post-process.js` — 6 케이스 (artificial/university/hour/the/셔플 분포/잘못된 입력) + 통합 테스트 17/17 통과.

### 3) 학원장 커스텀 AI 프롬프트 Firestore 이전 (commit `d8aebf6`)

**이전**: localStorage `'ai_prompt_custom_*'` — 한 PC 만 적용. 다른 PC 에서 빈 값.

**변경**: `academies/{id}.customPrompts.{type}` Firestore 저장
- 같은 학원장 계정 어느 PC 든 동기화
- 학원 백업에 자동 포함
- localStorage 휘발 (브라우저 캐시 청소) 위험 차단

**구현**:
- `_qgGetCustomPrompt(type)` — `window.MY_CUSTOM_PROMPTS` 메모리 cache 읽기
- `_qgSetCustomPrompt(type, value)` — cache 즉시 갱신 + Firestore updateDoc 비동기 (deleteField 로 빈 값 제거)
- `_loadMyAcademyContext` — academies fetch 시 customPrompts 도 cache 에 로드
- `_migrateLocalStoragePromptsToFirestore` — 진입 시 1회 자동 마이그레이션 (background, 사용자 재편집 불필요)
- import: `deleteField` 추가 (firebase-firestore.js)

**Rules**: academies update 화이트리스트에 `customPrompts` 추가 + `firebase deploy --only firestore:rules` 완료.

**우선순위 (변동 없음)**: 학원장 customPrompts (Firestore) > super_admin appConfig > 코드 SYSTEM_PROMPTS.

### 4) MCQ 셔플 mismatch fix (commit `0ee3d88`)

응시 시 매번 `q.choices` 셔플. `_writeUserCompleted` 가 셔플된 questions 를 `comp.questions` 에 저장. 그러나 다시 보기 (`mcqViewPreviousResult`) 가 `test.questions` (원본) 사용 → 셔플 mismatch → 학생이 ② 골랐는데 원본 ② 위치 다른 보기 → 오답 표시.

**fix**: `comp.questions` 우선, 없으면 `test.questions` 폴백.

### 5) 학생별 카드 클릭 → 상세 모달 (commit `92cab86`, `2e159a1`)

**신규 함수**: `tpOpenStudentScoreDetail(testId, uid)`
- scores 에서 academyId+testId+uid 매칭 doc fetch (client-side createdAt desc 정렬)
- 가장 최신 doc 의 scoreId 로 기존 `showScoreDetail` 호출
- composite index 불필요 (where 3개 equality)

**카드 onclick 추가** (옵션 B — 데이터 있는 카드만):
- 일반 시험 통과 카드 (vocab/mcq/fill_blank/unscramble/subjective)
- 녹음숙제 통과·미통과 카드 (회차별 audio + AI 피드백 있음)
- cursor:pointer + title 툴팁

**충돌 방지**: 녹음숙제 카드 안 audio·details summary 에 `event.stopPropagation()` — 재생/펼침 클릭이 모달 열기와 충돌 방지.

**academyId 필터 필수** — Rules 가 같은 학원만 허용. query 에 academyId 없으면 'missing or insufficient permission'.

**적용 범위**: 시험 목록 메뉴 + 시험관리 6개 메뉴 모두.

### 6) 학생앱 랭킹 기간 토글 (commit `e45659e`)

**이전**: 누적 전체 기간 — 옛 학생 우세, 신규/최근 노력 반영 X.

**변경**:
- 헤더에 알약 토글 3개 (이번 주 default / 이번 달 / 누적)
- `_rankPeriod` 모듈 변수 + `_rankPeriodStartYmd(period)` KST 헬퍼
  · week: 이번 주 월요일 0시 (월=1, 일=0 기준)
  · month: 이번 달 1일 0시
  · all: 빈 문자열 (필터 X)
- `renderRanking` — `scores.date >= startYmd` 클라 필터 (string 비교 OK — `_ymdKST` 가 'YYYY-MM-DD')

### 7) 녹음숙제 점수 학생 비공개 정책 (commit `dea31f1`)

이전 commit `5de29ae` 에서 결과 헤드라인은 ✅통과/❌미통과 만 표시했지만 점수 잔존 3 곳 fix:
- 학생앱 녹음숙제 완료 카드: `'✓ 완료 80점'` → `'✓ 완료'`
- 결과 화면 회차별 audio 라벨: 마지막 회차 점수 배지 제거
- 학생앱 랭킹: 녹음숙제 score 를 best 비교에서 제외 (count/total 은 누적 — 평균에 묻힘)

**학원장 화면 그대로** (점수 표시).

### 8) 학생앱 녹음숙제 결과 화면 fix (commit `7c792b8`)

commit `6a538cb` 후 stale 두 버그:

**1. `viewRecAiResult` isV2 판정 stale**:
- 이전: `recordings.length >= 2 && recordings[0].score`
- 새 데이터 모델은 score 가 마지막 회차에만 박힘 → 첫 회차에 score 없음 → 토스트만
- fix: `recordings.length >= 1 && lastRec.score`

**2. `_rv2RenderResult` 호출 시그니처 mismatch**:
- positional 5개 호출, 함수는 단일 객체 destructuring → 모든 인자 undefined
- fix: 객체로 호출 + recordings 배열 함께 전달

**3. 회차별 audio 표시 추가**:
- recordings 배열 있으면 회차별 플레이어 (성실도 표시, 학생용은 점수 X)
- 1회면 마지막 audio 만 (이전 동작 유지)

### 9) 성적 리포트 컬럼 폭 재조정 (commit `111536e`, `f85e7b0`, `3ff3a1c`, `63adefe`)

`table-layout:fixed` + colgroup 적용. scores 의 실제 최대 bookName 55자 ('Bricks Subject Reading TOTAL · 1 Bricks Subject Reading') 확인 후 폭 산정:
- No 40 / 반 80 / 이름 90 / 유형 90 / **교재명 360 (영문 55자)** / **시험명 가변 (잔여)**
- 정답·전체 70 / 점수 70 / 일시 120 / 상세 90

화면 1280px (사이드바 260px 제외) 에선 시험명 가변 짧음 — 큰 화면 (1440+) 권장. 잘리는 컬럼은 hover title.

### 10) 시험관리 운영 개선 (commit `e2791b9`, `0898bf2`)

**문제 세트 보기 모달 정리**:
- 상단 헤더: 유형/모델 제거, 문제 수 + 출처 페이지만
- 카드 헤더: 녹음숙제 [보통] 배지 숨김 (difficulty 의미 없음)
- 녹음숙제 메타: 가짜 70점/60초/3회 반복 제거 → `📄 N Page · ⚙️ 통과점수·평가시간·녹음횟수는 시험 배정 시 설정`

**옵션 요약** (commit `5c6276e`):
- `_qsMcqSubType(s)` 헬퍼 — 첫 question.subType 으로 세트 종류 판정
- `_qsBuildOptionsSummary` — mcq 면 `📖 본문이해` 또는 `📐 문법`, unscramble `4청크` 또는 `3~5청크`, fill_blank `2 빈칸`, recording 옵션 X

**수정 모달 녹음숙제**:
- 정확도/평가구간 input 제거 (시험 배정 시 결정 정책)
- 안내문 추가
- 본문 textarea flex:1 + min-height:200px + resize:vertical (모달 남는 공간 다 사용)

### 11) 세트 default 이름 정리 (commit `41a6d2c`, `42672f9`)

유형 컬럼에 표시되니 이름에 중복 X:
- mcq 본문이해: `_qgBuildDefaultName()` (Chapter · 첫 페이지 제목)
- mcq 문법: `_qgBuildDefaultName() + ' · 문법'`
- 단어시험·언스크램블: `_qgBuildSetDefaultName('단어시험'/'언스크램블')` → `_qgBuildDefaultName()`
- Wordsnap·빈칸·주관식·녹음숙제 그대로 (사용자 미명시)

옛 세트 이름은 그대로 유지 (Firestore 에 박힌 이름 변동 X). 신규부터 적용.

---

## 작업 규칙 추가 (2026-05-11)

신규:
- **학원장 학원 단위 설정 — Firestore 이전 권장** — 학원장이 여러 PC 사용 가능 시나리오 누락하면 안 됨. localStorage 는 1인 1PC 사용자 선호 (인쇄 옵션, UI 토글) 에만. 학원 단위 데이터 (커스텀 프롬프트, 클린업 프리셋 등) 는 Firestore. `academies/{id}.{field}` + Rules 화이트리스트에 추가.
- **응시 시 셔플되는 데이터는 셔플 결과까지 저장** — `comp.questions` 에 셔플된 순서 박아야 다시 보기 시 `comp.answers` idx 와 매칭. mcq 셔플 mismatch 가 표본. 다른 시험에서도 응시 시 random 처리하면 동일 패턴 검토.
- **subType 필드 패턴 — sourceType 분리 X** — 같은 시험 메뉴 안에서 카테고리 구분 필요 시 `q.subType` 필드로. sourceType 새로 만들면 메뉴 분리·시험 배정 등 영향 큼. mcq grammar 가 표본.
- **후처리 모듈 위치 — 서버 측 권장** — 클라가 응답 받기 전 보정. 모든 학원 동일 적용. 클라 코드 변경 X. `api/_lib/quiz-post-process.js` 패턴.
- **a/an 자동 보정** — AI 가 자주 실수하는 영역. shouldUseAn (vowel sound + 예외 사전) 패턴으로 자동 보정. 향후 시제·조동사 등 같은 패턴 확장 가능.
- **컬럼 폭 결정 — 실제 데이터 최대 길이 확인** — 작업 전 진단 query 로 max length 측정. 추정으로 정하면 줄바꿈/잘림 발생. scores bookName 55자 확인이 표본.

---

## 파일 크기 / SW 캐시 (2026-05-11)
- `api/generate-quiz.js`: ~1370줄 (+~80, mcq_grammar 프롬프트 + subType 분기 + post-process 호출)
- `api/_lib/quiz-post-process.js`: 신규 ~110줄 (4 함수)
- `public/admin/js/app.js`: ~13350줄 (+~250, mcq subType + 라벨 통일 + 카드 클릭 모달 + 후처리 안내)
- `public/super/js/app.js`: ~3450줄 (+~30, mcq_grammar 탭 + Firestore 미정의 시 서버 fetch)
- `public/js/app.js`: ~5050줄 (+~70, 랭킹 기간 토글 + mcq 셔플 fix + 녹음숙제 결과 화면 fix + 점수 비공개)
- `public/_app.html`: 학생앱 카드/타이틀/랭킹 토글 추가
- `public/admin/_app.html`: 사이드바 + 페이지 + colgroup
- `firestore.rules`: academies update 화이트리스트 + customPrompts
- 신규 진단: `scripts/diag/test-quiz-post-process.js` (17/17 통과)
- SW 캐시: `kunsori-v404`

## 진행률 (2026-05-11)
- **MCQ 시스템: ~100%** (본문이해 + 문법 카테고리, 후처리 모듈, 셔플 mismatch fix)
- **AI 프롬프트 인프라: ~100%** (super_admin / 학원장 / 코드 default 3단 fallback, 다중 PC 동기화)
- 단어 말하기 시험: ~100% (변동 없음)
- 녹음숙제 시스템: ~98% (학생앱 결과 화면 fix)
- 결제 v2: ~98% (변동 없음)
- 학생관리 운영: ~98% (변동 없음)
- 화이트라벨 브랜딩·멀티테넌시·super_admin: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-11 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
2. **학원장 대시보드 달력 보강** — 생일 카테고리 추가 (`users.birth` 입력 강화)
3. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
4. **AI 평가 실패율 (SuperAdmin Phase B T9)** — 베타 30일+ 누적 후 Cloud Function 일일 집계
5. **(선택) 옛 세트 이름 일괄 정리** — '· 객관식' / '· 단어시험' suffix 일괄 제거 마이그레이션 스크립트
6. **(선택) 후처리 모듈 확장** — 시제 / 조동사 / 주어동사 일치 검증 추가

**완료 (이 세션, 2026-05-11)**:
- ✅ 객관식 시험에 문법 카테고리 추가 (subType 'content'|'grammar' + 별도 프롬프트)
- ✅ MCQ 후처리 모듈 (a/an 자동 보정 + 셔플 + 진단 스크립트 17/17 통과)
- ✅ SYSTEM_PROMPTS.mcq_grammar 컴팩트화 (NEW CONTENT/SHORT/Type A·B questionKo/a·an 예외)
- ✅ 학원장 커스텀 AI 프롬프트 Firestore 이전 (다중 PC 동기화 + 자동 마이그레이션)
- ✅ super_admin Firestore 미정의 시 서버 default fetch (코드 default 보며 편집)
- ✅ MCQ 셔플 mismatch fix (comp.questions 우선)
- ✅ 학생별 카드 클릭 → 상세 모달 (시험 목록 + 시험관리)
- ✅ 학생앱 랭킹 기간 토글 (이번 주/이번 달/누적, default 'week')
- ✅ 녹음숙제 점수 학생 비공개 정책 (3 곳 + 랭킹 best 비교 제외)
- ✅ 학생앱 녹음숙제 결과 화면 fix (isV2 + 시그니처 + 회차별 audio)
- ✅ 성적 리포트 컬럼 폭 재조정 (실제 최대 데이터 기준)
- ✅ 시험관리 운영 개선 (가짜 메타 제거, 옵션 요약, 본문 textarea flex)
- ✅ 라벨 통일 ('교재이해'/'내용이해' → '본문이해', 콤마 → 가운데점, 컴팩트)
- ✅ 세트 default 이름 정리 (유형 suffix 제거 — 컬럼 표시 중복 회피)

---

## 2026-05-12: 녹음숙제 시스템 대규모 정비 — 4.5MB 한도 + UX 전환 + AI 피드백 확장 + 점수 비공개

당일 SW v404 → v437 (~40 commit). 녹음숙제 시스템의 비용·UX·정책·평가를 종합 정비.

### 1) eval 실패 원인 진단 + Storage URL 패턴 fix
오늘 default 학원 녹음숙제 11건 중 5건 eval 단계 실패 — 학원장 보고.

**진단** (`scripts/diag/analyze-recording-failures-today.js` 신규):
- 5건 모두 `latestErrorStage='eval'`
- 에러 메시지 `"Unexpected token 'R', \"Request En\"..."` → Vercel **"Request Entity Too Large"** HTML 응답을 JSON parse 시도해서 깨짐
- 결정적 원인: **Vercel serverless 4.5MB body 한도**. iOS Safari AAC 128kbps × 5분 = base64 후 ~6MB → 거부

**Fix — audioUrl 패턴 도입** (commit `55c065b`):
- `api/check-recording.js`: audioUrl 받기 분기 추가 — server-side `fetch(audioUrl)` → buffer → base64 → Gemini inlineData
- `public/js/app.js _rv2Submit`: base64 변환·전송 제거 → audioUrl 만 전송 (학생 폰 메모리·CPU 부담 ↓)
- `_rv2BlobToBase64` 헬퍼 제거 (사용처 0)
- 옛 audioBase64 분기 유지 (점진 호환)
- 효과: Vercel body 한도 무관, 모든 폰·녹음 길이 일관 작동

### 2) 학원장 [🔁 재평가] 시스템 — adminAction dispatcher 신규
**신규 `api/adminAction.js`** — 학원장 전용 dispatcher (Vercel 함수 수 우회 패턴, superAdmin.js 와 동일):
- `action: 'reEvaluateRecording'` — userCompleted.recordings[last].audioUrl 으로 check-recording self-call
- 권한 체크: `caller.role === 'academy_admin' || 'admin' || 'super_admin'` (시스템 표준 'academy_admin', 'admin' 폴백)
- 학원 격리 검증 + 학생 users fetch (group·name 누락 방지)
- self-call URL: **`raloud.vercel.app` public alias 사용** (VERCEL_URL deployment-specific URL 은 Vercel Auth 보호로 HTML 반환)
- HTML 응답 방어: Content-Type 검사 + 친화적 메시지
- userCompleted + scores admin SDK 갱신 (Rules `uid==request.auth.uid` 우회)

**학원장 카드 [🔁 재평가] 버튼** (`public/admin/js/app.js`):
- 미통과 + recordings 있는 케이스, 에러 + recordings 있는 케이스, 통과 케이스 (Phase B 후) — 모든 제출 카드에 노출
- `tpReEvaluateRecording` 함수 신규

**catch 블록 보강** (`_rv2Submit`): 이미 업로드된 recordings 를 catch 블록에서도 박음 → 학원장 재평가 가능

**1회용 복구 스크립트** (`scripts/admin/recover-recording-errors.js`): Storage list 로 옛 에러 (recordings 없음) 케이스 복구. 오늘 7건 일괄 처리 (모두 통과 85~95점, 1명 미통과 78점 — 정하연).

### 3) Phase A — 학생 점수 비공개 + "제출 완료" UX 정책
사용자 요구: "녹음숙제는 점수평가의 객관성·정확성이 아직은 부족 — 통과점수 개념 없애고 학생에게는 '제출 완료'만"

**학생 결과 화면** (`_rv2RenderResult`):
- 통과/불통 헤드라인 폐기 → **"📤 제출 완료"** 단일
- 회차별 audio + 성실도·속도 메시지 (`_rv2BuildRoundMessage`)
- AI 피드백 위 안내: "마지막 회차 (충분히 연습된 녹음) 기준"
- 30일 보관 안내 박스
- [마지막 녹음 다시] 버튼 제거
- 호출부 3곳 fullText 전달 (속도 계산용)

**회차별 메시지 (`_rv2BuildRoundMessage`)**:
- 우선순위: 성실도 < 40% → 속도 (< 0.8 wps 느림 / > 3.5 wps 빠름) → 격려
- 반환에 `vaPct` (말소리 비율) + `wpm` (분당 단어) 포함

### 4) Phase A+ — 자동 중간 저장 (쉬었다 이어서 진행)
사용자 요구: "2회 녹음 시험 중 1회만 하고 다음에 이어서 — 로그아웃해도 유지"

- **`_rv2UploadRound`** (신규): 회차 즉시 Storage 업로드 + `userCompleted.inProgress` 갱신
- **`rv2SaveRound`**: 회차 push 후 즉시 upload + 💾 토스트 (마지막 회차는 _rv2Submit 흐름)
- **`_raStartV2`** async + inProgress 복원 (savedRounds 채움, currentRound 설정)
  - 모든 회차 저장된 edge case 진입 시 자동 _rv2Submit
- **`_rv2Submit`**: 이미 업로드된 회차 skip + `inProgress: deleteField()`
- **`rv2Quit`**: "자동 저장됨, 이어서 진행 가능" 친근한 안내
- **`startRecAi` v2 분기**: `completedAt`/`latestFailedAt` 있을 때만 결과 보기 우회 (inProgress 만이면 진행)
- **`loadRecAiList` 시험 카드**: "▶ 이어서 N/M" 파란 배지 + 화살표
- **`deleteField` import** 추가

### 5) Phase A2 — 회차 메시지 즉시 + 영단어 클릭 발음 + 음역 멘트 제거
- **`_rv2.lastRoundFeedback`** 필드 + `_rv2Render` 상단 컬러 박스 (새 회차 시작해도 유지 — 다음 녹음 참고)
- **마지막 회차 카드 아래 항상 "ℹ️ AI 피드백은 마지막 회차 기준" 안내** (회차 카드 그리드 하단, 모든 회차 화면에서)
- **결과 화면 보관 안내 단순화**: "30일 동안 다시 들을 수 있어요" 만 (60일 자동 삭제 학생에게 안 알림)
- **"X처럼 들렸어요" 음역 멘트 제거**:
  - 클라 `_cleanIssue` 정규식 (즉시 효과)
  - 프롬프트 BAD/GOOD 예시 강화 (다음 평가부터)
- **영단어 클릭 → 발음 재생** (Web Speech API en-US, rate 0.85)
  - `_playEnglishWord` + `_renderInlineWithTTS` (정규식 wrap)
  - 적용: 생략된 단어 칩 / 발음 개선 word 큰 버튼 / issue·tip 안 모든 영단어 점선 underline
- 학생앱 자체 overlay 패턴 (showModal 동적 함수 없음 — 학원장 앱과 다름)

### 6) Phase A3 — "말소리 비율" 통일 + WPM 노출 + 40% 차단 폐기
- **용어 통일**: "성실도" → **"말소리 비율"** (학생·학원장 양쪽)
- **회차 라벨 한 줄**: `1회차 · 45초 · 말소리 72% · 속도 152 WPM` (결과 화면 + 응시 중 카드)
- **녹음 화면 ⓘ 인포 뱃지** (헤더 우측 + 결과 화면 회차 헤더 옆):
  - `showRecordingTermsModal` 신규 (자체 overlay)
  - 말소리 비율 정의·임계값 + WPM 정의·영어 평균 읽기 속도 안내
- **40% 미만 차단 폐기**: pre-check 의 VAD 검사 제거 (음악·단조로움 검사는 유지)
- **시험 배정 모달 "성실도 임계값" 옵션 폐기** + `accuracyThreshold` 안 박음

### 7) Phase B — passScore (통과점수) 완전 폐기
- **`_rv2Submit`**: passed 분기 → 단일 흐름. `completedAt` 박음. passed:true 일관
- **scores 컬렉션**: `passed: true` 일관, `correct=1/wrong=0`
- **학원장 카드**: "✅ 통과" / "⚠ 미통과" → **"📤 제출됨 · N점"** 단일 (파란색 #0369a1)
- **`isPassed`/`isFailedWithRecs` 분기 → `isSubmittedWithRecs` 단일**
- **옛 미통과 데이터** (latestFailedScore + recs 없음): "제출됨" 라벨로 통일
- **시험 배정 모달**: 녹음숙제 통과점수 input → **"제출 완료 (통과/불통 X)" 안내 박스**
- **tpPublish 저장**: 녹음숙제는 `passScore` 필드 안 박음
- **시험관리 진행 현황**: "통과점수 N점" → "📤 제출 완료 방식 (통과/불통 X)"
- **`_computeTestStats`**: 녹음숙제 응시 = 제출 카운트 (passedCount = attemptedCount)
- **`showScoreDetail`** 녹음숙제 분기: 통과/불통 검사 우회 (recordings 있으면 무조건 _adminBuildDetail)
- **`_adminRecBuildDetail`**: Phase B/C 반영 (통과/불통 배경색 폐기, 카테고리 + positives 추가)

### 8) Phase C — AI 피드백 확장 (잘한 점·억양·강세·카테고리)
사용자 요구: "좀더 다양한 피드백" + "카테고리별 점수는 학원장만, 정성 코멘트는 둘 다"

**신규 AI 응답 항목**:
- `feedback.positives`: 잘한 점 (최대 2개, 격려)
- `feedback.intonation`: 억양 한 줄 코멘트
- `feedback.stress`: 강세 한 줄 코멘트
- `categoryScores`: { pronunciation, intonation, pace, accuracy } 각 0~100
- `categoryComments`: 같은 4종 한 줄 코멘트

**responseSchema 강화**:
- `categoryScores.required = [pronunciation, intonation, pace, accuracy]` (4종 모두 강제)
- `categoryComments.required` 동일
- 최상위 required 에 `categoryScores`/`categoryComments` 추가
- `maxOutputTokens 1000 → 3000` (truncation 방지)
- `_salvageTruncated`: 잘려도 마지막 정상 닫힘까지 살림 + 부족한 brace/bracket 자동 채움

**프롬프트 강화**:
- 카테고리별 의미 명시 (pronunciation/intonation/pace/accuracy)
- 한 줄 60자 이내 CRITICAL (토큰 절약)
- "4 카테고리 모두 채워야 함" CRITICAL

**학생 결과 화면**:
- 📊 항목별 코멘트 4종 (점수 X) — 학습 가이드
- 👍 잘한 점 (positives)

**학원장 화면** (`tpToggleTestProgress` details + `_adminRecBuildDetail`):
- 📊 항목별 **점수+코멘트** (학원장만 점수)
- 👍 잘한 점

### 9) AI 점수 패턴화 진단 + temperature 조정
**진단**: 학생별 audio 진짜 다른데 score 78 / 카테고리 75-70-85-80 통일 — AI 안전 디폴트 패턴
- `compare-reeval-scores.js` / `compare-audio-urls.js` / `test-length-vs-scores.js` 진단 도구
- 본문 길이 가설 검증 → 짧은 본문도 78점 통일 → 본문 길이 무관
- 결정적 진단: audio 다름, missedWords/note 다름, **score 와 4 카테고리만 디폴트**

**조정 (점진 상향)**:
- temperature **0.1 → 0.5** (Phase C 적용 직후)
- temperature **0.5 → 0.7** (78점 3개 잔존)
- temperature **0.7 → 0.9** (피드백 다양성 우선 — 점수보다 표현·지적 다양성)
- topP 0.9 → 0.95
- 프롬프트 CRITICAL: "학생별 차이 명확히 반영, 78점 디폴트 회피, 0-100 전체 활용, 한국 학생 영어 = 78점 일반화 패턴 회피"

효과: 동일 시험 4명 점수 분포 88/78/85/78 (이전 78 통일 → 다양화). 그러나 일부 잔존 (Flash 한계).

### 10) showScoreDetail 누락 필드 fix
재평가 결과 성적 리포트 모달에 반·교재명 누락 보고.
- 원인: `adminAction.js` scores add 가 학생 group / bookName / unitName 안 박음
- 수정: users/{uid} fetch → group/name 추출 + t.bookName / unitName 박음
- 학생앱 _rv2Submit scoresPayload 와 동일 필드 구조

### 11) Phase D — 30일 학생 재생 차단 + 60일 자동 삭제
**1단계 — 학생앱 코드**:
- `_rv2IsAudioExpired`: `completedAt`/`latestFailedAt` 기준 30일 초과 판정
- `viewRecAiResult`: `audioExpired` 계산 → `_rv2RenderResult` 전달
- `_rv2RenderResult`: audioExpired 면 audio 영역 → **"🔒 녹음 다시 듣기 만료"** 박스
  - AI 피드백 영역은 계속 표시 (만료 무관)
- 학원장 화면 영향 없음 (60일까지 audio 접근)

**2단계 — GCS Lifecycle Rule** (`scripts/admin/set-recording-lifecycle.js`):
- `recordings/genTests/*` 경로 age 60 days delete
- DRY-RUN/--apply 패턴
- 학원 무관 일괄 적용 — readaloud-51113.firebasestorage.app 버킷에 적용 완료
- 매일 GCS 자동 검사 + 삭제

### 12) maxDurationSec 정책 정비
사용자 요구: "600초 자동 종료, 업로드 가능, 재녹음 X. 학원장 입력 600초 cap. 학생앱에 제한시간 명시"

- **학생앱 자동 종료 타이머**: `q.maxDurationSec` 우선 (Math.min 600 cap). 학원 default 폴백
- **학생앱 녹음 화면 헤더**: 숙제 내용 옆 **"⏱️ 60~600초"** 안내 배지
- **자동 종료 토스트**: "제출하거나 다시 녹음하세요" 친화적
- **학원장 시험 배정 모달**: max 1800 → 600 cap + "최대 600초 (10분)" 안내문
- **저장 검증**: maxDur > 600 무시
- pre-check `duration > maxDur + 5` 안전망 그대로 (자동 종료가 600초 안에서 끝남)
- `_trimAudioForGemini` (wav 변환 → 용량 5~10배 ↑) — 호출 0건 죽은 코드 (그대로 둠)

### 13) Custom Claims 권한 fix
- `adminAction.js` 초기 코드가 `caller.role === 'admin'` 만 체크
- 시스템 표준은 **`'academy_admin'`** (createAcademy/createStudent/deleteUser/sendPush 모두 이걸 사용)
- 수정: `'academy_admin' || 'admin' || 'super_admin'` 다 허용 (안전망 폴백)
- 진단 도구 `scripts/diag/check-admin-claims.js` (usernameLookup → uid → Claims 확인)

### 14) 진단 도구 신규 (11종)
- `analyze-recording-failures-today.js` — 일별 실패 분포 (A/B/C 분류)
- `check-error-recordings.js` — 에러 케이스 recordings 진단
- `compare-reeval-scores.js` — 재평가 점수 학생 간 비교 (점수 동일 그룹 탐지)
- `compare-audio-urls.js` — 학생별 audioUrl 비교 (audio 진짜 다른지)
- `check-test-params.js` — 시험 옵션 (evalSec, passScore, fullText 등)
- `test-length-vs-scores.js` — 본문 길이 vs 점수 다양성
- `check-all-eval-seconds.js` — 학원별 evaluationSeconds 분포
- `check-admin-claims.js` — Custom Claims 진단
- `recover-recording-errors.js` (admin) — Storage list → 일괄 재평가 (1회용)
- `set-recording-lifecycle.js` (admin) — GCS Lifecycle Rule 설정

---

## 작업 규칙 추가 (2026-05-12)

신규:
- **Vercel serverless 4.5MB body 한도** — 큰 파일 (audio/video/이미지) 인라인 base64 전송 금지. **Storage URL 패턴** 사용 — 클라가 Storage 업로드 후 URL 만 전송, 서버가 fetch. 클라 메모리·CPU 부담도 ↓.
- **adminAction.js self-call URL** — `VERCEL_URL` (deployment-specific) 는 Vercel Authentication 보호로 HTML 응답 가능. **`raloud.vercel.app` public alias 사용**. `SELF_HOST` env 로 override.
- **HTML 응답 방어** — `cr.headers.get('content-type')` 검사 후 JSON parse. `Unexpected token '<', "<!doctype..."` 같은 깨진 응답 친화적 메시지로 변환.
- **Custom Claims 표준** — 학원장은 **`'academy_admin'`** (createAcademy 가 박는 값). API 권한 체크 시 `'academy_admin'` 우선, `'admin'` 폴백 허용. `'admin'` 단독 체크 X.
- **사용자 시도 기준 보수적 카운트** (2026-05-02 작업 규칙 보강) — `incrementUsage` 위치는 quota gate 직후. Gemini 파서 실패해도 시도 카운트.
- **녹음숙제 정책 — 통과/불통 폐기** — `mode='recording'` 인 scores 는 `passed:true` 일관. `passScore` 시험 doc 에 박지 않음. 학원장 화면도 "📤 제출됨 · N점" 단일 카드. 학생에게는 점수 비공개 ("📤 제출 완료" 만).
- **녹음숙제 maxDurationSec 600초 cap** — 학원장 입력도 600 이하. 학생앱 자동 종료 타이머가 `q.maxDurationSec` 우선 (Math.min 600 cap). 학생 화면 헤더에 제한시간 명시.
- **truncated JSON 복구 패턴** (`_salvageTruncated`) — Gemini maxOutputTokens 초과 시 응답 잘림. 마지막 정상 `}`/`]` 위치 찾아 부족한 brace/bracket 채워서 살림. trailing comma 제거.
- **AI 점수 다양성 — temperature 0.7~0.9** — 평가형 AI 호출 (Gemini check-recording) 은 결정성 (0.1) 보다 다양성 우선. 학생별 응답·표현·지적 단어 다양화 효과. 단점: 같은 학생 재평가 시 점수 ±10~15점 변동 — 학원장 안내.
- **녹음 audio 보관 정책** — 학생 30일 (UI 차단), GCS 60일 (Storage 자동 삭제). 학원장은 60일까지 접근. AI 피드백·점수는 영구 보존.
- **GCS Lifecycle Rule** — `bucket.setMetadata({lifecycle:{rule:[...]}})` admin SDK. 매일 GCS 가 자동 검사. 60일 age 기준 객체 삭제. 학원 무관 일괄 적용.

---

## 파일 크기 / SW 캐시 (2026-05-12)
- `public/admin/js/app.js`: ~13800줄 (변동 ~+300)
- `public/js/app.js`: ~5500줄 (변동 ~+500 — Phase A/A+/A2/A3/B/C/D 누적)
- `api/check-recording.js`: ~430줄 (+~140 — audioUrl 분기·responseSchema 확장·prompt 강화·_salvageTruncated)
- `api/adminAction.js`: 신규 ~210줄 (학원장 dispatcher)
- `scripts/admin/`: 신규 2개 (recover-recording-errors / set-recording-lifecycle)
- `scripts/diag/`: 신규 9개 (오늘 진단 도구)
- SW 캐시: `kunsori-v437`

## 진행률 (2026-05-12)
- **녹음숙제 시스템: ~100%** (Phase A/A+/A2/A3/B/C/D 완료, AI 점수 다양화, 4.5MB fix, 권한 fix, 누락 필드 fix)
- 학원장 [🔁 재평가]: ~100%
- 보안: ~95% (변동 없음)
- 멀티테넌시·super_admin·결제: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-12 갱신)
1. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
2. **학원장 대시보드 달력 보강** — 생일 카테고리
3. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
4. **AI 평가 실패율 (SuperAdmin Phase B T9)** — Cloud Function 일일 집계
5. **AI 점수 정확도 추가 개선** — Gemini Pro 모델 전환 검토 (호출당 10배 비용, 학생별 미세 차이 인식력 ↑)
6. **wav 변환 죽은 코드 정리** — `_trimAudioForGemini` / `_audioBufferToWav` 제거 (안전 cleanup)

**완료 (이 세션, 2026-05-12)**:
- ✅ Vercel 4.5MB body 한도 fix (audioUrl 패턴, 모든 폰 안정 작동)
- ✅ 학원장 [🔁 재평가] 시스템 (adminAction dispatcher + 권한·누락 필드 fix + 일괄 복구 7건)
- ✅ Phase A — 학생 점수 비공개 + "📤 제출 완료" + 회차별 메시지
- ✅ Phase A+ — 자동 중간 저장 (이어서 진행, 로그아웃 무관)
- ✅ Phase A2 — 회차 메시지 즉시 + 영단어 클릭 발음 + 음역 멘트 제거
- ✅ Phase A3 — "말소리 비율" 통일 + WPM + ⓘ 인포 + 40% 차단 폐기
- ✅ Phase B — passScore 완전 폐기 ("📤 제출됨 N점" 단일)
- ✅ Phase C — AI 피드백 확장 (positives·intonation·stress + categoryScores/Comments)
- ✅ AI 점수 다양화 (temperature 0.1 → 0.9, 프롬프트 강화)
- ✅ Phase D — 30일 학생 재생 차단 + 60일 GCS 자동 삭제
- ✅ maxDurationSec 600초 cap + 학생 화면 안내 배지
- ✅ Custom Claims 표준 (academy_admin) 권한 fix
- ✅ 진단 도구 11종 신규
