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

## Firebase 연동 (Spark 무료 요금제)

`public/firebase.js`가 Firebase Authentication(Google 로그인), Cloud Firestore,
Analytics를 연결합니다. 빌드 과정 없이 CDN의 ES 모듈로 동작합니다.

| 기능 | Firestore 경로 |
| --- | --- |
| 사용자 프로필 | `users/{uid}` |
| 관심 기업 | `users/{uid}/watchlist/{종목코드 또는 n_기업명}` |
| 기업별 메모 | `users/{uid}/memos/{종목코드 또는 n_기업명}` |

Cloud Storage와 Cloud Functions는 사용하지 않습니다.

### Firebase 콘솔 설정 (한 번만)

1. **Authentication → 시작하기 → 로그인 방법 → Google** 사용 설정, 프로젝트 지원 이메일 선택 후 저장
2. **Authentication → 설정 → 승인된 도메인**에 `stockhelper2.netlify.app` 추가
   (`localhost`와 `*.firebaseapp.com`은 기본 포함)
3. **Firestore Database → 데이터베이스 만들기** (프로덕션 모드로 시작, 리전은 `asia-northeast3`(서울) 권장 —
   리전은 만든 뒤 변경할 수 없습니다)
4. **Firestore Database → 규칙** 탭에 `firestore.rules` 내용을 붙여넣고 **게시**
   (또는 `npx firebase-tools deploy --only firestore:rules`)

`firebaseConfig`의 `apiKey` 등은 웹 앱 식별용 공개 값이며, 데이터는 `firestore.rules`로 보호됩니다.

## AI 기업 분석 채팅 (Google Gemini)

오른쪽 아래 **AI 분석** 버튼으로 현재 보고 있는 기업에 대해 질문할 수 있습니다.
코드는 `public/ai-chat.js`이며 모델은 `gemini-3.5-flash-lite`입니다.

- **API 키는 사용자가 직접 입력**합니다. 키는 [Google AI Studio](https://aistudio.google.com/apikey)에서 발급합니다.
- 키는 입력한 사람의 브라우저(`localStorage`, "기억하기" 해제 시 `sessionStorage`)에만 저장되고,
  Gemini API 요청 헤더(`x-goog-api-key`)로만 전송됩니다. 사이트 서버나 Firestore에는 저장하지 않습니다.
- **Google 검색으로 최신 정보 확인**을 켜면 Gemini의 Google 검색 연동을 사용하고 출처 링크를 표시합니다.
- 답변은 사실·분석·추정·의견을 구분하고 기준 시점을 밝히도록 지시되어 있지만, AI 답변은 틀릴 수 있습니다.
