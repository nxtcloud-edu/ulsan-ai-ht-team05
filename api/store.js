const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'items.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, '[]');
}

function loadItems() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('store: failed to read items.json, starting empty:', e.message);
    return [];
  }
}

function saveItems(items) {
  ensureDataFile();
  fs.writeFileSync(DATA_PATH, JSON.stringify(items, null, 2));
}

// --- write queue: serialize read-modify-write to avoid concurrent overwrite loss ---
let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  const result = writeQueue.then(() => fn());
  // keep the chain alive even if fn() rejects
  writeQueue = result.catch(() => {});
  return result;
}

function addItem(item) {
  return enqueueWrite(() => {
    const items = loadItems();
    items.unshift(item);
    saveItems(items);
    return item;
  });
}

function removeItem(id) {
  return enqueueWrite(() => {
    const items = loadItems();
    const idx = items.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    const [removed] = items.splice(idx, 1);
    saveItems(items);
    return removed;
  });
}

function nextId(items) {
  let max = 0;
  for (const it of items) {
    const m = /^itm_(\d+)$/.exec(it.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `itm_${String(max + 1).padStart(3, '0')}`;
}

module.exports = { loadItems, saveItems, addItem, removeItem, nextId, DATA_PATH };
