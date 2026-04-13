# 큰소리 영어 - 배포 가이드

## 폴더 구조
```
public/
├── index.html          ← 로그인 + 라우터
├── student/
│   └── app.html        ← 학생 앱 (현재 index.html 내용)
└── admin/
    ├── index.html      ← 관리자 레이아웃
    ├── dashboard.html  ← 초기화면
    ├── class.html      ← 클래스 관리
    ├── student.html    ← 학생 관리
    ├── book.html       ← 교재 관리
    ├── test.html       ← 테스트 관리
    ├── score.html      ← 성적 관리
    └── message.html    ← 메시지 관리
```

현재 구현된 기능:

✅ PC 사이드바 레이아웃 (좌측 메뉴 + 우측 콘텐츠)
✅ 대시보드 (통계카드 5개 + 공지 + 달력 + 최근성적 + 재원생현황 + 교재목록)
✅ 클래스 관리 (반 생성/삭제)
✅ 학생 관리 (재원생/휴원생/퇴원생 분리, 반배정, 휴원/퇴원처리)
✅ 교재 관리 (MyBook 생성 - 붙여넣기/엑셀, 중복제거, Unit 추가, 폴더)
✅ 공지/결제/메시지 관리
✅ 성적 리포트/개인별 분석
