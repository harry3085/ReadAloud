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

## 옛 세션 이력 (~2026-05-15)

2026-04-19 ~ 2026-05-15 의 세션 이력 (Phase 6 작업·멀티테넌시 전환·결제 v2·브랜딩·SSR·녹음숙제·말하기·AI 사용량 한도 재설계 등) 은 [docs/claude-md-archive/2026-04-19-to-2026-05-15.md](docs/claude-md-archive/2026-04-19-to-2026-05-15.md) 로 분리됨 (2026-05-23 컨텍스트 부담 완화). 옛 작업 맥락이 필요하면 Read 도구로 그 파일을 직접 fetch.

---

## 2026-05-16: 말하기 시험 userCompleted 미생성 버그 + 결과 표시 정비

당일 SW v529 → v535 (~8 commit). 학원장 "통과했는데 목록에 미완료" 보고에서
출발 → 근본 원인(말하기 answers undefined) 추적 → 차단·복구·표시 정비 종합.

### 1) userCompleted 미생성 근본 버그 (commit `d9faa59`)

**증상**: 문성미 '중1 마더텅 영어듣기 ch10' 말하기 통과(90점)했는데 학생앱·
학원앱 목록에 미완료 유지. 같은 시험 통과자 전원(용주영 등) userCompleted 0건.

**진단**: `scores` 는 `addDoc` 으로 정상 박힘(score=90 passed=true). 그러나
`_writeUserCompleted` 의 `setDoc` 가 throw → `_vqSubmit` 안쪽 `catch` 가
`console.warn` 으로 **조용히 삼킴** → userCompleted 미생성 → 목록 완료
판정(`userCompMap.get(t.id)?.score !== undefined`) 영영 false.

**throw 이유**: 말하기 answers 의 `spkAttempts` 등이 5/14~16 음성인식
대규모 변경(3차 MR 흐름, commit 18개)의 특정 경로에서 `undefined`.
Firestore 는 객체 어디든 undefined 있으면 setDoc **전체** 거부.

**수정 (옵션 1 — 공용 함수 방어, 음성인식 코드 무관)**:
- `questions`/`answers` JSON 왕복(`JSON.parse(JSON.stringify())`)으로 깊은 곳 undefined 제거
- top-level undefined 키 제거 (serverTimestamp sentinel 은 undefined 아니라 보존)
- setDoc 실패 시 `console.error` + 사용자 토스트 + **re-throw** (조용히 삼키지 않음)
- 모든 시험 유형(vocab/mcq/fill_blank/unscramble) 예방 보호. 다음 응시부터 적용

### 2) 누락 응시자 백필 (commit `37215c6`)

`scripts/migrate/backfill-usercompleted-from-scores.js` — scores `passed=true`
→ (testId,uid) 최고점 → userCompleted.score 없으면 최소 필드 백필.
- DRY-RUN/--apply. `_backfilledFromScores:true` 마커
- **default 9건 적용** (문성미 5·이성민·전지윤·정하윤·용주영, 전부 vocab/speaking)
- `questions`/`answers` 는 scores 에 없어 생략 → 목록·점수 정상, 상세는 작업규칙7 폴백

### 3) 다른 모드 영향 전수검사 — 말하기 전용 확인

백필 스크립트가 4모드(vocab/mcq/fill_blank/unscramble) 전부 스캔 → 대상
9건 전부 `vocab` + format 확인 결과 **전부 speaking**. mcq/fill_blank/
unscramble/일반vocab 누락 **0건**. → 말하기(speaking) 전용 버그 확정.

### 4) stale 전수검사 (commit `b5ee1c7`)

`scripts/diag/check-stale-usercompleted.js` — userCompleted 는 있지만
scores 최고점 > userCompleted.score (재응시 최고점 미반영, 김다윤 케이스).
- **stale 2건**: 문성미·김다윤 (둘 다 vocab/speaking, scores 100점인데
  userCompleted 83·90점 — 5/16 재응시가 setDoc 실패로 미반영)
- **옵션 A 채택** — 데이터 손대지 않음. 코드 수정(d9faa59) 완료라 재응시
  하면 자동 완전 복구. 점수만 갱신 시 questions/answers(유실) 불일치라 비권장

### 5) 결과화면 음역 멘트 누락 fix (commit `be6f990`)

`_cleanAiReason`(C 옵션, 5/15) 은 reason 텍스트만 정제. `aiHeard` 를 직접
출력하는 라인 5154 `"OOO처럼 들릴 수 있어요"` 는 별도 경로라 정답 검사
없이 무조건 출력 → 정답 말해도 떴음. 케이스2(AI 정밀통과)에서 aiHeard
소문자 trim 비교 → 정답(q.word)과 같으면 그 줄 숨김. 다른/동음이의어면 유지.

### 6) 상세 들린단어 spkAiHeard 우선 (commit `23d8a41`)

**발견**: AI 통과 시 `_vqSpkFinalize(true, q.word)` → `spkHeard = 정답
그 자체`. 상세 모달의 들린 단어가 정답으로 박혀 학생 실제 발음(AI 인식값
= spkAiHeard) 안 보임 — AI 정밀 결과를 버리는 셈.
- `_vqBuildDetail`(학생) + `_adminVocabBuildDetail`(학원장) 들린 단어를
  `spkAiHeard || spkHeard` 로. 학원장 동음이의어 매칭 판정도 spkAiHeard 우선
- 표시 레이어만 변경 — 데이터·저장 로직 무관. 옛 데이터는 spkHeard 폴백

### 7) 학원장 상세 — 정확도·시도횟수 표시 (commit `dd9f2f0`, `48048ee`)

`confidence`·`spkAttempts` 는 이미 받던 데이터(추가 비용 0). `_adminVocabBuildDetail`
speaking 줄에 학원장 전용 추가:
- **정확도 N%** (spkAiConfidence, 90+초록/70-89주황/<70빨강) — AI 추정값이라
  학생 비노출(시험점수와 혼동·혼란 우려). AI 경로만 (Web Speech 통과·옛 데이터 미표시)
- **N회** (spkAttempts — 단어 1개 내 1·2차 Web Speech / 3차 AI 중 통과 시도.
  객관 사실이라 혼란 없음)

### 8) 성적 상세 'N회 응시 중 X번째' (commit `f913e49`)

시험 전체 재응시 횟수 — 별도 카운터 없음, scores doc 건수로 계산.
`showScoreDetail` 에 그 학생·그 시험 scores `createdAt` asc 정렬 → 현재
기록 순번. 헤더에 보라색 `4회 응시 중 3번째` / `1회 응시`.
- 인덱스 `scores (testId+uid+createdAt)` 추가·deploy·빌드 완료 후 적용
- try/catch — 빌드 지연·실패 시 순번만 생략, 모달 정상

---

## 작업 규칙 추가 (2026-05-16)

신규:
- **Firestore undefined → setDoc 전체 거부** — 객체·배열 어디든 `undefined`
  하나면 그 doc write 통째 실패. 사용자 입력·동적 필드가 들어가는 공용
  저장 함수(`_writeUserCompleted` 등)는 `JSON.parse(JSON.stringify())` 또는
  재귀 sanitize 로 방어. (serverTimestamp sentinel 은 JSON 왕복 대상에서
  제외 — top-level 만 undefined 키 삭제, sentinel 은 보존됨)
- **안쪽 catch 가 조용히 삼키면 안 됨** — `try{ await write }catch(e){
  console.warn }` 패턴은 실패가 묻혀 "scores 는 있는데 userCompleted 없음"
  같은 비대칭 유발. 최소 사용자 토스트 + re-throw(호출자 인지). 디버깅 가능하게.
- **표시값과 저장값 분리 인지** — `spkHeard` 는 AI 통과 시 `q.word`(정답)
  가 박혀 "실제 발음"이 아님. 실제 발음은 `spkAiHeard`. 상세 표시는
  `spkAiHeard || spkHeard` 우선. 진단·통계 필드(spkAiConfidence/spkAttempts)는
  저장만 되고 표시는 별도 결정.
- **AI 자체 추정값(confidence)은 학생 비노출** — 객관 측정 아닌 주관 추정.
  절대 수치로 학생에게 보이면 시험점수와 혼동·혼란. 학원장 참고용으로만.
  객관 사실(spkAttempts 시도횟수, 응시 순번)은 노출 OK.
- **응시 횟수는 컬렉션 doc 건수** — 별도 카운터 필드 없음. scores 는 매
  응시 addDoc → (testId,uid) doc 건수 = 재응시 횟수. createdAt 정렬로 순번.
- **버그 영향 전수검사 = 백필 스크립트로 모드 전부 스캔** — 특정 유형 버그
  의심 시 4모드 다 스캔해서 실제 분포 확인(추측 X). 9건 전부 speaking →
  말하기 전용 확정. stale(있지만 미반영)은 별도 스크립트로 구분 검사.
- **admin SDK 진단은 Firestore Rules 우회 — 클라 Rules 영향 쿼리는 F12
  병행 필수** — `scripts/` 의 firebase-admin 진단은 Rules 무시(전권). 클라
  에서 권한 거부되는 쿼리도 admin 진단은 "데이터 정상"으로 나옴. 클라
  화면 버그는 admin SDK 진단만으로 단정 X — 학원장/학생 F12 콘솔 에러
  (`Missing or insufficient permissions`) 확인 병행. _srLoadTestMeta
  배지 전멸이 표본 (admin 진단 정상 → F12 로 permission-denied 확정).
- **academyId 검증 Rules 컬렉션은 쿼리에 academyId 정적 제약 필수** —
  `allow read: resource.data.academyId == myAcademyId()` 인 컬렉션
  (genTests 등) 을 `where(documentId(),'in',[...])` 또는 academyId 없는
  쿼리로 클라 조회하면 Firestore 가 "Rules 만족 보장 불가" → 쿼리 전체
  permission-denied. **해결: (a) 쿼리에 `where('academyId','==',MY)`
  동반, 또는 (b) 단일 `getDoc(doc(...))` — nested rule `match
  /{id}` 가 각 doc 의 academyId 평가 → 같은 학원 통과**. 2026-05-16
  수평 전개 결과 `_srLoadTestMeta` 가 유일 사례 (학생앱 genTests in
  쿼리는 academyId 동반·안전, collectionGroup userCompleted 는 uid
  정적 제약·Rules-aware 설계·안전, super adminLogs 는 isSuperAdmin only).

---

## 파일 크기 / SW 캐시 (2026-05-16)
- `public/js/app.js`: +~25줄 (sanitize + 실패토스트 + aiHeard 정답검사 + spkAiHeard 우선)
- `public/admin/js/app.js`: +~30줄 (spkAiHeard 우선 + 정확도·시도횟수 + 응시 순번)
- `firestore.indexes.json`: +1 (scores testId+uid+createdAt)
- 신규 스크립트: `backfill-usercompleted-from-scores.js` / `check-stale-usercompleted.js`
- SW 캐시: `kunsori-v535`

## 진행률 (2026-05-16)
- 말하기 시험 userCompleted 버그: **~100%** (근본 차단 + 9건 백필 + stale 2건 진단 + 전수검사)
- 말하기 결과·상세 표시 정비: **~100%** (음역 멘트·spkAiHeard·정확도·시도횟수·응시순번)
- 단어시험 채점 견고성·동음이의어·음성 인식: ~100% (변동 없음)
- 멀티테넌시·결제·브랜딩·super 앱: 변동 없음
- Phase 5 출시 준비: 0%

## 다음 세션 후보 (2026-05-16 갱신)
1. **stale 2건 학원장 안내** — 문성미·김다윤 재응시 시 자동 완전 복구 (코드 수정 완료)
2. **Phase 5 출시 준비** — 도메인 / 약관 / 결제 PG 연동
3. **학원장 대시보드 달력 보강** — 생일 카테고리
4. **v1.0 Polish 사이클** ([memory/project_v1_polish_cycle.md](memory/project_v1_polish_cycle.md))
5. **super 앱 reads P2** ([memory/project_super_reads_p2_after_billing.md](memory/project_super_reads_p2_after_billing.md)) — 결제 완성 후

**완료 (이 세션, 2026-05-16)**:
- ✅ userCompleted undefined sanitize + 실패 토스트 + re-throw (근본 차단)
- ✅ 백필 9건 복구 (문성미·이성민·전지윤·정하윤·용주영, 전부 말하기)
- ✅ 다른 모드 영향 전수검사 (말하기 speaking 전용 확정)
- ✅ stale 2건 진단 (문성미·김다윤, 옵션 A 재응시 복구)
- ✅ 결과화면 aiHeard 정답 시 음역 멘트 숨김
- ✅ 상세 들린단어 spkAiHeard 우선 (AI 실제 발음 반영)
- ✅ 학원장 상세 정확도·시도횟수 표시 (학생 비노출)
- ✅ 성적 상세 N회 응시 중 X번째 + scores 인덱스
- ✅ 작업 규칙 보강 — Firestore undefined / catch 삼킴 금지 / 표시값·저장값 분리 / AI 추정값 비노출 / 응시 횟수 doc 건수

---

## 2026-05-16 (이어서): 성적리포트 배지 Rules 버그 + 삭제시험 안내 + 결제 입금체크 + attemptLabel Rules

SW v537 → v540 (~6 commit). 학원장 보고 연쇄 진단 — 성적리포트 배지·상세 표시 + 결제 입금체크.

### 9) 성적리포트 배지 전멸 — _srLoadTestMeta Rules 충돌 (commit `fdfedbc`)

증상: 성적 리포트 시험명에 🎤 말하기 / 📐 문법 배지 **전부 누락**.
F12: `app.js:4841 test meta fetch: Missing or insufficient permissions`.

