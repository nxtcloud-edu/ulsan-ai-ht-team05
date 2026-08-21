require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const store = require('./store');
const gemini = require('./gemini');
const { uploadToS3 } = require('./s3');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const WEB_DIST_DIR = path.join(__dirname, '..', 'web', 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();

app.use(cors());
app.use(express.json());

// static: uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// static: insurance test page
app.get('/test', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'test.html')));
app.use('/test', express.static(PUBLIC_DIR));

// root: redirect to S3 static hosting (frontend lives on S3 only)
app.get('/', (_req, res) => {
  res.redirect('http://ulsan-ht-team-5-s3.s3-website-us-east-1.amazonaws.com');
});

// static: frontend build, if present
if (fs.existsSync(WEB_DIST_DIR)) {
  app.use(express.static(WEB_DIST_DIR));
}

// --- multer setup (memory storage for S3 upload) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// --- 한글 에러 메시지 매핑 ---
const ERROR_MESSAGES = {
  NO_FILE: '이미지 파일을 선택해주세요.',
  FILE_TOO_LARGE: '이미지 크기가 너무 커요. 10MB 이하로 올려주세요.',
  UPLOAD_FAILED: '업로드에 실패했어요. 다시 시도해주세요.',
  SAVE_FAILED: '저장에 실패했어요. 잠시 후 다시 시도해주세요.',
  QUERY_REQUIRED: '검색어를 입력해주세요.',
  RATE_LIMITED: '요청이 너무 많아요. 몇 초만 기다린 후 다시 시도해주세요.',
  NOT_FOUND: '해당 항목을 찾을 수 없어요.',
  INTERNAL: '문제가 발생했어요. 잠시 후 다시 시도해주세요.'
};

function errorResponse(res, status, code) {
  res.status(status).json({ error: { code, message: ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL } });
}

// --- 간단한 rate limit (IP당 업로드/검색 각각 최소 간격) ---
const RATE_LIMIT_MS = 3000;
const lastRequestAt = new Map(); // key: `${ip}:${route}` -> timestamp

function rateLimit(routeKey) {
  return (req, res, next) => {
    const key = `${req.ip}:${routeKey}`;
    const now = Date.now();
    const last = lastRequestAt.get(key) || 0;
    if (now - last < RATE_LIMIT_MS) {
      return errorResponse(res, 429, 'RATE_LIMITED');
    }
    lastRequestAt.set(key, now);
    next();
  };
}

// --- routes ---

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/categories', (_req, res) => {
  res.json({ categories: gemini.CATEGORIES });
});

app.get('/api/items', (_req, res) => {
  const items = store.loadItems();

  // 카테고리별 개수
  const counts = { 전체: items.length };
  for (const cat of gemini.CATEGORIES) counts[cat] = 0;
  for (const it of items) {
    if (counts[it.category] !== undefined) counts[it.category]++;
  }

  res.json({ items, counts });
});

app.post('/api/items', rateLimit('upload'), (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return errorResponse(res, 400, 'FILE_TOO_LARGE');
      }
      return errorResponse(res, 400, 'UPLOAD_FAILED');
    }
    if (!req.file) {
      return errorResponse(res, 400, 'NO_FILE');
    }

    const buffer = req.file.buffer;
    const memo = typeof req.body.memo === 'string' ? req.body.memo.slice(0, 300) : '';

    // Write temp file for Gemini analysis
    const tmpFilename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(req.file.originalname) || ''}`;
    const tmpPath = path.join(UPLOADS_DIR, tmpFilename);
    fs.writeFileSync(tmpPath, buffer);

    let extracted;
    let usedFallback = false;
    try {
      extracted = await gemini.extractFromImage(tmpPath, memo);
    } catch (e) {
      console.error('extractFromImage failed, using fallback:', e.message);
      usedFallback = true;
      extracted = {
        category: '기타',
        title: req.file.originalname,
        summary: memo || '',
        ocr_text: '',
        tags: [],
        display_hint: 'image'
      };
    } finally {
      // Remove temp file
      fs.unlink(tmpPath, () => {});
    }

    // Upload to S3
    let imageUrl;
    try {
      imageUrl = await uploadToS3(buffer, req.file.originalname, req.file.mimetype);
    } catch (e) {
      console.error('S3 upload failed:', e.message);
      return errorResponse(res, 500, 'UPLOAD_FAILED');
    }

    try {
      const items = store.loadItems();
      const id = store.nextId(items);
      const item = {
        id,
        created_at: new Date().toISOString(),
        image_url: imageUrl,
        category: extracted.category,
        title: extracted.title,
        summary: extracted.summary,
        ocr_text: extracted.ocr_text,
        tags: extracted.tags,
        display_hint: extracted.display_hint,
        memo: memo || '',
        ai_fallback: usedFallback
      };
      await store.addItem(item);
      res.json(item);
    } catch (e) {
      console.error('failed to persist item:', e.message);
      errorResponse(res, 500, 'SAVE_FAILED');
    }
  });
});

app.delete('/api/items/:id', async (req, res) => {
  const removed = await store.removeItem(req.params.id);
  if (!removed) {
    return errorResponse(res, 404, 'NOT_FOUND');
  }
  res.json({ ok: true, id: removed.id });
});

app.post('/api/search', rateLimit('search'), async (req, res) => {
  const query = req.body && req.body.query;
  if (!query || typeof query !== 'string') {
    return errorResponse(res, 400, 'QUERY_REQUIRED');
  }

  const items = store.loadItems();

  if (items.length === 0) {
    return res.json({ answer: '저장된 항목이 없어요. 먼저 사진을 업로드해주세요.', items: [], fallback: false });
  }

  // Stage 1: cheap text filter (skip if small dataset)
  let candidates = items;
  if (items.length >= 100) {
    const q = query.toLowerCase();
    const filtered = items.filter((it) => {
      const haystacks = [
        it.title || '',
        it.ocr_text || '',
        ...(Array.isArray(it.tags) ? it.tags : [])
      ];
      return haystacks.some((h) => h.toLowerCase().includes(q));
    });
    if (filtered.length > 0) candidates = filtered;
  }

  // Stage 2 + 3: Gemini ranking, with fallback
  try {
    const { answer, ranked_ids } = await gemini.rankSearch(query, candidates);
    const byId = new Map(candidates.map((it) => [it.id, it]));
    const ranked = ranked_ids.map((id) => byId.get(id)).filter(Boolean);
    res.json({ answer, items: ranked, fallback: false });
  } catch (e) {
    console.error('rankSearch failed, using fallback:', e.message);
    res.json({
      answer: 'AI 검색에 실패해서 전체 목록을 보여드려요.',
      items: candidates,
      fallback: true
    });
  }
});

// generic error handler (e.g. multer errors thrown synchronously)
app.use((err, _req, res, _next) => {
  console.error('unhandled error:', err.message);
  errorResponse(res, 500, 'INTERNAL');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`capturebook api listening on 0.0.0.0:${PORT}`);
});
