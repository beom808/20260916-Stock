# STOCK PULSE

기업명 또는 6자리 종목코드로 국내 상장사를 검색하고, 공시·IR 중심의 투자
리서치를 카테고리별로 살펴보는 반응형 웹 앱 프로토타입입니다. 삼성전자 샘플
리포트에는 핵심 투자지표, 5개년 차트, 동적 사업 KPI, 시나리오, 체크리스트와
출처 우선순위가 포함되어 있습니다.

## 실행

```bash
npm start
```

브라우저에서 `http://localhost:4173`을 여세요. 현재 검색 화면과 삼성전자 분석은
제품 경험을 확인하기 위한 프로토타입이며, 확인하지 못한 값은 `확인 불가`로
표시합니다.

## 테스트

```bash
npm test
```

## 화면 캡처

Playwright와 Chromium을 한 번 설치한 뒤 재현 가능한 전체 페이지 캡처를 만들 수
있습니다. 캡처 스크립트가 로컬 서버를 자동으로 시작하고 종료합니다.

```bash
npm install
npx playwright install chromium
npm run screenshot
```

결과는 `artifacts/stock-pulse.png`에 저장됩니다. 사내 프록시 또는 패키지 정책이
설치를 차단한다면 npm 레지스트리와 Playwright CDN 접근을 허용한 환경에서 위
명령을 실행해야 합니다.