원인: `_srLoadTestMeta` 의 `where(documentId(),'in',chunk)` (genTests) 가
genTests Rules(`academyId == myAcademyId`)와 충돌 — in 쿼리에 academyId
정적 제약 없어 Firestore permission-denied → catch → speakingMap/grammarMap
**항상 빈 객체** → 모든 행 배지 false. 시험목록·시험관리는 genTests 직접
로드라 정상이었음(성적리포트만 별도 메타 in쿼리).
**admin SDK 진단은 Rules 우회라 "정상"으로 오판 → F12 로 확정.**

수정: in 쿼리 → `Promise.all(testIds.map(getDoc))`. 단일 doc read 는
`match /genTests/{testId}` 가 각 doc academyId 평가 → 같은 학원 통과. reads 동일.

수평전개: `documentId() in` / academyId 제약 없는 쿼리 전수 점검 →
`_srLoadTestMeta` 가 유일(학생앱 genTests in 은 academyId 동반·안전,
collectionGroup userCompleted 는 uid 정적 제약·Rules-aware·안전, super
adminLogs 는 isSuperAdmin only·안전).

### 10) 삭제 시험 vs 레거시 안내 문구 분기 (commit `201b237`)

성지율 mcq 90점 첫통과인데 "레거시 시험" 표시 → 학원장 혼란. 진단: 학원장이
그 시험 삭제 → userCompleted cascade 제거, scores 만 이력 보존. showScoreDetail
의 `!genTest` 분기가 삭제·진짜레거시 구분 없음. 수정: `s.testId` 유무로 분기
— testId 있는데 genTests 없음 = "삭제된 시험(점수 보존, 상세는 삭제 시 제거)",
testId 빈값 = 기존 "레거시" 문구.

### 11) scores 에 speaking/grammar 메타 보존 (commit `567b77b`)

배지가 genTests 메타에만 의존 → 시험 삭제 시 같은 학생 성적리포트에서
살아있는 시험은 배지 O, 삭제 시험은 X (불일치). 응시 저장 시 scores 에
메타 박음: vocab `_vqSubmit` → `vocabFormat`, mcq submit → `subType`.
`_srNormalize` 가 scores 자체 필드 우선 → 없으면 genTests 폴백.
앞으로 응시분은 시험 삭제돼도 배지 유지 + genTests fetch 줄어 reads↓.
이미 삭제된 옛 건은 소스 없어 복구 불가(불가피).

### 12) 결제관리 입금 체크 즉시 풀리던 버그 (commit `ffe9c8f`)

학원비 입금 체크 → 바로 지워짐. 원인: `_billingToggleChannel` 이 updateDoc
직후 `_renderBillingGrid()` (refetch=true 기본) → Firestore eventual
consistency 로 stale snapshot 받아 체크 풀린 상태로 덮음 + 메모리 캐시
미갱신. 2026-05-08 결제 패널서 고친 패턴이 이 토글 함수만 누락. 수정:
메모리 캐시(b — _billingsByMonth ref) 즉시 반영 + `_renderBillingGrid(0,{refetch:false})`.

### 13) attemptLabel Rules 충돌 — N회 라벨 안 뜸 (commit `3b4e369`)

문성미 '단어 Mr Brown' ~25회 응시인데 상세모달에 "N회 응시 중 X번째"
라벨 없음. 원인: `f913e49`(attemptLabel) 쿼리 `where(testId)+where(uid)+
orderBy(createdAt)` 에 academyId 정적 제약 없음 → scores Rules
(`academyId==myAcademyId`) 충돌 → permission-denied → catch → 라벨 ''.
**§9 _srLoadTestMeta 와 동일 함정을 신규 코드(f913e49)에 반복** — 수평전개는
기존 코드 대상이라 직후 작성한 신규에 작업규칙 미적용한 실수.
수정: 쿼리에 `where('academyId','==',s.academyId||MY)` + 인덱스
`scores(testId+uid+createdAt)` → `(academyId+testId+uid+createdAt)` 교체·
deploy·빌드. 옛 인덱스는 grep 전수 사용처 0건 확인 → `--force` 정리.

### 인덱스 무한 증가 우려 — 답변

Firebase composite index 한도 200/프로젝트(현 ~45). Console 에 사용 통계
**없음** — 사용 여부는 **코드 grep 으로 판별**(인덱스 정확 조합 ↔ 쿼리 대조,
prefix 규칙 고려). 애매하면 보존(인덱스 더 있어도 쿼리 안 깨짐, 삭제 실수가
더 위험). prefix 규칙: `[academyId,testId,uid,createdAt]` 1개가 academyId
단독·+testId·+uid 쿼리 모두 커버 → 잘 설계하면 인덱스 1개로 다수 쿼리 재사용.

---

## 작업 규칙 추가 (2026-05-16 이어서)

신규:
- **수평전개 후 작성하는 신규 코드에도 그 작업규칙 즉시 적용** — 수평전개는
  기존 코드만 점검. 직후 추가하는 코드가 같은 함정 반복 가능(f913e49 가
  _srLoadTestMeta 와 동일 Rules 함정 반복이 표본). 신규 쿼리 작성 시
  "academyId 검증 Rules 컬렉션이면 academyId 정적 제약" 체크리스트 적용.
- **Firestore 인덱스 사용 여부는 코드 grep 으로만 판별** — Firebase Console
  사용 통계 없음. 인덱스 정확 조합(academyId 유무·orderBy 유무·순서) ↔ 코드
  쿼리 1:1 대조 + prefix 규칙. grep 0건 = 안전 삭제 / 애매 = 보존. 쿼리
  교체 시 옛 인덱스 `--force` 정리(컬렉션 폐기 cleanup 3종 세트와 동일 맥락).
- **결제 등 토글 후 refetch:false + 메모리 캐시 즉시 반영** — `updateDoc`
  직후 `getDocs` refetch 는 Firestore eventual consistency 로 stale.
  토글류는 메모리 캐시(reference) 즉시 갱신 + `{refetch:false}` 로 캐시
  렌더(2026-05-08 결제 패널 패턴 — 신규 토글 함수마다 누락 없는지 확인).
- **`!genTest` 안내는 삭제 vs 레거시 분기** — `s.testId` 있는데 genTests
  없음 = 학원장이 삭제(scores 만 보존). testId 빈값 = 진짜 옛 레거시. 문구
  구분으로 학원장 "내가 삭제해서구나" 즉시 이해.

---

## 파일 크기 / SW 캐시 (2026-05-16 종료)
- `public/admin/js/app.js`: +~30줄 (_srLoadTestMeta getDoc·삭제문구·_srNormalize·결제토글·attemptLabel academyId)
- `public/js/app.js`: +~3줄 (vocab/mcq scores 메타)
- `firestore.indexes.json`: scores 인덱스 academyId+testId+uid+createdAt 교체 (옛것 --force 정리)
- SW 캐시: `kunsori-v540`

## 진행률 (2026-05-16 종료)
- 말하기 시험 userCompleted 버그·결과표시: ~100% (변동 없음)
- **성적리포트 배지·상세 표시: ~100%** (Rules 버그 fix·삭제문구·메타보존·attemptLabel)
- **결제관리 입금 체크: ~100%** (eventual consistency fix)
- 멀티테넌시·super 앱·브랜딩: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션 이어서, 2026-05-16)**:
- ✅ 성적리포트 배지 전멸 fix (_srLoadTestMeta in쿼리 → getDoc, Rules 통과)
- ✅ documentId in / academyId 제약 없는 쿼리 수평전개 (유일 사례 확정)
- ✅ 삭제 시험 vs 레거시 안내 문구 분기
- ✅ scores 에 speaking/grammar 메타 보존 (시험 삭제돼도 배지 — 신규 응시분)
- ✅ 결제관리 입금 체크 즉시 풀리던 버그 (refetch:false + 캐시)
- ✅ attemptLabel Rules 충돌 fix (academyId 추가 + 인덱스 교체·옛것 정리)
- ✅ 작업 규칙 — 신규코드 규칙 적용 / 인덱스 grep 판별·prefix / 토글 refetch:false / 삭제·레거시 분기

---

## 2026-05-17: Gemini 403/503 진단 (앱 정상) + preview 모델 GA 교체

코드 변경은 모델 교체 1건(commit `ffe537d`). 나머지는 진단·메모리.

### 1) Gemini 403/503 오류 진단 — 우리 앱 정상 확인

학원장 "Google AI Studio 에 403 매일 꾸준" 보고 → 전수 진단:

- **403 다수의 정체 = `ModelService.ListModels` (v1·v1beta)** — 우리 코드
  `ListModels` 호출 **0건**(grep 확인). 6개 API 모두 특정 모델명으로
  `:generateContent` 직접 호출(목록 조회 안 함). ListModels 403 은 Google
  AI Studio 웹 접속·외부 부산물 → **학생·학원장 앱 무관 노이즈**.
- **우리 앱(`GenerativeService.GenerateContent`)** = Vercel 3일 로그에
  `[check-word] ... retryable fail: 503 high demand` **1건뿐**.
  `all models failed` 류 **0건** → 그 503 도 폴백(재시도/2.5-flash)으로
  흡수 = 학생 실제 영향 0. 작업규칙8 정상 작동.
- 결론: **앱 Gemini 호출 건강**. Cloud Console 오류율 그래프가 높아
  보이는 건 ListModels 노이즈 포함 — GenerateContent 만 필터하면 거의 200.
- IP 제한 아님(API 키 애플리케이션 제한 없음 확인). 코드 조치 불필요.

### 2) preview 모델 GA 교체 (commit `ffe537d`)

`gemini-3.1-flash-lite-preview` 2026-05-25 종료 안내 → 후속 정식
`gemini-3.1-flash-lite` 로 **6곳 일괄 교체** (폴백 3순위 그대로 유지,
작업규칙8 동일 순서). 잔존 preview 0 + 6파일 `node -c` 통과.
- `api/generate-quiz.js`·`check-recording.js`·`cleanup-ocr.js`·
  `growth-report.js`·`scoresnap-grade.js`(+주석) + `scripts/admin/recover-recording-errors.js`
- `check-word.js` 는 원래 2모델(2.5-flash-lite/2.5-flash) — preview 미사용·영향 없음
- 클라(public/) 무변경 → SW bump 불필요 (api 서버리스는 Vercel 배포 즉시 반영)

### 3) 가격 비교 + 폴백 2순위 재배치 (다음 달 보류)

WebFetch 로 ai.google.dev 가격 확인 (per 1M tokens, 유료):

| 모델 | input | audio | output |
|------|-------|-------|--------|
| 2.5-flash-lite (현 1순위) | $0.10 | $0.30 | $0.40 |
| 2.5-flash (현 2순위) | $0.30 | $1.00 | $2.50 |
| 3.1-flash-lite (현 3순위) | $0.25 | $0.50 | $1.50 |

- 사용자 추정("RPM 차이뿐")과 달리 **단가 차이 큼**. 3.1 main 전환은
  비용 2.5~3.75배 → 부적절(현행 유지가 비용 최적)
- 그러나 **3.1-flash-lite < 2.5-flash 전 항목 저렴 + 신모델** → 2순위를
  2.5-flash → 3.1-flash-lite 로 바꾸는 옵션 B 합리적. 단 GA 직후 안정성
  우려로 **5/25 종료 후 1~2주 확인 후** 진행 — 메모리
  [project_gemini_fallback_reorder.md](memory/project_gemini_fallback_reorder.md) 등록

---

## 작업 규칙 추가 (2026-05-17)

신규:
- **Gemini 오류율 진단 시 메서드 구분 필수** — `ModelService.ListModels`
  (v1·v1beta) 403/503 은 우리 코드 0건 호출(특정 모델명으로
  generateContent 직접). Google AI Studio 웹·외부 부산물이라 앱 무관
  노이즈. 추적 대상은 **`GenerativeService.GenerateContent` 뿐**. Cloud
  Console 오류율이 높아 보여도 메서드 필터하면 GenerateContent 는 거의 200.
- **Vercel Runtime Log 는 휘발성 — 매일 발생 추적엔 부적합** — 과거 누적
  검색 약함. cold-start 마다 뜨는 DEP0169 만 보이고 드문 에러는 안 보일 수
  있음. API별 에러 로그 prefix 다름(`[check-word]`/`[check-recording]`/
  `Gemini ${model} error:`) — "Gemini" 단일 검색은 누락. 누적 추적은 Cloud
  Console 측정항목(메서드·응답코드별)이 정확.
- **외부 서비스 가격·모델 spec 은 WebFetch 로 공식 확인** — knowledge
  cutoff 후 자주 변동(특히 GA 직후 모델). 추측 단정 X
  ([[feedback_confirm_specs_before_work]]). ai.google.dev/gemini-api/docs/pricing.

---

## 파일 크기 / SW 캐시 (2026-05-17)
- `api/*.js` 5개 + `scripts/admin/recover-recording-errors.js`: 모델명 1줄씩 교체
- 클라·SW 무변경 (SW 캐시 `kunsori-v540` 유지)

## 진행률 (2026-05-17)
- Gemini 인프라: ~100% (앱 호출 건강 확인, preview→GA 교체로 5/25 종료 대비)
- 성적리포트·결제·말하기·멀티테넌시: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션, 2026-05-17)**:
- ✅ Gemini 403/503 전수 진단 — 앱 정상(403=ListModels 노이즈, 503=폴백 흡수)
- ✅ preview→GA 모델 교체 6곳 (5/25 종료 대비, 폴백 3순위 유지)
- ✅ 가격 비교 (WebFetch) + 폴백 2순위 재배치 메모리 등록 (다음 달 보류)
- ✅ 작업 규칙 — ListModels 노이즈 / Vercel 로그 휘발성 / 외부 가격 WebFetch 확인

---

## 2026-05-18: AI Generator 언스크램블 문장 직접 입력 (Wordsnap 패턴)

