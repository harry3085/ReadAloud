# Firestore 색인 최적화 작업 결과 (2026-05-19)

## 1. 쿼리 위치 추적 결과 (Step 1)

### scores 컬렉션 read 쿼리 (10곳, addDoc write 6곳 제외)

| 위치 | where 조건 | orderBy | limit | 기존 색인 매칭 |
|------|-----------|---------|-------|--------------|
| admin app.js:1353 | academyId | createdAt desc | 20 | `academyId+createdAt:DESC` ✓ |
| admin app.js:4925/4950 `_srBuildConstraints` (성적 리포트) | academyId + date(range) + [group] + [mode] | date desc, createdAt desc | 300/20 | `academyId+[group]+[mode]+date:DESC+createdAt:DESC` ✓ |
| admin app.js:5182 (응시 순번) | academyId + testId + uid | createdAt asc | - | `academyId+testId+uid+createdAt:ASC` ✓ |
| admin app.js:5340 (점수 상세) | academyId + testId + uid | (클라 정렬) | - | 색인 #1 prefix ✓ |
| admin app.js:5451 (성장 리포트) | uid + academyId + date(range) | (클라 정렬) | - | `uid+academyId+date:ASC` ✓ |
| **admin app.js:6409** `_tlLoadScoresForTests` (진도체크/시험목록 통계) | academyId + testId(**in**) | - | - | ⚠️ **비효율** |
| **admin app.js:6619** `tpToggleTestProgress` (시험 진행현황 펼침) | academyId + testId | - | - | ⚠️ **비효율** |
| admin app.js:13226 (학생 제외) | academyId + testId + uid | - | - | 색인 #1 prefix ✓ |
| student app.js:3970 (랭킹) | academyId + group + date(range) | date desc | 1000 | `academyId+group+date:DESC` ✓ |

### 핵심 발견 — 문서 진단과 실제 코드 불일치

| 문서 진단 (firestore-indexes-optimization-tasks.md) | 실제 코드 검증 결과 |
|------|------|
| `(academyId, testId, reEvaluated)` 효율 128.10 | **운영 코드 아님** — `scripts/diag/test-length-vs-scores.js:31-34` 진단 스크립트 (1회용). genTests 루프에서 시험마다 호출 ("12회 실행" = 시험 12개 순회). `scores.reEvaluated` 필드는 `api/adminAction.js:199` 재평가 시 박힘이나 adminAction 은 scores **add only, 쿼리 X** |
| `(academyId, mode, userName)` 효율 71.70 | **userName where 0건** (grep 확인). `_srBuildConstraints` 는 `academyId+date+mode` (색인 매칭 ✓). userName 은 클라 측 검색 필터 (`scoreSearch` input) — server-side X. Firebase 통계의 추론 표기 오류 |
| `(academyId, testId)` 효율 9.10 | **운영 실재** — 6619(진행현황)·6409(시험통계) |

→ 문서의 "운영 read 비용 5,000/주" 진단은 `scripts/diag/` 진단 스크립트 1회 실행분 포함으로 부정확. 운영 쿼리(학생/학원장 앱)는 대부분 기존 색인 커버됨.

## 2. 추가된 색인

```json
{
  "collectionGroup": "scores",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "academyId", "order": "ASCENDING" },
    { "fieldPath": "testId", "order": "ASCENDING" }
  ]
}
```

**1개만 추가** (A안). 이유:
- `(academyId, testId)` — 6619·6409 운영 비효율 해결. 실익 명확
- `(academyId, testId, reEvaluated)` 제외 — 진단 스크립트 1회용, 실익 낮음 (사용자 결정)
- `(academyId, mode, userName)` 제외 — userName where 코드 없음. 영원히 미사용

**비효율 원인**: `where(academyId==) + where(testId==)` (orderBy 없음) 쿼리가 딱 맞는 2-field 색인 부재로, Firestore 가 `academyId` 단일 색인 선택 → 그 학원 점수 전체 받아서 testId 메모리 필터 (효율 9.10 = 664개 받아 73개 사용). 색인 추가로 그 시험 점수만 정확히 fetch.

기존 색인 #1 (`academyId+testId+uid+createdAt`, 4-field) 은 그대로 유지 — 5182·13226·5340 (uid 까지 쓰는 쿼리) 가 계속 사용. 삭제 X (추가만).

## 3. pushNotifications 호출 패턴 (Step 2)

| 위치 | 쿼리 | 패턴 |
|------|------|------|
| admin app.js:4516/4517 | `getCountFromServer(academyId + sent==T/F)` | 페이지 진입당 2회 (COUNT, **비용 0**). setInterval/폴링 아님 — 단발 |
| admin app.js:4468/4481 | `query(academyId + sent + createdAt)` | 메시지 관리 페이지 (drafts/sent) — 색인 `academyId+sent+createdAt:DESC` ✓ |

= 색인 충분 (`academyId+sent`, `academyId+sent+createdAt` 존재). 168회/7일 = 24/일 = 학원장 대시보드+메시지 페이지 진입 빈도. COUNT 쿼리라 비용 0, 폴링 아님 → **조치 불필요** (문서 결론과 일치).

## 4. 검증 방법

**3일 후 (2026-05-22) 확인할 것**:
1. Firebase Console → Firestore → 쿼리 통계 (지난 7일)
   - https://console.firebase.google.com/project/readaloud-51113/firestore/indexes
2. `/scores WHERE (academyId, testId)` 효율 9.10 → **1.00 근처** 떨어지면 성공
3. 색인 빌드 완료 확인: Console 색인 탭에서 `academyId + testId` 상태 "사용 설정됨"

**즉시 확인**:
- 학원장 앱 → 시험관리(단어시험 등) → 최근 시험 행 클릭 → 응시 현황 펼침 → 체감 속도
- 학원 점수 누적 많을수록 (default 학원) 효과 큼

## 5. 다음 작업 권장 (별도 의뢰 필요 — 이번 범위 X)

- [ ] `scripts/diag/test-length-vs-scores.js` 의 `academyId+testId+reEvaluated` 쿼리 — 진단 스크립트라 운영 무관. 자주 실행 시에만 색인 검토
- [ ] pushNotifications onSnapshot 전환 검토 — 현재 COUNT 단발이라 비용 0, 시급성 낮음
- [ ] Phase 4-3 진행 중 academyId 격리 작업과 충돌 모니터링

## 6. 작업 범위 (지킨 것)

- ✅ `firestore.indexes.json` 만 수정 (색인 1개 추가)
- ✅ `firebase deploy --only firestore:indexes` (rules·hosting 안 건드림)
- ✅ 코드 (`public/`, `api/`) 일절 수정 X
- ✅ 기존 색인 삭제·수정 X (추가만)
- ✅ 문서 진단 검증 후 적용 (reEvaluated/userName 색인은 코드 불일치로 제외)
