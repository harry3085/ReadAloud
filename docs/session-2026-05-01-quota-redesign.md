# 2026-05-01 세션 인수인계 — 한도 재설계 (T1~T9)

> 다음 세션에서 읽고 시작. 한도 인프라 5분류 분리 + super_admin 한도 관리 UI 완료.

---

## 최종 배포 상태

**프로덕션**: `https://raloud.vercel.app/super/` (master `2162836`)
SW 캐시: `kunsori-v214`

### 활성 커밋 (오늘 진행)
```
2162836 fix(super): 학원 관리 사용량 셀 5분류 표시 (AI 3 / 운영 2 그룹)
581cd8b feat(quota): T8 한도 80%/95% 도달 시 학원장 앱 토스트 알림
c11bba9 feat(quota): T7 학원 상세 모달에 [⚙️ Override] 탭 추가
33015e8 fix(super): override ● 호버 툴팁 한국어 라벨로 표시
fd14310 feat(super): 학원 관리 행에 customLimits override 빨간 ● 표시
f36fc94 fix(super): T6 한도 관리 페이지 자체 스크롤 wrapper 추가
78cb7f8 fix(super): T6 _plansCache 중복 선언 제거 — _t6Plans 로 분리
dc6cdfd feat(quota): T6 super_admin 한도 관리 탭 — 플랜·구간 편집 + 학원별 Override
62f7ae9 fix(quota): 대시보드 AI 사용량 위젯 5분류 합산 + byTier 한도 참조
d0456ad fix(quota): 월 자동 리셋 시 모든 카운터 동시 리셋 + 4월 잔존값 정리
5f654cd feat(quota): T5 학원장 앱 AI 사용량 페이지 — 5분류 진행 바
b40f13b feat(quota): T4 academies 5분류 카운터 백필
83689ce feat(quota): T3 API 호출부 5분류 카운터 분리 + growth-report placeholder
61784a3 feat(quota): T2 quota.js 5분류 분리 + 'ai' deprecated 매핑
62a030e feat(quota): T1 plans 5분류 + 학생 구간별 byTier 차등화
1a23ab6 fix(timezone): 모든 날짜 처리 KST 통일 — 학생 응시일·공지·푸시·결제·표시
1154510 fix(usage): apiUsage 카운트·월 한도 리셋 KST 기준 통일
```

---

## 핵심 변화 1줄 요약

이전: 학원당 AI 한도 1개 (`aiQuotaPerMonth`) + 녹음 1개 (`perTypeQuota.recording.check`).
이후: **5분류 한도** (OCR / Cleanup / Generator / 녹음 / 성장리포트) × **학생 수 구간**(30/60/100명, Free 는 10) **차등화** + **학원별 Override** + **80%/95% 토스트** + **타임존 KST 통일**.

---

## T1~T9 작업 완료

### T1 — `plans-schema.js` 5분류 + byTier 차등화 (`62a030e`)
- `plan.limits` 단일 → `plan.byTier["30/60/100"]` 구간별
- 5 분류 한도: `ocrPerMonth` / `cleanupPerMonth` / `generatorPerMonth` / `recordingPerMonth` / `growthReportPerMonth` + `storageGB` + `maxStudents`
- Free 는 tier10 단일, 학생 한도 5명 → 10명 확대
- `STUDENT_TEST_TIERS` 상수 추가 (UI 활용)
- `scripts/lib/quota-helper.js` 신규 — `getEffectiveLimits(plan, academy)`

### T2 — `quota.js` 5분류 분리 + 'ai' deprecated (`61784a3`)
- `QUOTA_CONFIG` 상수: 5분류 매핑 (counterField·limitField·label)
- `'ai'` → `'generator'` 자동 매핑 + 콘솔 경고 (T3 호환)
- `plan.byTier[tier][limitField]` 우선, customLimits override
- `?? `사용 (0 함정 방지)
- `api/_lib/quota-helper.js` 신규 (서버 미러)

### T3 — API 호출부 5분류 + growth-report placeholder (`83689ce`)
- `ocr.js` `'ai'` → `'ocr'`
- `cleanup-ocr.js` `'ai'` → `'cleanup'`
- `generate-quiz.js` `'ai'` → `'generator'`
- `check-recording.js` 그대로 (`'recording'`)
- `api/growth-report.js` 신규 placeholder — `'growthReport'`, 한도 + incrementUsage 까지만 작동

### T4 — academies 5분류 카운터 백필 (`b40f13b`)
- `scripts/migrate/split-quota-counters.js` 신규
- 학원 6곳 모두 `ocrCallsThisMonth` / `cleanupCallsThisMonth` / `generatorCallsThisMonth` / `growthReportThisMonth` 0 으로 추가
- 멱등 (재실행 시 skip)

### T5 — 학원장 AI 사용량 페이지 (`5f654cd`)
- 사이드바 [📊 AI 사용량] 메뉴
- `#page-quotaUsage` — 5분류 진행 바 (80%/95% 색상 변경)
- customLimits override 시 `(override)` 배지