SW v540 → v541 (1 commit `b4516a4`). 단어시험 Wordsnap 처럼 언스크램블에도 본문 Page 선택 없이 영문장 직접 입력 → 청크 분할 + 한글뜻 자동 생성.

### 확정 spec (사용자 결정)
- 입력 형식: textarea **한 줄 = 1 영문장** (한글뜻 AI 자동 생성)
- 청크 분할: AI 호출 (원문 100% 보존 + 자연 청크 경계)
- 결과: 미리보기 모달 → 저장 (기존 언스크램블 흐름)
- "입력 내용 따라 다른 룰" = 줄바꿈 구분 영문장 리스트 형태 자동 처리

### 서버 ([api/generate-quiz.js](api/generate-quiz.js))
- 새 mode `'unscramble-from-text'` 분기 (homophones-only 패턴 동일 구조)
- `UNSCRAMBLE_FROM_TEXT_PROMPT` — VERBATIM 보존 강제, 청크 N±1, meaningKo 생성
- `handleUnscrambleFromText`:
  - sentences[] 검증 (3~400자, 최대 100문장, 중복 제거)
  - GEMINI_MODELS 폴백 체인 (작업규칙 8)
  - **원문 보존 검증** — chunkedSentence 의 `/` 제거 후 정규화(공백·대소문자) 비교
  - 변형 감지 시 **원문 단어 단위 N등분 강제** (AI 가 변형해도 원문 100% 보존)
  - 청크 누락 시도 동일 fallback

### 클라 ([public/admin/js/app.js](public/admin/js/app.js))
- `_qgBuildUnscrambleSnapSection` — UI (textarea + 📥붙여넣기 + 실행, Wordsnap 동일 디자인)
- `_qgParseSentences` — 줄당 1문장 (빈 줄 스킵, 중복 제거, 3~400자)
- `_qgUnscrambleSnapUpdateStatus` / `qgUnscrambleSnapPaste` / `qgRunUnscrambleSnap`
- type 분기 — 기존 `word→_qgBuildWordsnapSection` 에 `unscramble→_qgBuildUnscrambleSnapSection` 추가
- chunkCount 는 언스크램블 옵션 (`_qgCollectOpts('unscramble').chunkCount`) 값 사용
- `qgRunUnscrambleSnap` → `_qgShowResultModal` (기존 미리보기 흐름 재사용)

### qgSaveSet Book fallback (중요)
- 기존 `qgSaveSet` 의 sourcePages 는 `q.sourcePageId` 기반 — 직접 입력은 sourcePageId='' → bookId 빈값 → **미지정 폴더 저장 위험**
- fix: sourcePages 가 전부 빈 bookId/pageId 면 `_qgActiveBook` 단일 엔트리 생성 (Wordsnap qgRunWordsnap 패턴과 동일)
- 직접 입력 언스크램블 세트도 활성 Book 폴더에 저장됨

### 작업 규칙 추가
- **AI 직접 입력 원문 보존 패턴** — Wordsnap(단어) / 언스크램블(문장) 처럼 사용자 입력을 AI 가 가공할 때, AI 가 원문 변형하면 서버에서 검증(정규화 비교) 후 원문 기반 강제 재구성. AI 응답 신뢰 X, 입력이 ground truth.
- **AI Generator 직접 입력 = qgSaveSet Book fallback 필수** — sourcePageId 없는 직접 입력 세트는 sourcePages 비어 미지정 폴더로 빠짐. `_qgActiveBook` fallback 으로 활성 폴더 연결.

## 파일 크기 / SW 캐시 (2026-05-18)
- `api/generate-quiz.js`: +~130줄 (UNSCRAMBLE_FROM_TEXT_PROMPT + handleUnscrambleFromText)
- `public/admin/js/app.js`: +~150줄 (언스크램블 직접 입력 UI·파서·실행 + qgSaveSet fallback)
- SW 캐시: `kunsori-v541`

## 진행률 (2026-05-18)
- **AI Generator 직접 입력: ~100%** (단어시험 Wordsnap + 언스크램블 문장 입력)
- 음성 인식·동음이의어·AI 사용량·멀티테넌시: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션, 2026-05-18)**:
- ✅ 언스크램블 문장 직접 입력 (mode 'unscramble-from-text' + UI + 원문 보존 검증)
- ✅ qgSaveSet Book fallback (직접 입력 세트 미지정 폴더 방지)
- ✅ 작업 규칙 — AI 직접 입력 원문 보존 / qgSaveSet Book fallback

---

## 2026-05-18 (이어서): AI Generator/OCR Book 클릭 race + Chapter 이동 모달 재구성

학원장 신고 "AI Generator/OCR 에서 Book 클릭해도 Chapter/Page 종종 안 뜸"
→ lazy fetch race 진단 → 이동 모달 UX 종합 재구성. SW v540 → v546 (~5 commit).

### 1) Book 클릭 lazy fetch race + 조용한 실패 fix (commit `0756d82`)

증상: AI Generator(`qgSelectBook`)/AI OCR(`genClickBook`) 에서 Book 클릭
시 Chapter·Page 목록 종종 안 뜸.

원인 (둘 동일 패턴):
- **race**: async lazy fetch 중 다른 Book 클릭 → 늦게 온 옛 응답이
  엉뚱한 시점 concat+render → 빈 목록 (빠른/연속 클릭 시)
- **catch 조용히 삼킴**: `catch(e){console.warn}` — fetch 일시 실패 시
  빈 화면, 사용자 에러 인지 0

수정: 공용 `_genBookFetchToken` 세대 가드 — `++tk` 후 fetch, 완료 시
`tk !== 현재토큰`이면 return (최신 클릭이 render 담당). catch →
`console.error` + 토스트 + 옛 응답 에러 무시. 인덱스·Rules 정상 확인
(genChapters/genPages `academyId+bookId+order/serialNumber` 존재,
where academyId 동반 → Rules 통과 — _srLoadTestMeta 함정 아님).

### 2) Chapter 이동 모달 Book→Chapter 2단 + inline 생성 (commit `38538a4`·`987880a`·`9bd58f1`)

문제: lazy 라 Book 안 고르면 `_genChapters` 비어 "Chapter 없음" alert
→ 사용자가 딴 화면서 **중복 Chapter 생성**. 전체 chapter 노출은 학원
커지면 긴 목록·reads 증가로 비효율(사용자 우려).

데이터 근거: default Book 10 / Chapter 29 / Page 156 — Page 가 대용량.

해결 (사용자 제안 — 상위 선택→그 하위만 lazy, 전체 fetch X):
- **`genMovePages` 2단**: ① Book 선택(`_genBooks`) → ② 그 Book chapter
  lazy fetch(where bookId, race 가드) 목록
- 양 단계 항상 **inline 새 생성** ([+ 새 Book], [+ 이 Book 에 새 Chapter])
  → 이름 입력(Enter) → addDoc(bookId/bookName 자동) → 생성+즉시 이동
  (별도 화면 X, 중복·미지정 차단). `_genDoMove` 공용 헬퍼
- **`genMoveChapters`**(Chapter→Book) 도 inline 새 Book (생성 즉시 그
  Book 으로 Chapter 이동 — 1단)
- "없음" alert 차단 → 안내 + 생성 버튼. onclick 인라인 따옴표 →
  `data-*` 속성 패턴 (특수문자 안전)

효과: lazy 유지(학원 커져도 목록·reads 일정 — 항상 한 Book chapter),
중복 생성 근본 차단, 초기 사용자 직관(모달이 Book→Chapter 흐름 안내).

### 3) 이동 모달 리스트 최근순 통일 (commit `3141a86`)

genMovePages ① Book(이름순)·② Chapter(order순) → `_genRecentSort`
(updatedAt/createdAt 최근순). genMoveChapters Book 은 이미 최근순.
3곳 통일 → 방금 작업·생성 항목이 맨 위 (스크롤 불필요).

---

## 작업 규칙 추가 (2026-05-18 이어서)

신규:
- **async lazy fetch 는 세대 토큰 race 가드 필수** — Book 클릭처럼
  사용자가 빠르게 연속 트리거하는 async fetch 는 `const tk=++_token`
  후 fetch, 완료 시 `tk !== _token` 이면 return(최신 트리거가 render).
  옛 응답이 늦게 와 엉뚱한 render → 빈 목록 방지. catch 도 옛 토큰이면
  무시 + 현재 토큰일 때만 사용자 토스트.
- **lazy fetch ↔ UX 충돌은 "상위 선택 → 그 하위만 lazy + inline 생성"
  으로** — 전체 fetch(학원 커지면 긴 목록·reads↑) 도 아니고 lazy
  방치(안 보여 중복 생성) 도 아닌, 모달에서 상위(Book) 고르면 그
  하위(Chapter) 만 lazy + 없으면 그 자리 생성. 확장성·중복 차단 동시.
- **모달 내 동적 단계 전환** — showModal 정적 HTML + `<div id=...>` 영역
  innerHTML 교체(`_genMoveRefresh`)로 2단 흐름. 상태는 모듈 변수
  (`_genMoveBook`). window 함수로 onclick 노출.

---

## 파일 크기 / SW 캐시 (2026-05-18 이어서)
- `public/admin/js/app.js`: +~120줄 (race 가드 + Chapter 이동 모달 재구성·inline 생성)
- SW 캐시: `kunsori-v546`

## 진행률 (2026-05-18 이어서)
- AI Generator/OCR 안정성: **~100%** (Book 클릭 race fix + 이동 모달 종합 재구성)
- AI Generator 직접 입력: ~100% (변동 없음)
- Gemini 인프라·성적리포트·결제·말하기: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션 이어서, 2026-05-18)**:
- ✅ Book 클릭 lazy fetch race + 조용한 실패 fix (AI Generator·OCR)
- ✅ Chapter 이동 모달 Book→Chapter 2단 + 양 단계 inline 새 Book/Chapter 생성·즉시이동
- ✅ Chapter→Book 이동 모달 inline 새 Book
- ✅ 이동 모달 리스트 최근순 통일 (방금 작업 항목 우선)
- ✅ 작업 규칙 — async lazy race 가드 / lazy↔UX 충돌 해법 / 모달 내 동적 단계

---

## 2026-05-18 (이어서 2): 헤더 Version 표시 + 새로고침 버튼 7곳 토스트 피드백

학원장 "새로고침 눌러도 반응 없어 됐는지 모름" + "버전 보이게". SW v546 → v549 (~4 commit).

### 1) 헤더 Version 표시 (commit `8cb162f`·`565b89c`)

학원장 캐시 갱신 자가진단용 — 강력 새로고침 후 숫자 바뀌면 최신.
- `sw.js` message: `GET_VERSION` → MessageChannel 로 `CACHE_NAME` 회신
- `_app.html`: `#appVer` span — **우측 학원장 이름(`#adminName`) 앞**
  (default 학원장 계정명이 '큰소리영어'. 학원명은 좌측 로고 옆 별개)
- `admin app.js _showAppVersion()`: SW 질의 → `kunsori-v549` →
  `"Version 5.4.9"` (뒤1=patch / 그앞1=minor / 나머지=major).
  onAuthStateChanged 후 fire-and-forget
- SW 자체값 질의 → 클라 상수 어긋남 없이 정확

### 2) 새로고침 버튼 7곳 — 토스트 + 차등 캐시 무효화 (commit `7a8d40a`·`81d4723`)

증상: AI OCR/AI Generator/문제세트목록 등 ↺ 새로고침 눌러도 무반응.
+ 일부는 캐시 가드로 클릭해도 실제 갱신 안 됨 → 토스트만 달면 거짓 피드백.

**진단 후 차등 적용** (진입=기존 함수 직접·캐시활용 / 새로고침만 wrapper):

| 화면 | wrapper | 캐시 처리 (진단 근거) |
|------|---------|----------------------|
| AI OCR `genRefresh` | loadGenerator() | 항상 재fetch |
| AI Generator `qgRefresh` | `_genBooks/Chapters/Pages=[]` → loadQuizGenerate() | `_genBooks` 캐시 skip 이라 무효화 필요 |
| 문제세트목록 `qsRefresh` | `_qsInvalidateCache()` → loadQuestionSets() | 세트 캐시 `__initialized` 유지라 무효화 필요 |
| 진도체크 `progRefresh` | `delete _prog.testsByDate[date]` → progRenderByDate | 그 날짜 캐시 hit 라 무효화 필요 |
| 시험배정 `tpAssignRefresh` | _renderTestAssignDetail() | 매번 재fetch → 토스트만 |
| 대시보드 `dashRefresh` | initDashboard() | 학생수 getCount·시험·AI사용량·달력·공지 매번 fresh, 미납만 결제캐시(자동무효) → **토스트만, 광범위 무효화 X** (무효화 시 reads 폭증) |
| AI 사용량 `quotaRefresh` | loadQuotaUsage() | 매번 getDoc fresh → 토스트만 |

모두 "새로고침 중..." → "✅ 완료" 2단. _app.html 6곳 + app.js 1곳 onclick → wrapper.

핵심: 캐시 가드로 갱신 안 되던 곳만 무효화(거짓 피드백 방지), 이미
fresh 한 곳은 토스트만(불필요 reads 안 늘림 — 학원장 reads 정책).

---

## 작업 규칙 추가 (2026-05-18 이어서 2)

신규:
- **새로고침 버튼 = 진입 함수 그대로 쓰면 거짓 피드백 위험** — 캐시
  가드(lazy `__initialized` / `if(!_genBooks.length)` / `testsByDate[date]`)
  있는 함수는 새로고침 클릭해도 skip. 새로고침 전용 wrapper 가 해당
  캐시 무효화 후 재fetch + 토스트. **단 진단 먼저** — 이미 매번 fresh
  한 함수(getCount/매getDoc)는 무효화 불필요(reads 낭비), 토스트만.
