# SCRAPER

스크린샷을 업로드하면 AI가 자동으로 분류·요약하고, 자연어로 다시 찾을 수 있는 모바일 스크랩북입니다.

갤러리에 쌓인 수백 장의 스크린샷은 정작 필요할 때 찾을 수 없습니다. SCRAPER는 정리를 사용자에게 맡기지 않습니다. 업로드하면 Gemini가 분류·요약·태그를 만들고, 나중에 "저번에 본 까만 바지"처럼 말하듯 검색하면 됩니다.

## 주요 기능

- **AI 자동 분석** — 스크린샷에서 카테고리, 제목, 요약, OCR 텍스트, 검색 태그를 자동 추출
- **자연어 검색** — 대화체 질문으로 저장 항목을 찾고 AI 답변을 함께 제공
- **6개 카테고리** — 의류 / 음식점 / 학습 / 정보성글 / 여행 / 기타 자동 분류
- **사용자 카테고리** — 직접 카테고리 추가·삭제 (localStorage 유지)
- **S3 이미지 저장** — 서버 재시작·교체와 무관하게 이미지 보존
- **AI 실패 대비** — Gemini 호출이 실패해도 업로드 자체는 성공 처리 (fallback)

## 구조

```
api/     Node.js + Express API 서버
  server.js    라우트, multer 업로드, rate limit
  gemini.js    Gemini 이미지 분석 및 검색 랭킹
  s3.js        S3 업로드
  store.js     JSON 파일 기반 저장소
fornt/   모바일 프론트엔드 (단일 HTML)
landing.html   서비스 소개 랜딩 페이지
```

## 실행 방법

```bash
cd api
npm install
cp .env.example .env   # GEMINI_API_KEY 등 값 채우기
node server.js
```

S3 업로드를 사용하려면 실행 환경에 `s3:PutObject` 권한이 있는 AWS 자격증명이 필요합니다 (EC2 IAM 역할 권장).

프론트엔드는 `fornt/SCRAPER_mobile_demo_v15.html`을 브라우저에서 열거나 정적 호스팅에 배포합니다. 파일 상단의 `API_BASE`를 API 서버 주소로 맞춰야 합니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/items` | 항목 목록 + 카테고리별 개수 |
| POST | `/api/items` | 이미지 업로드 및 AI 분석 |
| DELETE | `/api/items/:id` | 항목 삭제 |
| POST | `/api/search` | 자연어 검색 |
| GET | `/api/categories` | 카테고리 목록 |
| GET | `/api/health` | 헬스 체크 |

업로드는 10MB 제한, 업로드·검색은 IP당 3초 rate limit이 적용됩니다.

## 기술 스택

Google Gemini API · Node.js · Express · AWS S3 · AWS EC2 · PM2 · Vanilla JS

## 알려진 제약

- 저장소가 JSON 파일이라 동시 쓰기가 많은 환경에는 적합하지 않습니다.
- 프론트엔드의 `API_BASE`가 IP로 하드코딩되어 있어, 서버 IP 변경 시 재배포가 필요합니다. Elastic IP 또는 도메인 사용을 권장합니다.
- 인증이 없어 API가 공개 상태입니다. 공개 배포 시 인증 추가가 필요합니다.

---

울산 해커톤 Team 5