### 월 리셋 버그 수정 (`d0456ad`)
- `incrementUsage` 가 `needsReset` 시 자기 카운터만 1 리셋하던 버그 → 모든 카운터 0 + 자기 1
- `scripts/migrate/reset-monthly-counters.js` 신규 — 4월 잔존값 정리 (default `recording=4`, `ai=481` 등)

### 대시보드 위젯 갱신 (`62f7ae9`)
- 학원장 대시보드 위젯의 "AI 월 호출" 분수 = OCR + Cleanup + Generator 합산 + byTier 한도 합산
- 헤더 우측 `[📊 상세 →]` 링크 — quotaUsage 페이지 진입

### T6 — super_admin 한도 관리 탭 (`dc6cdfd`, `f36fc94`, `78cb7f8`)
- `[⚙️ 한도 관리]` 탭 신설 (3 섹션)
  1. 4 플랜 × 구간 한도 카드 — 행마다 [편집] 모달
  2. 학원별 Override 검색 (이름·subdomain·id 부분일치, 캐시)
  3. 변경 이력 (adminLogs 50건)
- `openQuotaEditModal(planId, tier)` — 영향 받는 학원 수 표시 + 사유 필수
- `openCustomLimitsModal(academyId)` — 6 분류 입력 (빈 값=기본값)
- `update_plan_quota` / `update_custom_limits` adminLogs 기록
- composite index `adminLogs (action ASC + at DESC)` 배포

### override 시각 표시 (`fd14310`, `33015e8`)
- 학원 관리 행 플랜 배지 옆 빨간 ● — customLimits 비어있지 않으면
- 호버 툴팁 한국어 라벨 + 줄바꿈
  ```
  📌 한도 Override
  · OCR: 300
  · 녹음 평가: 200
  ```

### T7 — 학원 모달 [⚙️ Override] 탭 (`c11bba9`)
- 학원 4탭 → 5탭 구조
- `_renderAcmOverride(a)` — 6 분류 입력 + 사유 + 자체 [💾 저장] 버튼
- 모달 풋터 [저장] = basic 변경 / Override 탭 [💾 저장] = customLimits 분리 (사유 필수)
- 저장 후 `_academiesCache` 즉시 갱신 → 학원 행 빨간 ● 즉시 반영

### T8 — 80%/95% 한도 토스트 (`581cd8b`)
- `quota.js incrementUsage` 가 `res` 받으면 응답 헤더 자동 set:
  - `X-Quota-Used` / `X-Quota-Limit` / `X-Quota-Percent` / `X-Quota-Kind`
- 5개 API 호출부에 `{ ...q, res }` 전파
- 학원장 `_geminiFetch` wrapper 가 `_checkQuotaWarning(res)` 자동 검사
- 80%+ : `'{kind} 한도 N% 도달 (X/Y)'`
- 95%+ : `'⚠️ {kind} 한도 N% 도달 (X/Y) — 곧 차단됩니다'`
- `_quotaWarned[kind]` 메모리 캐시 — 같은 분류·임계 중복 회피
- 학생 앱 미적용 (학원 운영 정보)

### 학원 관리 사용량 컬럼 갱신 (`2162836`)
- `aiCallsThisMonth`(deprecated) + 옛 한도 → 5분류 표시 (AI 3종 + 운영 2종 그룹)
- 표시 형식:
  ```
  학생 65/100
  OCR 0/200 · 정리 0/400 · 생성 0/150
  녹음 0/600 · 리포트 0/10
  ```

### T9 — 검증 도구 + 인수인계 (이번 commit)
- `scripts/diag/check-quota-state.js` 신규 — 학원별 5분류 카운터·한도·사용률 한 번에 출력 + 80%/95% 강조
- 본 인수인계 문서

---

## 신규 / 갱신 파일

| 종류 | 경로 |
|---|---|
| 신규 | `scripts/lib/quota-helper.js` |
| 신규 | `api/_lib/quota-helper.js` |
| 신규 | `api/growth-report.js` (placeholder) |
| 신규 | `scripts/migrate/split-quota-counters.js` |
| 신규 | `scripts/migrate/reset-monthly-counters.js` |
| 신규 | `scripts/diag/check-quota-state.js` |
| 갱신 | `scripts/lib/plans-schema.js` (전면 개편) |
| 갱신 | `scripts/admin/create-plans.js` (출력 포맷) |
| 갱신 | `api/_lib/quota.js` (5분류 + needsReset 버그 fix + res 헤더) |
| 갱신 | `api/{ocr,cleanup-ocr,generate-quiz,check-recording}.js` (quotaKind + res 전파) |
| 갱신 | `public/admin/index.html` (사이드바 메뉴) |
| 갱신 | `public/admin/js/app.js` (5분류 페이지 + 위젯 갱신 + 토스트) |
| 갱신 | `public/super/index.html` (한도 관리 탭) |
| 갱신 | `public/super/js/app.js` (T6 + T7 + override ● + 사용량 셀) |
| 갱신 | `firestore.indexes.json` (adminLogs action+at) |
| 갱신 | `public/sw.js` (v210 → v214) |