- **대시보드류 복합 캐시는 광범위 무효화 금지** — 위젯별 캐시 정책
  상이(getCount 매번 / 결제 _billingsByMonth 캐시·자동무효 / 달력 매번).
  새로고침에서 통째 무효화하면 결제 fetch 폭증. 자체 무효(데이터 변경
  시) 에 맡기고 새로고침은 함수 재실행(거의 fresh) + 토스트만.
- **SW 버전 클라 노출 = SW 질의(MessageChannel)** — 클라 상수는 sw.js
  와 어긋남. `GET_VERSION` postMessage → `event.ports[0].postMessage
  (CACHE_NAME)`. 디버깅 목적엔 SW 실제값이어야 의미.

---

## 파일 크기 / SW 캐시 (2026-05-18 이어서 2)
- `public/admin/js/app.js`: +~60줄 (_showAppVersion + 새로고침 wrapper 7개)
- `public/admin/_app.html`: #appVer span + 새로고침 onclick 6곳 교체
- `public/sw.js`: GET_VERSION 핸들러
- SW 캐시: `kunsori-v549`

## 진행률 (2026-05-18 이어서 2)
- AI Generator/OCR 안정성: ~100% (변동 없음)
- 학원장 앱 UX 피드백: **~100%** (헤더 Version + 새로고침 7곳 토스트·차등 갱신)
- Gemini·성적리포트·결제·말하기: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션 이어서 2, 2026-05-18)**:
- ✅ 헤더 Version 표시 (우측 학원장 이름 앞, SW 질의 → "Version 5.4.9")
- ✅ 새로고침 버튼 7곳 — "중...→✅완료" 토스트 + 진단 근거 차등 캐시 무효화
- ✅ 작업 규칙 — 새로고침 거짓 피드백 방지 / 복합 캐시 광범위 무효화 금지 / SW 버전 질의

---

## 2026-05-18 (이어서 3): 단어시험 출제 형식 옵션 인쇄 모달과 통일 (B안)

학원장이 단어시험 **출제(배정) 형식 옵션에 혼란** 보고 — 출제 모달은
형식+방향+비율 **3축**, 인쇄 모달은 형식+슬라이더 **2개**라 멘탈 모델
불일치. 검토 후 사용자 B안 확정. SW v549 → v552 (3 commit).

### 1) 통일 설계 (B안)

출제(배정) 모달을 인쇄 모달과 동일 UX 로:
- **형식**: 혼합(랜덤) / 혼합(객→주) / 혼합(주→객) / 말하기(음성 인식)
- **객관식비율** 슬라이더 (0~100, 10단위) — 0%=전체 주관식 / 100%=전체 객관식
- **영→한비율** 슬라이더 — 0%=전체 한→영 / 100%=전체 영→한
- 말하기 선택 시 두 슬라이더 자동 비활성 (한글→영어 발음 고정)
- 독립 "주관식(스펠링)"/"객관식"/"방향 드롭다운" **제거** (슬라이더
  0%/100% 로 흡수 — 인쇄 모달이 이미 한 단순화)

**객→주 / 주→객 동작** (사용자 확인): 객·주 선택 자체는 비율 기반
**랜덤 유지**, 결정되는 건 표시 순서뿐. 객관식 배정 묶음 먼저(내부
셔플 순서 유지) → 주관식 묶음 나중. 주→객은 반대.

### 2) 구현 (commit `fd2a865`)

- **출제 모달 UI** (`tpOpenPublishModal`): 형식 select 4개 + 슬라이더
  2개. `_tpVocabFormatChanged` 가 말하기 시 `tpVocabRatioRow` 비활성
- **`tpPublish` vocabOptions**: `direction` 제거, `en2koRatio`(0~100)
  추가. `isFinite` 패턴(0 함정 회피). `mcqRatio` 도 슬라이더값
- **학생앱 `startVocab`**: 객·주 선택은 비율 랜덤 유지 +
  `mixed_mcq_first`/`mixed_short_first` 는 배정 후 그룹 정렬(안정
  정렬로 같은 그룹 내부 셔플 순서 유지, **questions·answers 인덱스
  동기**). speaking → 전부 speaking
- **하위호환** (기존 genTests 무변경): 학생앱이 폴백 매핑
  · 옛 format `short`→mcqRatio 0 / `mcq`→100 / `mixed`·`speaking` 그대로
  · 옛 `direction` `en2ko`→en2koRatio 100 / `ko2en`→0 / `mixed`·미설정→50
  · 이미 배정된 시험도 새 학생앱에서 정상 동작

### 3) 컴팩트 한 줄 배치 (commit `48a8f4a` → `cbb5829`)

사용자 요청 — 형식 select 와 슬라이더가 다른 줄로 wrap 되던 문제.
시험출제 모달 폭 **640 → 720px** 확대 + 형식 행 `flex-wrap:nowrap`
+ 슬라이더 110→100px + 라벨 `white-space:nowrap` →
`형식: [▾]  객관식비율: [━] 50%  영→한비율: [━] 50%` 한 줄 고정
(좁은 화면은 모달 94vw 축소 안에서 한 줄 유지). `tpVocabRatioRow`
는 `<span>` 으로 래핑(말하기 시 슬라이더만 비활성, 동작 동일).

---

## 작업 규칙 추가 (2026-05-18 이어서 3)

신규:
- **출제 모달 ↔ 인쇄 모달 동일 도메인 옵션은 UX 통일** — 같은
  개념(단어시험 형식/비율)을 두 화면이 다른 입력 방식(드롭다운 3축
  vs 슬라이더 2개)으로 노출하면 학원장 혼란. 슬라이더 비율 모델로
  통일. 학생앱은 비율 기반 랜덤 배정이라 슬라이더와 자연 호환.
- **데이터 모델 변경 시 학생앱 하위호환 폴백 필수** — vocabOptions
  처럼 이미 배정된 genTests 에 옛 필드(format='short'/'mcq',
  direction) 가 박혀있음. 마이그레이션 대신 학생앱 읽는 쪽에서
  신필드 우선 → 없으면 옛 필드 매핑. 기존 시험 무변경·즉시 호환.
- **순서 정렬 시 questions·answers 인덱스 동기** — `_vqState`
  의 answers[i] ↔ questions[i] 대응. 그룹 정렬 시 둘 다 같은
  order 로 재배열(한쪽만 reorder 하면 상세·채점 어긋남). 같은 그룹
  내부는 0 반환 안정 정렬로 셔플 순서 유지.

---

## 파일 크기 / SW 캐시 (2026-05-18 이어서 3)
- `public/admin/js/app.js`: ~동일 (옵션 UI 교체 + tpPublish + 모달 폭)
- `public/js/app.js`: +~20줄 (startVocab 신모델 파싱·하위호환·그룹 정렬)
- `public/sw.js`: v549 → v552
- SW 캐시: `kunsori-v552`

## 진행률 (2026-05-18 이어서 3)
- **단어시험 출제 옵션: ~100%** (인쇄 모달과 통일, 학원장 혼란 해소)
- 학원장 앱 UX 피드백: ~100% (변동 없음)
- Gemini·성적리포트·결제·말하기·AI Generator: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션 이어서 3, 2026-05-18)**:
- ✅ 단어시험 출제 형식 옵션 인쇄 모달과 통일 (B안 — 형식 4개 + 슬라이더 2개)
- ✅ 학생앱 startVocab 신모델 + 객→주/주→객 그룹 정렬 + 옛 데이터 하위호환
- ✅ 형식+슬라이더 한 줄 컴팩트 배치 (모달 폭 720, nowrap)
- ✅ 작업 규칙 — 출제↔인쇄 UX 통일 / 데이터 모델 변경 하위호환 / 인덱스 동기 정렬

---

## 2026-05-18 (이어서 4): 녹음숙제 상세 통일·최소화 + 말하기 3차 hang + check-word 503 대응 + Gemini 폴백 재배치

학원장 보고(녹음숙제 상세 경로마다 정보 다름) → 진단 → 통일·최소화.
이어 말하기 3차 먹통 진단·수정, 503 급증 대응, 폴백 재배치까지.
SW v549 → v558 (api 재배치는 SW 무관). 다수 commit.

### 1) 녹음숙제 학원장 상세 — 단일 공유 빌더로 통일 (`62c1c54`)

