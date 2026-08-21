const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EXTRACT_MODEL = process.env.GEMINI_MODEL_EXTRACT || 'gemini-3.5-flash-lite';
const SEARCH_MODEL = process.env.GEMINI_MODEL_SEARCH || 'gemini-3.5-flash-lite';

const CATEGORIES = ['의류', '음식점', '학습', '정보성글', '여행', '기타'];

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    title: { type: 'string' },
    summary: { type: 'string' },
    ocr_text: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    display_hint: { type: 'string', enum: ['image', 'text'] }
  },
  required: ['category', 'title', 'summary', 'ocr_text', 'tags', 'display_hint']
};

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    ranked_ids: { type: 'array', items: { type: 'string' } }
  },
  required: ['answer', 'ranked_ids']
};

const EXTRACT_PROMPT = `이 스크린샷 이미지를 분석해서 아래 항목을 추출하세요.

- title, summary, tags: 한국어로 생성
- summary: 1~2문장으로 핵심 내용 요약
- ocr_text: 화면에 보이는 주요 텍스트를 그대로 추출
- tags: 검색에 쓸 키워드 5개 내외
- category 판단 기준:
  의류 - 옷, 신발, 가방, 액세서리 쇼핑 화면이나 코디 사진
  음식점 - 식당, 카페, 메뉴, 맛집 정보
  학습 - 강의, 공부 자료, 개발 문서, 정리 노트
  정보성글 - 노래 추천, 꿀팁, 대처법 등 텍스트 위주 정보글
  여행 - 여행지, 숙소, 항공, 일정
  기타 - 위에 해당하지 않는 것
- display_hint 판단 기준:
  image - 의류·음식점·여행처럼 시각적 요소가 중요한 경우
  text - 정보성글·학습처럼 텍스트 위주 내용인 경우
  (픽셀 비율로 판단하지 말고 문맥으로 판단할 것)`;

function guessMimeType(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

async function extractFromImage(filePath, memo) {
  const base64 = fs.readFileSync(filePath).toString('base64');
  const mimeType = guessMimeType(filePath);

  const promptText = memo && memo.trim()
    ? `${EXTRACT_PROMPT}\n\n사용자가 남긴 메모(참고용, 분류에 반영하세요): "${memo.trim()}"`
    : EXTRACT_PROMPT;

  const result = await ai.models.generateContent({
    model: EXTRACT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: promptText }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACT_SCHEMA
    }
  });

  const parsed = JSON.parse(result.text);
  return {
    category: CATEGORIES.includes(parsed.category) ? parsed.category : '기타',
    title: String(parsed.title || ''),
    summary: String(parsed.summary || ''),
    ocr_text: String(parsed.ocr_text || ''),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    display_hint: parsed.display_hint === 'text' ? 'text' : 'image'
  };
}

async function rankSearch(query, candidates) {
  const context = candidates.map(i => ({
    id: i.id, category: i.category, title: i.title, summary: i.summary, tags: i.tags
  }));

  const result = await ai.models.generateContent({
    model: SEARCH_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `사용자 질문: "${query}"

저장된 항목 목록(JSON):
${JSON.stringify(context)}

위 항목 중 질문과 관련된 것을 찾아서 다음을 반환하세요.
- answer: 한국어 1~2문장으로 자연스럽게 답변 (예: "삼산동 크림파스타집이고 오늘 저장하셨어요.")
- ranked_ids: 관련도 높은 순서로 id 배열. 관련 항목이 없으면 answer에 그렇게 말하고 빈 배열 반환.`
          }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: SEARCH_SCHEMA
    }
  });

  const parsed = JSON.parse(result.text);
  return {
    answer: String(parsed.answer || ''),
    ranked_ids: Array.isArray(parsed.ranked_ids) ? parsed.ranked_ids.map(String) : []
  };
}

module.exports = { extractFromImage, rankSearch, CATEGORIES };