---

## Firestore 변경

### plans/{free,lite,standard,pro}
- `byTier` 객체 추가 (T1)
- 기존 `limits` 객체 잔존 (merge:true) — 안전망 폴백

### academies/*
- `usage.ocrCallsThisMonth` / `cleanupCallsThisMonth` / `generatorCallsThisMonth` / `growthReportThisMonth` 0 으로 추가 (T4)
- 4월 잔존값 정리 (`recordingCallsThisMonth=4` / `aiCallsThisMonth=481` 등 → 0)
- 모든 학원 `lastResetAt='2026-05'`

### adminLogs
- 신규 액션: `update_plan_quota` / `update_custom_limits`
- composite index: `action ASC + at DESC`

---

## 검증 시나리오 (수동)

| # | 시나리오 | 검증 방법 |
|---|---|---|
| 9-1 | 5분류 카운터 동작 | OCR 1회 호출 → `academies/{id}.usage.ocrCallsThisMonth +1`, 다른 카운터 0 유지 |
| 9-2 | 한도 차단 | super 에서 `customLimits.ocrPerMonth=2` → 3번째 호출 429 응답 |
| 9-3 | 슈퍼 한도 변경 즉시 반영 | Lite 30 OCR 150→200, 그 후 호출 시 새 한도 적용 |
| 9-4 | Override 우선 | 학원 `customLimits.ocrPerMonth=500`, 같은 플랜 다른 학원은 150 |
| 9-5 | 80%/95% 토스트 | `customLimits.ocrPerMonth=10` → 8번째 호출 80% 토스트, 9번째 95% 토스트, 10번째 차단 |

진단 도구:
```bash
node scripts/diag/check-quota-state.js  # 학원별 5분류 카운터·한도·사용률 한 번에
```

---

## 남은 항목 / 알려진 한계

1. **`growth-report.js` 핸들러는 placeholder** — quota 체크 + `incrementUsage` 까지만. 실제 데이터 수집·Gemini 호출·`growthReports` 컬렉션 저장 미구현. 별도 작업 단위.
2. **학원장 모달의 옛 customLimits 입력 (acLimitAi/acLimitRec)** — `public/super/js/app.js:950, 952` 에 옛 키 placeholder 잔존. T7 의 [⚙️ Override] 탭과 중복. 별도 정리 필요.
3. **Free 학원 studentLimit 30 케이스** — `saloud`/`first` 가 Free 플랜인데 `studentLimit=30`. byTier 폴백으로 byTier['10'] 적용됨 (의도). super 에서 학원장이 보면 30명 표시, 한도는 Free 10명 한도. 정책 결정 필요.
4. **deprecated `aiCallsThisMonth` 카운터** — 더 이상 +1 안 됨. 표시·로직에서 거의 무시됨. 별도 cleanup script 로 필드 자체 제거 가능 (선택).
5. **학생앱 토스트 미적용** — T8 은 학원장 앱만. 학생에게 한도 알림 노출하면 학원 운영 정보 노출이라 부적절.

---

## 다음 세션 후보

1. **T6 작업 시 발견된 옛 customLimits 입력 정리** — 학원 기본정보 탭에서 옛 acLimitAi/acLimitRec 제거
2. **growth-report 실 구현** — 학생 데이터 수집 + Gemini 프롬프트 + `growthReports` 컬렉션
3. **베타 시작 직전 운영 가이드** (SuperAdmin Phase A T7 — 별도 작업)
4. **학원 모달 학생 한도 customLimits.maxStudents UI 정리** — 현재 `maxStudents` override 가능하지만 학원 관리 탭의 `studentLimit` 컬럼과 충돌 가능

---

## 운영 도구 명령어

```bash
# 학원 한도 상태 진단
node scripts/diag/check-quota-state.js

# 학원 카운터 5분류 백필 (멱등)
node scripts/migrate/split-quota-counters.js [--apply]

# 월 카운터 강제 리셋 (lastResetAt 다른 학원만)
node scripts/migrate/reset-monthly-counters.js [--apply]

# plans 갱신 (plans-schema.js 변경 후)
node scripts/admin/create-plans.js [--apply]
```

---

## 진행률 (2026-05-01)

- 한도 재설계 (T1~T9): **~95%** (T9 자동 진단 도구 완료, 수동 검증은 운영 시 진행)
- 멀티테넌시 인프라: **~95%**
- 녹음숙제 시스템: **~95%**
- 알림 시스템: **~95%**
- super_admin 앱: **~98%** (한도 관리·Override 탭 추가)
- Phase 5 출시 준비: **0%**