진단: 학원장이 보는 3경로가 각각 별도 렌더라 정보량 제각각 —
#1 시험관리/시험목록/진도체크학생별 풀카드(시간·말소리%·속도 O, note X),
#2 일자별 한 줄(요약), #3 성적상세모달(`_adminRecBuildDetail`, 시간만·
말소리%/속도 X). 학생앱 `_rv2RenderResult`(#4)는 점수 비공개 정책 준수 확인.

- `_adminRecBuildDetail(recordings, fullText, opts)` 단일 공유 빌더로
  통일 — 회차별 시간·말소리%·속도(WPM)·점수·note·AI피드백 모두 포함
- WPM용 fullText: `showScoreDetail` 이 `genTest.questions[0].fullText`
  → `comp._recFullText` 전달 / #1 은 `tqFullText` 전달
- `clickSafe` 옵션 — #1 카드는 부모 onclick(모달) 충돌 방지 stopPropagation
- #1 인라인 회차·AI피드백 코드 제거 → 공유 빌더 호출
- 부수: voiceActivity/duration 미보존 회차(재평가 등)는 "- · 말소리 -"
  로 3경로 동일 표시 (누락 투명화)

### 2) 진도체크·최근시험 녹음 카드 전체 최소화 (`8ac4729`)

사용자 결정(한 줄 유지+클릭 시 동일 모달): `isSubmittedWithRecs` 풀카드
폐기 — `opts.simpleRec` 조건 제거하고 **모든 녹음 제출 카드 한 줄**
(이름·📤제출됨·N점·날짜), 클릭 → #3 공유 모달. 다른 시험 유형 카드와
시각 통일. 옛 데이터·에러 카드는 이미 한 줄이라 변동 없음.

### 3) 성적 상세 모달 [🔁 재평가] 버튼 (`3f4b11e`)

한 줄 최소화로 카드의 재평가 진입점 소실 → showScoreDetail 풋터에
[🔁 재평가] 추가 (recording + recordings 있을 때만). 풋터
space-between (재평가 좌 / 닫기 우). `tpReEvaluateRecording` 호출.

### 4) 단어 말하기 3차 먹통 (안드로이드 SR→MR 핸드오프) — A·B

진단: 1·2차 SpeechRecognition(안드로이드 클라우드, 마이크 점유) →
3차 `getUserMedia`(MediaRecorder) 전환 시 마이크 해제가 150ms 안에
안 끝나 **getUserMedia 가 응답·reject 없이 hang** → 버튼 disabled +
busy=true + attempt=MAX → 영구 먹통·복구 불가. 안드로이드 고유(iOS 무관).

- **A안 (`a91ba7b`)**: `_gumWithTimeout` — getUserMedia 4초 타임아웃
  (늦게 도착 stream track stop). hang 시 busy 해제·버튼 복구·attempt
  롤백(재시도 허용)·finalize 안 함(잠그지 않음)
- **B안 (`a50f7dd`)**: 2차+ SR 마이크 해제 대기 150ms→400ms (hang 예방).
  SR 은 stream 미노출이라 abort()+대기로만 보장

### 5) check-word 503 대응 — 타임아웃 9초·B-1 (`75cab80`)

503 급증(Vercel 로그 30분 26건)으로 단어말하기 AI 폴백이 5초 초과 →
서버는 200 성공인데 클라가 5초에 포기 → **억울한 오답 다발**(로그 16초
케이스 확인). 단어말하기 5초 / 녹음숙제 30초 차이로 단어말하기만 취약.

- check-word fetch 타임아웃 5000ms → **9000ms**
- 5초 경과 시 진행 메시지 "AI 응답이 늦어지고 있어요" 추가 (3단계)
- 9초 초과(AbortError) → 오답 처리 X. `_vqSpkAllowRetry`: busy 해제
  + attempt 롤백 + aiTried 리셋 + blob 폐기 → "다시 시도" + 재녹음 가능
  (B-1, getUserMedia hang 복구 A안과 동일 패턴)
- AI 재배치는 이때 보류 결정 → 진단 후 §7 에서 실행

### 6) AI 의존도 진단 스크립트 신규

`scripts/diag/analyze-speaking-ai-dependence.js` — 말하기 답안 중
`spkSource`(webspeech/ai/ai-error) 비율 + `spkAttempts` 분포, 기간
필터(`--days` / `--from`/`--to` KST), `--academy`/`--top`. 데이터 한계:
userCompleted 통과 응시만(작업규칙7), 타임아웃 B-1 케이스 미기록.

측정 결과:
- 14일: AI 도달 11%(미상 48% 희석) / 3일: **AI 도달 21.6%**(미상 2.2%
  깨끗) / 당일: **22.1% + AI 서버오류 3→5% 상승**
- 결론: AI 의존도 ~22% 높은 편 + 503 악화 추세 → 폴백 재배치 실행 근거

### 7) Gemini 폴백 2순위 재배치 (`39ef11f`) — 보류 → 실행

사용자 결정("모두 해놓고 결과 판단"). 메모리
[project_gemini_fallback_reorder.md](memory/project_gemini_fallback_reorder.md)
옵션 B 를 503 급증 + 진단 근거로 앞당겨 실행:

- `2.5-flash-lite → 2.5-flash → 3.1-flash-lite`
  ⇒ **`2.5-flash-lite → 3.1-flash-lite → 2.5-flash`**
  (generate-quiz/check-recording/cleanup-ocr/growth-report +
  recover-recording-errors)
- check-word(2모델): `2.5-flash-lite → 2.5-flash`
  ⇒ `2.5-flash-lite → 3.1-flash-lite` (속도·비용 민감)
- scoresnap-grade(Vision): 1순위 2.5-flash 유지, 2·3 재배치
  ⇒ `2.5-flash → 3.1-flash-lite → 2.5-flash-lite`
- 근거: 3.1-flash-lite 가 2.5-flash 보다 전 항목 저렴+빠름. 2.5-flash
  3순위 강등(audio 비용 큼, 1·2 동시 장애 시만). api 전용 → Vercel
  즉시 반영, SW bump 불필요. 코드 주석 갱신(작업규칙8 본문은 차기 정리)

---

## 작업 규칙 추가 (2026-05-18 이어서 4)

신규:
- **여러 화면이 같은 데이터를 별도 렌더하면 단일 공유 빌더로** — 녹음
  상세 3경로(#1 카드/#3 모달)처럼 정보량 드리프트 발생. 한 빌더 +
  옵션(clickSafe 등)으로 통일. 요약 카드(#2)는 클릭→공유 모달로 일관.
- **안드로이드 SR→MediaRecorder 핸드오프 = getUserMedia hang 위험** —
  SpeechRecognition(안드로이드 클라우드)이 마이크 점유, 해제 비동기·느림.
  전환 전 abort()+충분한 대기(≥400ms) + getUserMedia 타임아웃 래퍼 필수.
  iOS(온디바이스 SR)는 무관 — 플랫폼별 별개 이슈 혼동 주의.
- **latency-critical 클라 타임아웃은 초과 시 벌점 금지** — check-word
  5초처럼 짧은 타임아웃은 503 폴백 초과 시 서버 성공분도 버려 억울한
  오답. 타임아웃 = "여기까지 기다림" 일 뿐, 정답/오답 가르는 선 X →
  초과 시 재시도(B-1)로 복구. 숫자 키우기보다 벌점 제거가 핵심.
- **503 = 구글측 모델 용량(transient), 우리가 못 고침** — 대응은
  재시도·폴백·타임아웃·벌점제거. 모델별 절대 빈도는 Vercel 로그/Cloud
  Console 이 정확(Firestore 는 통과분만이라 과소). 의존도 추세는 진단
  스크립트로 며칠 관찰 후 재배치 등 결정.
- **api 전용 변경은 SW bump 불필요** — Vercel 서버리스 즉시 반영.
  클라(public/) 무변경 시 SW 캐시 버전 안 올림 (5/17 preview→GA 선례).

---

## 파일 크기 / SW 캐시 (2026-05-18 이어서 4)
- `public/admin/js/app.js`: 녹음 상세 통일(공유 빌더)·최소화·재평가 버튼 (~-30 순감)
- `public/js/app.js`: 말하기 3차 hang A·B + check-word 9초·B-1 (+~50)
- `api/*` 6개 + `scripts/admin/recover-recording-errors.js`: 폴백 체인 재배치
- `scripts/diag/analyze-speaking-ai-dependence.js`: 신규 ~150줄
- SW 캐시: `kunsori-v558` (api 재배치는 SW 무관)

## 진행률 (2026-05-18 이어서 4)
- 녹음숙제 학원장 상세: **~100%** (3경로 단일 빌더 통일·전체 최소화·재평가 모달)
- 단어 말하기 안정성: **~95%** (3차 hang A·B + check-word 9초·B-1·폴백 재배치. 추세 관찰 중)
- Gemini 폴백: **재배치 완료** (후속 추세 관찰만)
- Phase 5 출시 준비: 0%

**완료 (이 세션 이어서 4, 2026-05-18)**:
- ✅ 녹음숙제 학원장 상세 3경로 단일 공유 빌더 통일 (`62c1c54`)
- ✅ 진도체크·최근시험 녹음 카드 전체 한 줄 최소화 (`8ac4729`)
- ✅ 성적 상세 모달 [🔁 재평가] 버튼 (`3f4b11e`)
- ✅ 말하기 3차 getUserMedia hang — A(타임아웃 복구) `a91ba7b` + B(핸드오프 대기 400ms) `a50f7dd`
- ✅ check-word 타임아웃 5→9초 + 늦음 안내 + 9초 초과 시 재녹음(B-1) `75cab80`
- ✅ AI 의존도 진단 스크립트 신규 + 측정 (3일 AI 도달 21.6%, 서버오류 3→5%)
- ✅ Gemini 폴백 2순위 재배치 (2.5-flash→3.1-flash-lite, 6+1곳) `39ef11f`
- ✅ 메모리 project_gemini_fallback_reorder 완료 갱신 + MEMORY.md 인덱스
- ✅ 작업 규칙 — 공유 빌더 / 안드 SR→MR hang / latency 타임아웃 벌점금지 / 503 본질 / api SW bump 불필요

---

## 2026-05-19: Firestore 색인 최적화 — 작업지시서 검증 후 1/3만 적용

외부 작업지시서 (`firestore-indexes-optimization-tasks.md`, 다른 LLM 이 Firebase 쿼리 통계 보고 작성) 받아 검증·진행. 코드 무수정 (색인 파일만). commit `91c40c4`.

### 지시서 검증 — 3개 진단 중 2개가 코드와 불일치

| 지시서 진단 | 실제 코드 검증 | 결정 |
|------|------|------|
| `(academyId, testId, reEvaluated)` 효율 128.10 | **운영 코드 아님** — `scripts/diag/test-length-vs-scores.js` 진단 스크립트 1회용. genTests 루프에서 시험마다 호출 ("12회 실행"=시험 12개). scores.reEvaluated 는 adminAction.js:199 재평가 시 박힘이나 adminAction 은 add only·쿼리 X | **제외** |
| `(academyId, mode, userName)` 효율 71.70 | **userName where 0건** (grep). 성적 리포트 이름검색은 `_srBuildConstraints` 가 academyId+date+mode 로 fetch (색인 매칭 ✓) 후 클라 측 `scoreSearch` 필터. userName server-side X. Firebase 통계 추론 표기 오류 | **제외** (영원히 미사용) |
| `(academyId, testId)` 효율 9.10 | **운영 실재** — 6619 `tpToggleTestProgress` (시험 진행현황 펼침), 6409 `_tlLoadScoresForTests` (진도체크/시험목록 통계). `academyId==+testId==` (orderBy 없음) 정확 매칭 색인 부재 → Firestore 가 academyId 단일 색인 선택 → 학원 점수 전체 받아 testId 메모리 필터 (664 받아 73 사용) | **적용** |

→ 지시서대로 3개 다 넣었으면 2개는 죽은 색인 (슬롯 낭비 + 혼란). 지시서의 "운영 read 5,000/주" 는 `scripts/diag/` 진단 스크립트 1회 실행분 포함으로 부정확.

### 적용 — scores `(academyId, testId)` 2-field 색인 1개

```json
{ "collectionGroup": "scores", "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "academyId", "order": "ASCENDING" },
    { "fieldPath": "testId", "order": "ASCENDING" }
  ]
}
```
- 기존 색인 #1 (`academyId+testId+uid+createdAt`, 4-field) 그대로 유지 — 5182·13226·5340 (uid 쓰는 쿼리) 가 계속 사용. 추가만, 삭제 X
- 효과: 시험 진행현황 펼침 / 시험별 통계 read **1/9 절감**. 학원 점수 누적 많을수록 격차 ↑
- `firebase deploy --only firestore:indexes` 완료 (46 인덱스, scores 9개)
- 검증 가이드: [docs/firestore-indexes-2026-05-19.md](docs/firestore-indexes-2026-05-19.md) (3일 후 쿼리 통계 재확인)

### pushNotifications (Step 2 — 보고만)
- 4516/4517 `getCountFromServer(academyId+sent)` — 페이지 진입당 2회 COUNT (비용 0, setInterval 아님)
- 168회/7일 = 24/일 = 학원장 대시보드+메시지 진입 빈도. 색인 충분 → 조치 불필요 (지시서 결론과 일치)

### 작업 규칙 재확인 (2026-05-02 TASK-4/10 정립분 강화)
- **외부 작업지시서 = 출발점, 검증 필수** — 청구 내용 vs 실제 코드/데이터 대조 → 불일치 보고 → 확정 후 진행. LLM 생성 지시서는 Firebase 통계 추론 오류·진단 스크립트 혼입·컬렉션 혼동 가능. 임의로 지시서 안 따름
- **사용자가 "현재 상황 고려" 명시 = 이 검증 단계 트리거** — 일반론을 이 프로젝트의 멀티테넌시 구조(academyId 격리·색인 prefix 규칙·scripts/diag 분리)에 대조
- **Firebase 쿼리 통계 ≠ 운영 비용** — `scripts/diag/` 진단 스크립트 실행분도 통계에 집계. 필드명도 색인 추론으로 실제 where 와 다를 수 있음. 통계 → 코드 grep 검증 필수

## 파일 크기 / SW 캐시 (2026-05-19)
- `firestore.indexes.json`: +1 색인 (scores academyId+testId), 총 46개
- `docs/firestore-indexes-2026-05-19.md`: 신규 결과 보고서
- 코드(public/·api/) 무수정 — SW bump 없음

## 진행률 (2026-05-19)
- **Firestore 색인 최적화: ~95%** (운영 실재 비효율 1건 해결. reEvaluated 진단스크립트용은 보류)
- 음성 인식·동음이의어·AI Generator·멀티테넌시: 변동 없음
- Phase 5 출시 준비: 0%

**완료 (이 세션, 2026-05-19)**:
- ✅ 작업지시서 검증 — scores 쿼리 10곳 + pushNotifications 전수 분석
- ✅ scores (academyId, testId) 색인 추가 + 배포 (운영 1/9 절감)
- ✅ 지시서 진단 2건 (reEvaluated/userName) 코드 불일치로 제외
- ✅ 결과 보고서 docs/firestore-indexes-2026-05-19.md
- ✅ 작업 규칙 — 외부 지시서 검증 필수 / Firebase 통계 ≠ 운영 비용

---

## 2026-05-19 (이어서): 단어 말하기 채점 — 닫힌후보 가드 + 발음코드 (인식 불만 대응)

Web Speech 인식 불안정으로 억울한 오답 불만 ↑. STT 도입 검토했으나
**STT 15초 최소과금 → 단어시험엔 Gemini-lite보다 오히려 비쌈**(월 수백$)
으로 폐기. Web Speech는 인식단계 편향 불가 → **채점(인정) 단계 편향**으로 해결.
commit `9f2a03a`, SW v558→v559.

### 적용 (1번 + 3번)

`public/js/app.js _spkGradeAnswer` 재작성:
- **1번 닫힌후보 가드**: 들린 단어를 "이 시험의 모든 단어(allWords)"와 비교.
  정답군 최고유사도(bestG)가 다른 시험단어 최고(bestO)를 마진 이상
  앞설 때만 인정. 강한매칭 `bestG≥임계 & gap≥0.15` / 임계미만 구제
  `bestG≥0.45 & gap≥0.30`. → 무의미·다른시험단어·충돌은 거부
- **3번 발음코드**(metaphone-lite `_spkPcode`): cereal≈serial 등 철자
  달라도 소리 같으면 가드 안 유사도(0.92)로 반영. **단독 통과 불가**
  (cat/cot 등 false positive 억제 — 가드가 최종 관문)
- 정확일치 후보(동음이의어/발음변형)가 **다른 시험단어와 겹치면 후보
  제외** — light/right 같은 충돌 false positive 원천 차단 (검증 핵심)
- 호출부: `_vqState.questions` 단어목록을 allWords 로 전달.
  accentVariants(2번) 인자는 받되 데이터는 후속
- 검증: `scripts/diag/test-spk-grading.js` **14/14 통과** (억울한 오답
  해소 + 엉뚱/다른단어/충돌 전부 차단 — 사용자 핵심 우려 확인)

### 비용 비교 검증 (WebFetch 공식 확인)

- Gemini 25토큰/초, lite 오디오 $0.30/1M·출력 $0.40/1M → check-word
  1회 ≈ $0.0001 (거의 공짜)
- STT 실시간 ~$0.016/분 **15초 최소 올림과금** → 단어 3초도 15초 청구
  → STT 1회 ≈ Gemini 40배. **단어시험엔 STT가 비싼 안** (직관과 반대)
- 결론: 현행(거의 $0) < A(전부 AI ~$15, 503 6~7배) ≪ B(STT ~$수백)
  → 비용·안정성 모두 채점 가드(이번 작업)가 정답

### 후속 (미완)

- **2번 AI 발음변형(accentVariants)**: homophones 생성 파이프에 얹어
  단어별 "한국식 ASR 오인식 변형"(R/L·F/P 등) 생성·저장. 1번 가드 위에서만
  작동(겹치면 제외)이라 안전. 1번 효과 데이터 보고 필요시 추가
- 효과 관찰: `analyze-speaking-ai-dependence.js` / `analyze-speaking-errors.js`

### 작업 규칙 추가 (2026-05-19)

- **인식 불안정은 인식단계 아닌 채점단계에서 편향** — 브라우저 Web Speech는
  phrase hint 불가. "정답이 시험 내 다른 단어보다 확실히 더 닮았는가"
  닫힌후보 비교가 STT phrase-hint 효과를 채점에서 무료·안전하게 모사
- **인정 편향 추가 시 닫힌후보 가드 필수** — 동음이의어·발음변형·발음코드
  어느 것도 단독 통과 X. 다른 시험단어와 겹치는 후보는 제외. false
  positive("엉뚱한 답 정답처리")는 합성 테스트(test-spk-grading.js)로
  배포 전 검증
- **STT 15초 최소과금** — 짧은 단어 음성판정엔 Gemini-lite보다 비쌈.
  "STT가 싸다"는 일반 통념이 단어시험엔 반대 (공식 가격 WebFetch 확인)

---

## 2026-05-19 (이어서 2): 말하기 부적합 단어 출제 게이트 + 1음절 휴리스틱 폐기

roll·up 류 ASR 한계 단어는 1번 가드로도 한계 → 출제(배정) 단계에서
걸러내는 게이트 도입. SW v558→v567 (commit `83239e5`·`a0598f5`).

### 1) 말하기 부적합 단어 배정 전 게이트 (`83239e5`, SW v566)

vocab+speaking 출제 시 [배정하기] 클릭 → 배정 전 부적합 단어 목록 모달
(단어·사유·🗑삭제). 학원장이 삭제하면 `questions` in-place splice 후 진행.
- `api/generate-quiz.js` `mode === 'speaking-unfit-check'` 분기 +
  `SPEAKING_UNFIT_PROMPT` + `handleSpeakingUnfit` (homophones-only 패턴).
  quota/increment 는 상단에서 모든 mode 공통 — **generator 카운터**
- 클라 `_tpSpeakingUnfitReasons`(휴리스틱) + `_tpSpeakingUnfitGate`(모달,
  `_geminiFetch`, `_tpUnfitDel`/`_tpUnfitClose`), `tpPublish` 주입
  (`_fillMissingHomophones` 뒤, vocab+speaking 만). 0개 남으면 배정 차단

### 2) 1음절 휴리스틱 폐기 → AI hardForASR (`a0598f5`, SW v567)

`wild`·`soft`·`feel`·`claim` 등 정상 단음절이 '1음절' 휴리스틱에 과다
표시(roll(나쁨) vs wild(좋음) 구분 불가) → 사용자 결정 "1":
- 휴리스틱 = **`3글자 이하`만** (up·be·go 객관 극단)
- `SPEAKING_UNFIT_PROMPT` 에 `hardForASR` boolean 추가 — 한국 학생 발화
  시 ASR 오인식 위험 높은 음향적 빈약·모호 단어(roll·up·be·err·owe)만
  true, wild·soft·claim = false, **애매하면 false(과다표시 금지)**
- 모달 사유 라벨 `ASR 인식 어려움` (의성어·사전없음과 함께)

### 작업 규칙 추가 (2026-05-19 이어서 2)

- **휴리스틱이 정상/위험을 못 가르면 폐기하고 AI 판단으로** — '1음절'
  처럼 정상 단어(wild)와 위험 단어(roll)가 같은 특징을 공유하면 그
  휴리스틱은 노이즈. 객관적 극단(3글자 이하)만 코드, 미묘한 판단은 AI
  (애매하면 false 로 과다표시 억제 지시 필수)
- **부적합 단어는 채점 보정 아닌 출제 단계 차단** — roll 류 ASR 한계
  단어는 채점 가드(1번)·발음변형(2번)으로도 한계. 출제 시 학원장이
  보고 빼는 게이트가 가장 확실. 채점 편향과 별개 레이어

### 후속 / 보류

- 2번 accentVariants — [memory/project_speaking_accent_variants.md] 등록.
  말하기 인식 불만 재발 시 트리거 (1번+게이트 효과 관찰 후)

## 파일 크기 / SW 캐시 (2026-05-19 이어서 2)
- `api/generate-quiz.js`: +~80줄 (speaking-unfit-check + hardForASR)
- `public/admin/js/app.js`: +~90줄 (게이트 모달·휴리스틱·tpPublish 주입)
- SW 캐시: `kunsori-v567`

---

## 2026-05-19 (이어서 3): 진도체크 학생제외 재조회 0회 + 출제옵션 기본값 변경 + 폴백 진단

SW v567→v569 (commit `bac6bd8`·`376b576`). 운영 점검 + UX/기본값 정비.

### 1) 진도체크 학생 제외 시 재조회 0회 — A-1 (`bac6bd8`, SW v568)

증상: 일자별 반별 진도체크에서 학생 카드 ✕(제외) 누를 때마다
`tpExcludeStudent` 끝의 `tpToggleTestProgress` 2회(닫고 다시 = Firestore
재조회) → 한 명 지울 때마다 그 시험 학생현황 전체 재조회.

사용자 결정 흐름: 방법 A(재조회 폐기·카드만 처리) vs B(배치 확정) →
A 선택 → "삭제 대기로 희미하게" 제안 → A-1(즉시 삭제 쓰기 + 카드 희미)
vs A-2(진짜 대기·일괄 확정) → **A-1 확정**.

- ✕ 클릭 → 삭제 쓰기(excludedUids·userCompleted·scores) 즉시 실행(현행),
  확인 모달 학생당 1번(현행)
- `tpToggleTestProgress` 2회 호출 **폐기** → 그 카드만 opacity 0.4 +
  취소선 + grayscale + pointer-events:none, ✕ 버튼 제거
- ✕ 버튼 3곳(일반/통과/녹음 카드) `tpExcludeStudent(...,this)` 로 btnEl
  전달 → `btnEl.parentElement` 직접 dim. btnEl 없을 때만 옛 재조회 폴백(안전망)
- 효과: 여러 명 지워도 **재조회 0회**. 통계·목록은 그 시험 다시 펼칠 때 갱신
- tp(시험관리)·tl(시험목록)·pd(진도체크 일자별) 3경로 공통 적용

### 2) 출제옵션 기본값 변경 (`376b576`, SW v569)

신규 배정분에만 적용 (사용자 컨펌: 이전 출제분은 그때 옵션대로 유효, 폴백 미변경):
- 녹음숙제 **최소시간** 기본 `?? 60` → `?? 20` 초 ([app.js:13514](public/admin/js/app.js))
- 단어 말하기 **엄격도** 기본 `normal selected` → `lenient selected` +
  저장 폴백 `|| 'normal'` → `|| 'lenient'` ([13586/13729](public/admin/js/app.js))
- 미설정/옛 시험 클라 폴백(`speakingStrictness || 'normal'` 4곳,
  cfg `minDurationSec:60`)은 **그대로** — 기존 시험 채점기준 불변(의도)

### 3) 진단 — Vercel 로그 분석 (코드 변경 없음)

- check-word 503 1건: `2.5-flash-lite` 503 → `3.1-flash-lite` 200, 4.2s
  < 9s 타임아웃 → 5/18 폴백 재배치·타임아웃이 받쳐준 **정상 성공** (조치 X)
- 녹음숙제 24h 42건 중 14건 폴백, **503 없음** → 원인은
  `gemini-2.5-flash-lite` 200 응답인데 **JSON 파싱 실패**(스키마 무겁고
  `maxOutputTokens:3000`+`temperature:0.9` 로 출력 잘림 → `_salvageTruncated`
  복구 실패 → 같은모델 1회 재시도 → 다음 모델). 첫 200 호출 비용 청구·폐기
- check-recording 폴백 조건 = (a) isRetryable HTTP(503/429/404) 또는
  (b) 200 인데 parse 실패. 503 없으면 (b) 가 지배
- **보류(컨펌 대기)**: 옵션 A(`maxOutputTokens` 3000→5000~6000, 잘림 근본
  해소·temperature/피드백 정책 불변) 권장. 14건 첫 상태 200 확인 후 진행 예정

### 작업 규칙 추가 (2026-05-19 이어서 3)

- **재조회 없이 카드만 처리 패턴** — 행 단위 삭제/제외 후 전체 재조회
  (`tpToggleTestProgress` 2회 등) 대신 btnEl→parentElement 직접 dim.
  여러 건 처리 시 reads 0. 통계는 다음 펼침 때 갱신(허용). btnEl 폴백 유지
- **기본값 변경은 신규 배정분만, 폴백 불변이 기본 안전** — 출제 모달
  default 만 바꾸고 미설정/옛 데이터 클라 폴백은 두면 기존 시험 채점기준
  불변. 폴백까지 바꾸려면 별도 컨펌(이미 응시분 영향)
- **폴백 ≠ 실패, 503 ≠ parse-fail** — Vercel 로그 폴백 진단 시 첫 호출
  상태코드 필수 확인. 503/429=구글 용량(우리 못 고침), 200 후 폴백=출력
  잘림(우리가 maxOutputTokens 로 고침). 최종 200 이면 학생 영향=속도뿐

## 파일 크기 / SW 캐시 (2026-05-19 이어서 3)
- `public/admin/js/app.js`: +~15줄 (tpExcludeStudent dim + 기본값)
- `public/sw.js`: v567 → v569
- SW 캐시: `kunsori-v569`

---

## 2026-05-20: 공지 다중 첨부·만료일 + 언스크램블 난이도 재정의 (정정 1회)

SW v569→v570 (1회 bump, 공지). 언스크램블 변경은 api 전용 — SW bump 없음.

### 1) 공지관리 파일 첨부 (commit `ea4d6b5`, SW v570)

자료실·메시지와 동일 정책으로 공지에도 첨부 — 단 다중·만료일 사용자 지정.

**학원장 (공지 작성·수정 모달):**
- 📅 만료일 `<input type="date">` (기본 오늘+30일) — 학원장 자유 변경
- 📎 다중 첨부 — 드래그&드롭 또는 클릭. 파일별 ✕ 제거
- 검증: 파일당 20MB / PDF·Office·한글·이미지·텍스트 화이트리스트
- 수정 모달은 기존 첨부 prefill (status:'done' + url, 새 파일만 저장 시 업로드)
- 안내문 박스: 허용 형식·Storage 1년 자동삭제 명시

**학생 (공지 화면):**
- 공지 상세에 첨부 다운로드 버튼 N개 (📄 파일명·크기·↓)
- "📎 N개 · YYYY-MM-DD 까지 다운로드 가능" 안내
- **만료 후**: "🔒 첨부 파일 보관 만료 (YYYY-MM-DD 까지였음)" — 다운로드 차단
- 목록(홈/전체): 제목 옆 📎 (만료면 🔒)

**Storage·인프라:**
- `notices/{academyId}/*` 경로 (storage.rules 에 이미 깔려있음 — 2026-05-02 미리 보강)
- `scripts/admin/set-notice-attachments-lifecycle.js` 신규 (365일 GCS lifecycle 안전망)
  - 사용자 지정 만료일은 학생앱 표시·차단용. Storage 자체는 1년 안전망. 객체별 정확 만료는
    GCS Lifecycle 로 불가(일률 N일 룰만 가능) — cron 별도 인프라 필요. 베타엔 1년 안전망 단순
- `--apply` 적용 완료 (기존 lifecycle: recordings 60일·messageAttachments 10일 + notices 365일 → 3개)

**데이터 모델 (notices doc):**
- `expiresAt: Timestamp` 추가
- `attachments: [{ url, name, sizeKB }, ...]` 추가 (배열 — 메시지는 단수 `attachment` 와 분리)
- 옛 공지(이 필드 없음)는 그대로 표시 — 첨부 영역 안 보임, 호환

**구현 — 메시지 패턴 재사용**:
- `_msgAttachAllowed(type)` 화이트리스트 검증 헬퍼 그대로 재사용
- 헬퍼 5종 (`_noticeRenderAttaches`/`_noticeAcceptFile`/`_noticeUploadAll`/`_noticeClearAttaches`/`_noticeAttachBoxHtml`) + window 4종 (`noticePickAttach`/`noticeRemoveAttach`/`noticeDragOver`/`noticeDragLeave`/`noticeDrop`)
- 학생앱: `_noticeAttExpired(n)`/`_noticeAttExpYmd(n)`/`_noticeAttachmentsHtml(n)` 3종 신규

### 2) 언스크램블 난이도 한 단계씩 쉬운 쪽으로 재정의

학생들이 어렵다 평가 → 사용자 결정: 현재 중→상, 하→중, 새 하=쉽고 고빈도. 단 처음
7개 유형 모두 적용했다가 사용자 정정("언스크램블만") 으로 6개 원복, 언스크램블만 유지.

**최종 언스크램블 새 정의** (commit `60f66ab` → `b805afb` 정정 후, [api/generate-quiz.js:421](api/generate-quiz.js#L421)):
- 하 (NEW) = ≤8단어, 초등~중1 고빈도 단어만 (800-1000 word range)
- 중 (NEW) = 8-12단어, 단순 문법 + 일상 기본 단어 (기존 하)
- 상 (NEW) = 10-14단어, 일반 문법 + 일상 어휘. **관계절·분사구문 금지, 희귀/고급 단어 금지** (기존 중)
- 옛 상(긴 문장 + 복잡 구조) **폐기**

UI 라벨(상/중/하) 그대로 유지 — 학원장 같은 select 로 자동 한 단계 쉬운 출제 적용.
옛 출제분(이미 박힌 difficulty 필드)은 그때 정의대로 표시·풀이됨, 무관.

**나머지 6개 유형(vocab Type B / recording / MCQ-content / MCQ-grammar / subjective / fill_blank) — 원래 정의 그대로 유지** (사용자 의도).

**원인 — 사용자 의도 오해**:
- 사용자 흐름: "언스크램블 난이도?" → "어휘 수준은 어떻게 판단?" → "단어는 본문 안에만?" → "추천한 방식을 하로"
- 직전 추천(B안)은 "5개 유형 모두 강화"였으나 사용자는 줄곧 언스크램블 맥락
- "추천한 방식" = 'B안의 정신(쉬운/고빈도 단어)을 언스크램블 하에 적용'으로 봐야 했음. **맥락 끝까지 명확히 — 한 도메인 안 결정인지 전체 일괄인지 컨펌 필수**

### 작업 규칙 추가 (2026-05-20)

신규:
- **"전체 유형 일괄 적용" vs "현재 맥락 한 유형만" 구분** — 사용자가 특정 유형(언스크램블)
  맥락에서 난이도·옵션 변경을 지시하면 그 유형만으로 한정. "B안 추천=5개 유형 강화" 같이
  내가 직전에 제시한 옵션이 광범위해도 사용자 채택 시점 발화 ("추천한 방식을 하로") 가 좁은
  맥락(언스크램블)이면 좁게 해석. **확장 적용은 별도 컨펌**. [feedback_confirm_specs_before_work]
  의 강한 적용 사례.
- **객체별 정확 만료는 GCS Lifecycle 로 불가 — cron 필요** — `notices/expiresAt` 같이 doc 별
  사용자 지정 만료일은 일률 lifecycle 룰(`age: N`)로 못 따라감. 정확 정리 원하면 Vercel cron
  + admin SDK 가 만료된 doc 의 storage path 를 deleteObject. 베타엔 1년 안전망 단순 정책.

## 파일 크기 / SW 캐시 (2026-05-20)
- `api/generate-quiz.js`: 언스크램블 difficulty 정의 +3줄
- `public/admin/js/app.js`: 공지 첨부 헬퍼·UI +~180줄
- `public/js/app.js`: 공지 첨부 표시 +~30줄
- `storage.rules`: notices/* 경로 이미 적용됨(2026-05-02) — 변경 없음
- `scripts/admin/set-notice-attachments-lifecycle.js`: 신규 ~80줄
- SW 캐시: `kunsori-v570`

---

## 2026-05-21: 언스크램블 학생 화면 긴 문장 글자 단계 축소 + 안전망 스크롤

학원장 보고 — 언스크램블에서 문장이 길면 청크 선택지문이 화면 밖으로
밀려 안 보이고 스크롤도 안 됨 ('Captain awesome · 1 Captain awesome
CH5 · 5월 20일' 재현). SW v570 → v571 (commit `e6b32e0`).

### 원인
`unscrambleQuiz` 화면이 flex column 인데 합체카드(한글뜻+완성중)와
청크 영역 둘 다 `flex-shrink:0` + 그 아래 `<div style="flex:1">`
spacer → 콘텐츠가 길어지면 청크가 잘리고 footer 가 화면 밖으로 밀림.

### 옵션 검토 → D 채택 (사용자 정교화)
A(청크만 스크롤) / B(합체카드도 축소+청크 스크롤) / C(화면 전체
스크롤) / **D(자동 글자 축소 + 안전망 스크롤)**. 사용자가 D 채택 후
정교화 — 청크만이 아니라 한글뜻·완성중·청크 3개 영역 **동시 축소**
(시각 일관성), 최소 13px (12px 부담), 13px 에도 안 들어가면 청크만 스크롤.

### 구현
- `_app.html` — 청크 영역 부모 `id="uqChunkArea"` + `flex:1;
  min-height:0; overflow-y:hidden`. 그 아래 `flex:1` spacer 제거
  (청크 영역이 잔여 공간 차지). 합체카드·footer 위치 불변
- `app.js` `_uqRenderStep` 끝 `requestAnimationFrame(_uqFitContent)`
- `_UQ_FONT_TIERS` 3단계 — `{15,14,15} → {14,13,14} → {13,13,13}`
  (한글뜻/완성중/청크)
- `_uqApplyFontTier` — meanEl·builtEl·모든 청크 button fontSize 일괄 set
- `_uqFitContent` — tier 순차 적용 후 `scrollHeight > clientHeight+2`
  측정. 13px 까지 줄여도 overflow 면 청크 영역만 `overflow-y:auto`

### 작업 규칙 추가 (2026-05-21)
- **긴 콘텐츠 단계 글자 축소 + 안전망 스크롤 패턴** — 화면 고정 영역에
  가변 콘텐츠가 넘칠 때, 관련 영역들 글자를 단계표(tier)로 동시 축소
  → 각 단계 후 `requestAnimationFrame` 으로 `scrollHeight` 측정 →
  최소 단계에도 overflow 면 해당 영역만 `overflow-y:auto`. 인쇄
  `_tpApplyFitToPage`(zoom) 와 같은 정신, 화면용은 font-size 단계.
  시각 일관성 위해 단일 영역만 줄이지 말고 관련 영역 동시 축소.

## 파일 크기 / SW 캐시 (2026-05-21)
- `public/_app.html`: 청크 영역 flex:1 + spacer 제거 (~-2줄)
- `public/js/app.js`: `_uqFitContent`/`_uqApplyFontTier`/`_UQ_FONT_TIERS` +~33줄
- SW 캐시: `kunsori-v571`

---

## 2026-05-22: 단어 말하기 평가 방식 재검토 + 검증 페이지 2종 (spk-test / spk-exam)

단어 말하기(vocab speaking) 의 AI(check-word) 의존 문제 재검토.
**진행 중 — 베타 평가(여러 명 테스트) 후 방향 결정.** 학생 앱 코드 변경 없음
(독립 검증 페이지만 신규), SW 캐시 변동 없음.

### 1) AI 503 진단 — durationMs 로 클라 타임아웃 초과 확인
- Vercel `/api/check-word` 로그: 503 폴백이 떠도 최종 200 (폴백 정상 작동)
- 단 상세 로그 `durationMs`: 30분 33건 전부 9.7~52초 — 클라 타임아웃 9초 초과
- 결론: 503 자체보다 Gemini 응답 지연이 학생 체감 문제. AI 의존을 줄이는 방향 검토

### 2) 음성 평가 방식 검토 (STT vs LLM)
- `check-word` 는 Gemini(LLM) 오디오 멀티모달 — 무겁고 느림. 단어 채점에 부적합한 도구
- 빠른 음성 인식 = STT (Web Speech API 와 같은 계열). 우리 1·2차가 이미 STT
- 단어 1개는 STT 에 가장 불리 (문맥 보정 0). 문장이면 문맥으로 인식률 ↑
- 검토 안: 발음평가 API(Azure) / Capacitor 네이티브 앱 / 빈칸 문장 / 1·2·3차 단계 흐름
- 사용자 채택 방향(검토 중): 1차 영어 STT → 2차 한국어 STT → 3차 빈칸 문장.
  응시 시점 AI 호출 0, 출제 시점에만 데이터 생성

### 3) 검증 페이지 2종 신규 — 학생 앱과 분리된 독립 정적 페이지
- `public/spk-test.html` — 음성 인식 방식 **단건 검증**. 1·2·3차 버튼 + 실시간 문자화
  + alternatives·신뢰도·유사도·이벤트 로그. 최근 7일 AI 도달 단어 72개 드롭다운 +
  정답 발음 듣기(TTS)
- `public/spk-exam.html` — **실제 시험 형태 모의**. 1·2·3차 자동 흐름(영어 STT →
  한국어 STT → 빈칸 문장) + 힌트(스펠링 2글자) + 정답/오답·SKIP. 학생 앱 시험 화면
  디자인(코랄·합체 카드) 적용
- 둘 다 Firebase·로그인·서버 무관 순수 클라이언트. `quiz-test.html` 선례와 동일 패턴
- 접속: `raloud.vercel.app/spk-test.html` · `/spk-exam.html`

### 4) 진단 스크립트 fix
- `analyze-speaking-ai-dependence.js` — wordToAi 집계가 answer 객체에서 word 를
  찾던 버그 → `questions[i].word` 참조로 수정 (말하기 단어는 questions[] 에 있음)

### 작업 규칙 추가 (2026-05-22)
- **음성 인식 도구 선택 — STT vs LLM** — 음성→텍스트/점수는 STT 전용 엔진이 빠름
  (실시간). LLM 오디오 멀티모달(check-word)은 무겁고 느려 단어 채점엔 부적합.
  Gemini 음성 대화가 빠른 건 LLM 이 아니라 앞단 스트리밍 STT 덕분.
- **단어 1개 STT 는 가장 불리** — STT 는 문맥(앞뒤 단어)으로 보정해 정확해짐.
  단어 하나만 떼면 보정 0. 문장(빈칸 문장)으로 읽게 하면 인식률 자체가 올라감.
- **가설 검증은 독립 정적 페이지로** — 앱 통합 전 `spk-test.html`/`spk-exam.html`
  처럼 Firebase·로그인 무관 단독 페이지로 모바일 실측. 학생 영향 0, 빠른 반복.

## 파일 크기 / SW 캐시 (2026-05-22)
- `public/spk-test.html`: 신규 ~310줄 (음성 인식 단건 검증)
- `public/spk-exam.html`: 신규 ~430줄 (모의 시험 — 1·2·3차 흐름)
- `scripts/diag/analyze-speaking-ai-dependence.js`: wordToAi fix
- SW 캐시: `kunsori-v571` (학생 앱 무관 — 변동 없음)

---

## 2026-05-22 (이어서): AI OCR 스크롤 fix + 메시지 관리 정비 + 빈칸 문장 난이도 하향

SW v571 → v576. spk-test/spk-exam 검증 페이지는 학생 앱과 분리된 독립 페이지라
SW 무관.

### 1) AI OCR 화면 전체 스크롤 제거 (SW v572)
- `genGrid` 가 `height:calc(100vh - 280px)` 고정 — 위 요소(헤더·업로드 카드·여백)
  실제 합이 280px 초과 시 미세 스크롤·하단 버튼 가림
- `#page-generator.active` 를 flex column + 화면 콘텐츠 높이 고정, `genGrid` 는
  `flex:1` 로 남은 공간 정확히 차지 (calc 추정 폐기)

### 2) 메시지 관리 정비 (SW v573~v576)
- **행 2줄 압축** — 제목줄 오른쪽에 받는사람·날짜 배치 (제목/내용/받는사람·날짜 3줄 → 2줄)
- **날짜 필터** — '메시지 관리'·'발송 이력' 글자 옆 date input. 기본 어제,
  변경 시 그 날짜분만 (server-side `createdAt` 범위, 추가 인덱스 불필요)
- **검색** — 날짜칸 옆 검색 input. 메시지 관리=제목·내용·반 / 발송 이력=+이름.
  학원 메시지 저장 한도(`draftsPerAcademy`/`sentMessagesPerAcademy`)만큼 1회
  fetch·캐시 후 클라 부분일치 필터 (debounce 300ms). 한도=저장 최대치라 누락 0
- **삭제 시 상태 유지** — `delMsg`/`delDraftMsg` 가 `loadMessages()` 통째
  재호출 → 어제 날짜 리셋되던 문제. 현재 날짜·검색 유지하며 그 카드만 목록·캐시
  제거 + 한도 -1 + 부분 재렌더. 연이어 삭제 가능

### 3) spk-test/spk-exam — 빈칸 문장 단어 초등 저학년 수준으로
- 목표 단어 외 단어를 가장 흔한 500단어 수준으로 8개 교체:
  carpet→paper, storm→wind, blanket→bed, fur→hair, frost→winter,
  library→room, caves→a cave, daily→every day
- 근거: STT 문맥 보정에 필요한 건 "풍부한 문맥"이 아니라 "STT 가 정확히 인식하는
  주변 단어". 쉬운 고빈도 단어가 STT 인식 안정적 → 쉬운 문맥이 오히려 보정 유리.
  추상적 목표 단어만 일부 한계 (speaking-unfit 게이트로 처리)

### 작업 규칙 추가 (2026-05-22 이어서)
- **항목 삭제 UI 표준** — 삭제 시 전체 재조회·필터 리셋 X. 현재 상태(필터·검색·
  페이지·펼침) 유지하며 그 항목만 화면·캐시에서 제거 + 카운트 -1 + 해당 영역만
  재렌더. 사용자가 특별히 다르게 언급할 때만 예외. ([memory/feedback_delete_keeps_state.md](memory/feedback_delete_keeps_state.md))
- **AI 에 난이도 지시는 측정 가능한 기준으로** — "쉽게"는 주관적이라 AI 가 매번
  다르게 해석. "가장 흔한 500단어 이내", "CEFR A1", 단어 수 제한, 예시(few-shot)
  같은 측정 가능 기준 필수. 초등 1~2학년 ≈ 가장 흔한 300~500단어 수준.

### 단어 말하기 진행 상황
- spk-test/spk-exam 으로 베타 평가 중. **몇 차례 더 평가 후 학생앱 통합 예정** —
  미완료. 1·2·3차 흐름(영어 STT → 한국어 STT → 빈칸 문장) + 응시 시점 AI 0 방향.

## 파일 크기 / SW 캐시 (2026-05-22 이어서)
- `public/admin/style.css`·`_app.html`·`js/app.js`: AI OCR flex + 메시지 관리 정비
- `public/spk-test.html`·`spk-exam.html`: 빈칸 문장 8개 단어 교체
- SW 캐시: `kunsori-v576`

---

## 2026-05-23 ~ 24: 단어 말하기 신 흐름 통합 + AI 프롬프트·클린업 프리셋 동기 모델 통일

SW v577 → v588 (~13 commit).

### 1) 단어 말하기 1·2·3차 흐름 전면 개편 (응시 시점 AI 0)

옛: 1·2차 영어 STT → 3차 MediaRecorder + check-word AI (503 9.7~52초 지연 위험).
신: **1차 영어 STT (en-US, 닫힌후보 가드 유지) → 2차 한국어 STT (ko-KR, 한글 발음표기
매칭, 임계 0.7) → 3차 영어 빈칸 문장 STT (en-US, 목표 단어 부분 매칭, 임계 0.7)**.

- 출제 시점 `HOMOPHONES_PROMPT` 5필드 동시 생성 (homophones / koPron / sentence /
  sentenceKo / speakingTip) → 응시 시점 AI 호출 0 (check-word 폐기)
- check-word.js / MediaRecorder / silenceDetection / gumWithTimeout / blobToBase64 /
  cleanAiReason / _vqStartFinalAttemptMR — ~250줄 제거
- tpPublish 검증 게이트 — 4필드 누락 시 배정 차단
- 백필 스크립트 신규 — default 학원 vocab+speaking 161건 처리 (1500+ 단어, 4필드 자동 채움)
- 옛 시험 + 백필 안 된 단어는 학생앱 폴백 (1·2·3차 모두 영어 SR)
- 학생 힌트 UI — 스펠링 2글자, 점수 영향 없음. footer 위치(마이크 zone 움직임 방지)
- 학원장 베타 피드백 2차례 반영:
  · 1차: 힌트 footer 이동 / 2차 안내 단순화 / 3차 빈칸 회색 박스 가림 / 3차 라이브 STT /
    3차 정답 시 문장 노출·자동 발음·클릭 재생
  · 2차: 2차 통과 "한국식 발음" 멘트 제거 → speakingTip(5번째 필드, 단어별 발음 코칭
    25자, 예: "R 발음 — 혀 끝 말지 말기") / 정답 카드 글자 22px / 🔊 30px
- 3차 채점 완료 후 vqSpkLive 박스 유지 — 학생이 자기 발음 인식 결과 확인

신규 spkSource 값: `webspeech-1` / `webspeech-2` / `webspeech-3`. 학원장 상세 /
학생 상세 / analyze-speaking-ai-dependence.js 모두 신 값 대응.

iOS Safari Web Speech 정상 동작 확인 (아이패드 spk-test.html 테스트). 회귀 우려 해소.

### 2) AI 프롬프트·클린업 프리셋 동기 모델 통일

학원장 "AR 1.5 본문에 'consequence' 같은 어른 어휘" 보고 → mcq(본문이해)
**VOCABULARY MIRRORING 규칙** + 난이도 사고 단계(FACT-FINDING/COMPREHENSION/INFERENCE)
명확화. 그 과정에서 코드 default vs Firestore super 글로벌 갈라짐 발견:

7개 AI 프롬프트 중 4개(mcq/mcq_grammar/subjective/unscramble)가 2026-05-10 super
편집분 그대로. 그 이후 코드 변경 4건이 운영 미반영.

**자동 sync 도입 시도 + 즉시 철회** (902e4bd → dad90e8):
- 단방향 자동 sync(코드 → Firestore) 도입했더니 super 편집 후 코드 박기 전에
  학원장 출제 한 번에 super 편집 손실 → 자동 sync 제거

**최종 정책** — Firestore(super 글로벌) = 진실 출처. 양방향 동기는 명시 요청 시에만.
```
[학원 커스텀] academies/{id}.customPrompts / customCleanupPresets  ← 영구, 우선
   ↓ 없으면
[super 글로벌] appConfig/aiPrompts / appConfig/cleanupPresets       ← 진실 출처
   ↓ 글로벌 비었을 때만
[코드 default]                                                     ← emergency fallback
```

**클린업 프리셋 모델 변경** — 옛 "학원 본인 컬렉션이 진실 출처(genCleanupPresets) +
super 글로벌은 시드만" 구조 → AI 프롬프트와 동일 구조로 통일:
- super 글로벌이 진실 출처 + 학원 추가/수정만 `academies/{id}.customCleanupPresets`
- 마이그레이션 4개 학원 학원 커스텀 보존 (default "객관식 문법문제 생성" 1771자 등)
- `_cleanupLoadPresets`/Save/Duplicate/Delete 재작성. `_cleanupSeedDefaults` 폐기
- Firestore 규칙 `academies/{id}` update 키에 `customCleanupPresets` 추가

**도구**:
- `scripts/admin/push-aiprompt-to-firestore.js` — 코드 → Firestore 박기 (AI 프롬프트)
- `scripts/migrate/cleanup-presets-to-academy-custom.js` — 옛 학원 컬렉션 → 학원 커스텀
- `scripts/diag/check-aiprompts-sync.js` — 코드 vs Firestore 차이 진단
- 향후 사용자 요청 시 admin SDK 로 양방향 동기

**super 앱 화면 안내** (public/super/index.html): AI 프롬프트 + 클린업 프리셋
헤더에 동기화 필수 빨간색 경고. 클린업 "시드값" 표현 폐기.

### 작업 규칙 추가 (2026-05-23~24)

- **응시 시점 AI 호출 0 패턴** — 학생 응시 흐름은 AI 호출 없이 동작하도록 설계.
  필요한 AI 데이터는 **출제 시점**에 미리 생성·박음. 503/타임아웃 운영 리스크 제거.
  tpPublish 게이트로 데이터 누락 시 배정 차단.
- **단방향 자동 sync 는 의도와 반대로 작동할 수 있음** — 코드를 진실 출처로 가정한
  단방향 sync(코드 → Firestore)는 super 앱 편집을 즉시 손실시킴. 코드 vs Firestore
  양쪽 모두 의미 있는 변경 경로일 때는 **자동 sync 제거 + 명시 요청 트리거**가 정답.
  Firestore 가 진실 출처면 코드는 fallback 만.
- **시드 모델 vs 진실 출처 모델 구분** — 옛 클린업 프리셋처럼 "글로벌 default 는
  시드만, 학원 본인 컬렉션이 진실 출처" 구조는 super 편집이 기존 학원에 반영 안 됨.
  AI 프롬프트처럼 **글로벌 진실 출처 + 학원 커스텀 별도** 가 일관성 ↑.
- **본문이해 mcq 어휘 mirroring** — AI가 본문 어휘 풀에서 벗어난 어른 단어
  (consequence/demonstrate 등) 끌어 쓰면 학생 당황. **본문 어휘 우선 + 학년 흔한
  단어 보조**로 강제. 난이도 상/중/하는 **사고 단계**(사실/이해/추론) 한 축만 조절.
- **양방향 동기 자동화는 코드 측 제약으로 불가** — 코드는 git/deploy 만 변경 가능.
  Firestore → 코드 자동 동기 안 됨. 가장 안전: 사용자 명시 요청 시에만 양방향 처리.

## 파일 크기 / SW 캐시 (2026-05-23~24)
- `public/js/app.js`: 단어 말하기 1·2·3차 흐름 + 헬퍼 (~+300줄, check-word 등 ~-250줄)
- `public/admin/js/app.js`: tpPublish 게이트 / _fillMissingHomophones 5필드 / 클린업
  Save·Duplicate·Delete 신 모델 + _cleanupSeedDefaults 폐기 / 학원장 상세 차수 라벨
- `public/_app.html`: sentence area + 라이브 STT live area + 힌트 버튼 footer
- `api/generate-quiz.js`: HOMOPHONES_PROMPT 5필드 + mcq MIRRORING + subjective 갱신
- `public/super/index.html`: 동기화 필수 빨간색 안내 (AI 프롬프트 + 클린업)
- `firestore.rules`: academies update 키에 customCleanupPresets 추가
- 신규 스크립트:
  · `scripts/migrate/backfill-vocab-speaking-data.js` (백필)
  · `scripts/migrate/cleanup-presets-to-academy-custom.js` (클린업 이동)
  · `scripts/admin/push-aiprompt-to-firestore.js` (코드 → Firestore 동기)
  · `scripts/diag/check-aiprompts-sync.js` (진단)
- SW 캐시: `kunsori-v577` → `kunsori-v588`

## 진행률 (2026-05-23~24)
- **단어 말하기 신 흐름 통합: ~100%** (Phase 1~5 + 학원장 베타 피드백 2차례 + iOS 정상 + AI 호출 0)
- **AI 프롬프트·클린업 프리셋 동기 모델 통일: ~100%** (Firestore 진실 출처, 학원 커스텀,
  코드 fallback, super 앱 안내, 양방향 동기 도구)
- 본문이해 mcq 어휘 mirroring + 사고 단계 명확화: ~100%
- 멀티테넌시·super 앱·결제: 변동 없음
- Phase 5 출시 준비: 0%

**다음 세션 후보**:
- 옛 `genCleanupPresets` 컬렉션 안전 삭제 (운용 1~2일 안정 확인 후, 명시 트리거)
- 단어 말하기 베타 결과 관찰 + 추가 튜닝 (speakingTip 품질·정답 문장 노출 UX 등)
- 백필 안 된 시험 단어 (sent 검증 실패 ~7%) 재호출 검토
- Phase 5 출시 준비 (도메인·약관·결제 PG)

---

## 2026-05-24 (이어서): 부적합 단어 일관성 + 해석하기 옵션 + UX 정비

SW v588 → v593 (~6 commit).

### 1) advertisement TV 케이스 fix (단어말하기 출제 차단 해소)
출제 시 "advertisement" 가 누락 단어로 차단됨. 진단: sentence "I saw an advertisement on TV." 의 'TV' 영문 약자 때문에 sentenceKo Korean-only 검증 실패 → 빈값 유지. 매번 같은 응답이라 영영 안 채워짐.
- HOMOPHONES_PROMPT sentence 규칙에 RULE 6 신규 — 영문 약자/이니셜리즘 금지 (TV/USA/OK/FBI/NASA/iPhone/WiFi 등). "television" 같은 full word 사용
- backfill 스크립트 HOMOPHONES_PROMPT 도 동기
- admin SDK 로 advertisement 4건(sets 2 + tests 2) sentence/sentenceKo 수동 박음 ("I saw an advertisement in a magazine." / "나는 잡지에서 [광고]를 보았다.")
- 다른 영문 약자 의심 케이스 진단 — 0건 (advertisement 가 유일)

### 2) 부적합 단어 판정 일관성 (handleSpeakingUnfit)
보고: 같은 단어 세트 출제해도 매번 다른 부적합 단어 목록. 원인: callGemini 가 모든 task 에 temperature 0.7 사용 + hardForASR 기준 "highly likely" 가 AI 주관.
- A. callGemini 에 `opts.temperature` 추가 — handleSpeakingUnfit 만 0 호출 (분류 결정성). 출제 task 는 default 0.7 유지
- B. SPEAKING_UNFIT_PROMPT 강화 — "DEFAULT IS ALWAYS FALSE" + ">90% confident" 신뢰도 임계. hardForASR TRUE 는 ≤4글자 + 음향 모호만, wild/soft/right/light/world/fast 같은 흔한 단어 명시적 FALSE

### 3) 해석하기_주관식 옵션 — 문장 변형 / 문장 유지
학원장 요청. 옵션 2개 신설:
- 문장 변형 (paraphrase, default) — 기존 동작
- 문장 유지 (verbatim) — 본문 문장 그대로

구현:
- `SYSTEM_PROMPTS.subjective_verbatim` 신규 (2218자) — 본문 verbatim 강제
- POST handler `subjectiveMode` 파라미터 처리, promptKey 분기
- buildUserPrompt typeInstructions.subjective 모드별 분기
- validateSubjective 모드별 검증 — verbatim 은 본문 substring 매칭 강제, paraphrase 는 30% 단어 매칭
- 각 q.subjectiveMode 박음 + 세트 doc 메타 + 세트 목록에 라벨 (`✍️ 문장변형` / `📄 문장유지`)
- super 앱·학원장 앱 프롬프트 편집 모달에 subjective_verbatim 탭 추가
- push-aiprompt-to-firestore.js ALL_TYPES 에 추가 + Firestore 시드

### 4) UX 정비 (학원장 요청)
- AI 프롬프트 편집 모달 — subjective_verbatim 탭 추가 + 8개 탭 순서 재배열 (단어→빈칸→언스크램블→객관식(본문이해)→객관식(문법)→해석(변형)→해석(유지)→녹음). super 앱·학원장 앱 라벨 통일 ("해석하기 (문장변형/문장유지)")
- AI Generator 결과 모달 — 세트 이름 입력란을 문제 목록 위로 이동 (스크롤 불필요)
- 학생관리 검색 — 페이지네이션 로드된 학생만 검색하던 문제 → 학원 전체 학생 1회 fetch (limit 1000, academyId+role+status 만 필터, 반 무관) + 캐시 + debounce 300ms

### 5) 단어 말하기 — 3차 채점 후 라이브 STT 박스 유지
정답/오답 표시될 때 vqSpkLive 박스를 그대로 남겨 학생이 자기 발음 인식 결과 확인 가능 (1·2차는 변동 없음).

### 작업 규칙 추가 (2026-05-24)
- **분류 task vs 출제 task temperature 분리** — 모든 task 에 동일 temperature 사용하면 분류(yes/no)에서 결정성 손실. callGemini 에 opts.temperature 매개변수 두고 분류는 0, 출제는 default 0.7
- **AI 프롬프트 영문 약자 금지 (sentence/koTranslation 짝)** — 영어 sentence 에 TV/USA/OK 같은 약자 들어가면 한글 번역 측 영문 금지 규칙과 충돌해 검증 실패 무한 반복. 프롬프트에 명시적 금지 + full word 권장
- **모드 옵션 추가 시 응답 메타 + 세트 doc 메타 동시 박음** — subjective sentenceMode 처럼 옵션 추가 시 (1) validate 단계에서 각 q 에 메타 박고 (2) 응답에 모드 포함하고 (3) 세트 doc 에 모드 메타 박아 목록 라벨에 표시 — 3중 일관성

## 파일 크기 / SW 캐시 (2026-05-24 이어서)
- `api/generate-quiz.js`: HOMOPHONES sentence RULE 6 / SYSTEM_PROMPTS.subjective_verbatim / SPEAKING_UNFIT_PROMPT 강화 / callGemini temperature 옵션 / validateSubjective 모드 분기
- `public/admin/js/app.js`: subjective sentenceMode 옵션 / qgSaveSet 메타 / _qsBuildOptionsSummary 라벨 / 프롬프트 탭 8개 순서 + alias / 결과 모달 세트 이름 상단 / 학생 검색 학원 전체
- `public/super/js/app.js`: PROMPT_TYPES/LABELS 학원장과 동일 순서·라벨
- `scripts/admin/push-aiprompt-to-firestore.js`: ALL_TYPES 에 subjective_verbatim 추가
- SW 캐시: `kunsori-v589` → `kunsori-v593`
