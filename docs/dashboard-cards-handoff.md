# 학원장 대시보드 카드 정리 — 새 챗 핸드오프 (2026-05-07)

학원장 앱 초기화면(`page-dashboard`)의 카드/위젯 구조 + 향후 개선 작업을 새 챗에서 이어서 진행하기 위한 정리.

---

## 1. 현재 구조

### 1-1. 상단 5개 통계 카드 (`dash-grid` × 5)
[public/admin/index.html:222-243](public/admin/index.html#L222-L243), 데이터 로드 = `loadDashStats()` ([app.js](public/admin/js/app.js)).

| 카드 | 표시 | 데이터 소스 |
|------|------|-------------|
| 👥 **전체 학생** (`statTotal`) | 학원 전체 학생 수 | `users` where `role='student'` + `academyId` |
| ✅ **재원생** (`statActive`) | active 학생 수 | 위 + `status='active'` |
| ⏸ **휴원생** (`statPause`) | pause 학생 수 | 위 + `status='pause'` |
| 📝 **오늘 시험** (`statTests`) | 오늘 출제된 시험 | `genTests` where `date == today` |
| 💰 **미납** (`statUnpaid`) | 이번 달 미납 청구서 수 | `billings` where `status != 'paid'` |

### 1-2. 3열 그리드 (`dash-grid-3`)
[public/admin/index.html:245-295](public/admin/index.html#L245-L295)

**좌측 컬럼** (3개 카드 세로):
| 카드 | 코드 | 데이터 |
|------|------|--------|
| 📢 **공지사항** | `loadDashNotices()`, `#dashNotices` | `notices` 최근 5건 |
| 🤖 **AI 사용량** | `loadApiUsage()`, `#apiUsageCard` | 5분류 (OCR / 정리 / Generator / 녹음 / 리포트) + Storage |
| 📅 **달력** (작은) | `renderCalendar()`, `#calGrid` | 시험 일정만 표시 (점 형태) |

**중앙 컬럼**:
| 카드 | 코드 | 데이터 |
|------|------|--------|
| 📊 **최근 시험 결과** | `loadDashScores()`, `#dashScores` | `scores` 최근 10건 (반/이름/유형/교재/점수/일시) |

**우측 컬럼**:
| 카드 | 코드 | 데이터 |
|------|------|--------|
| 👥 **재원생 현황** | `loadDashStudents()`, `#dashStudents` | 반별 재원생 수 + 합계 |

### 1-3. 코드 진입점
```
admin/js/app.js
  ├─ initDashboard()           (line ~310)
  │    ├─ renderCalendar()     (작은 달력)
  │    ├─ loadDashStats()      (상단 5개 카드)
  │    ├─ loadDashNotices()    (공지)
  │    ├─ loadDashScores()     (최근 시험)
  │    ├─ loadDashStudents()   (재원생 현황)
  │    └─ loadApiUsage()       (5분류 + Storage)
  └─ refreshDashboard = initDashboard
```

---

## 2. 미착수 개선 — 큰 달력 통합 (원본 메모리)

`memory/project_dashboard_calendar.md` (2026-04-29 합의, 미착수):

> 학원장 대시보드의 핵심 위젯을 **큰 달력**으로 재설계 — 학원 운영자가 이번 달 일정을 한눈에 보게.

### 2-1. 통합 대상 이벤트
- 🎂 **학생 생일** — `users.birthday` (매년 반복)
- 💳 **결제 일정** — `users.tuitionPlan.dueDay` 또는 `billings.dueDate` (매월 반복)
- 📝 **시험 일정** — `genTests.date` (이미 작은 달력에 표시됨)
- (선택) 📢 **공지 게시일** — `notices.createdAt`

### 2-2. 설계
- 7×6 그리드 (한 달 + 앞뒤 여백) — 순수 CSS Grid, 라이브러리 없음
- 진입 시 이번 달 이벤트 1회 집계 (academyId 필터 + month range)
- 각 일자 칸: 카운트 + 종류별 작은 점 (색상 코드)
- 일자 클릭 → 우측/하단 사이드 패널에 상세 (학생명·금액·반 등)
- 월 이동 ◀ ▶ + [오늘] 버튼

### 2-3. 사전 점검 필요
1. **`users.birthday` 필드 존재 여부** — 학생 수정 모달엔 `euBirth` (생일) 입력란 있음. 데이터에 채워졌는지 grep + 샘플 확인
2. **결제 주기 데이터** — 결제 v2 (`billings.dueDate` + `users.tuitionPlan.dueDay`) 구조 확정됨 ✓
3. **칼렌더 크기·위치** — 대시보드 좌측 작은 달력 자리 → 큰 달력으로 확대? 또는 별도 페이지?

### 2-4. 작업량 가늠
- 데이터 다 있으면: **~4시간** (그리드 + 집계 + 사이드 패널)
- 입력 UI 보강까지: +**2~4시간**

---

## 3. 추가 개선 후보 (이번 정리 시 발견)

### 3-1. 통계 카드
- "오늘 시험" → 시험 카드 클릭 시 시험 목록 페이지로 이동 (현재 단순 표시)
- "미납" → 클릭 시 결제 관리 페이지로 이동 + 미납 필터 자동 적용

### 3-2. AI 사용량 카드
- 한도 80%/95% 도달 시 배지 강조 (이미 진도바 색은 있음)
- "남은 일수" 표시 (월말까지 N일)

### 3-3. 최근 시험 결과
- 평균 점수·통과율 요약 한 줄
- 합격선 미달 학생 강조

### 3-4. 재원생 현황
- 휴원/퇴원 추세 (3개월) — 작은 라인 차트
- 신규 등록 학생 명단 (이번 주)

### 3-5. 새 카드 후보
- 🎤 **오늘 응시 현황** — 학생별 응시 진행률
- 📈 **이번 주 신규 점수** — 점수 분포
- 💌 **메시지 발송 현황** — 미발송 미납자 수 (결제 v2 연동)

---

## 4. 새 챗에서 시작하는 방법

### 4-1. 권장 시나리오 — 큰 달력부터

```
참고 문서:
- docs/dashboard-cards-handoff.md (이 파일)
- memory/project_dashboard_calendar.md
- CLAUDE.md (전체 프로젝트 컨텍스트)

작업 순서:
1. 사전 점검 (5분)
   - users.birthday 데이터 채워진 비율 확인
   - 학생 수정 모달 birthday 입력 UX 확인
   - billings.dueDate 분포 확인 (학원별 평균 dueDay)

2. 큰 달력 컴포넌트 설계 (사용자 컨펌)
   - 위치: 대시보드 좌측 작은 달력 대체 / 별도 페이지 / 우측 새 컬럼?
   - 사이드 패널 위치: 우측 상시 표시 / 일자 클릭 시 모달
   - 모바일 반응형: 한 달 그리드 vs 주간 슬라이드?

3. 구현
   - 이벤트 집계 함수 (월 단위 academyId 필터)
   - 그리드 렌더 (CSS Grid 7×6)
   - 사이드 패널 + 일자 클릭 핸들러
   - 월 이동 / 오늘 버튼

4. 통합 테스트 + SW bump + 커밋
```

### 4-2. 작은 개선만 원하면

위 § 3 항목 중 하나 골라서 단발성 개선. 상단 카드 클릭 라우팅이 가장 ROI 높음 (10분 작업).

---

## 5. 참조 파일

| 항목 | 위치 |
|------|------|
| 대시보드 HTML | [public/admin/index.html:212-296](public/admin/index.html#L212-L296) |
| 대시보드 JS | [public/admin/js/app.js:309-...](public/admin/js/app.js#L309) (`initDashboard` 외) |
| 작은 달력 | `renderCalendar()` / `changeMonth()` |
| AI 사용량 | `loadApiUsage()` |
| 결제 v2 데이터 모델 | CLAUDE.md "2026-05-03~05-07" 섹션 |
| 화이트라벨 색 토큰 | `var(--brand-primary)` / `var(--teal)` (alias) |

### CSS 토큰 사용 (디자인 일관성)
- 강조색: `var(--teal)` 또는 `var(--brand-primary)`
- 배경: `var(--brand-primary-bg)` (연한 톤)
- 그라디언트: `var(--brand-header-gradient)` (헤더용)
- 학원 브랜딩 따라 자동 변경됨

---

## 6. 확인된 메모리

- `memory/project_dashboard_calendar.md` — 큰 달력 통합 (이 문서의 기반)
- `memory/project_v1_polish_cycle.md` — 출시 직전 디자인 토큰화·Lucide 아이콘 (별도)

새 챗 시작 시 이 두 메모리도 같이 참고.
