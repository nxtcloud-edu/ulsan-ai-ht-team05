// api/seed.js
// 지정한 폴더의 이미지들을 순차로 POST /api/items 에 업로드.
// 15 RPM 한도 때문에 5초 간격으로 스로틀.
//
// 사용법: node seed.js <이미지_폴더_경로> [API_BASE_URL]
// 예:     node seed.js ./seed_images
//         node seed.js ./seed_images http://localhost:3000

const fs = require('fs');
const path = require('path');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const THROTTLE_MS = 5000;

async function main() {
  const dir = process.argv[2];
  const base = process.argv[3] || `http://localhost:${process.env.PORT || 3000}`;

  if (!dir) {
    console.error('usage: node seed.js <이미지_폴더_경로> [API_BASE_URL]');
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error(`폴더를 찾을 수 없음: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error(`이미지 파일 없음: ${dir}`);
    process.exit(1);
  }

  console.log(`총 ${files.length}개 이미지, ${THROTTLE_MS / 1000}초 간격으로 업로드 시작 -> ${base}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(dir, file);
    process.stdout.write(`[${i + 1}/${files.length}] ${file} ... `);

    try {
      const buf = fs.readFileSync(filePath);
      const form = new FormData();
      form.append('image', new Blob([buf]), file);

      const res = await fetch(`${base}/api/items`, { method: 'POST', body: form });
      const json = await res.json();

      if (!res.ok) {
        fail++;
        console.log(`실패 (HTTP ${res.status}): ${json.error?.message || 'unknown'}`);
      } else {
        ok++;
        console.log(`성공 -> ${json.id} [${json.category}] ${json.title}`);
      }
    } catch (e) {
      fail++;
      console.log(`에러: ${e.message}`);
    }

    if (i < files.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }

  console.log(`완료: 성공 ${ok} / 실패 ${fail}`);
}

main();
