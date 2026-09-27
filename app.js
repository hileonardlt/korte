/* Korte — 1 etapas: skenavimas, sąrašas, kodo ekranas.
   Visi duomenys laikomi tik šiame telefone (localStorage). */

'use strict';

// ---------- Duomenys ----------

const STORAGE_KEY = 'korteles.v1';
const COLORS = ['#171717', '#C6F24E', '#5A7A31', '#B57A34', '#8A7B62', '#D9544A', '#E8833A', '#F2C94C', '#3B6FD9', '#2F8F83', '#7A5AC8', '#D8D3C8'];
const HALF_LIFE_DAYS = 30; // senesni atidarymai sveria mažiau

function loadCards() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCards() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch (e) {
    alert('Nepavyko išsaugoti. Patikrink, ar naršyklė leidžia saugoti duomenis.');
  }
}

let cards = loadCards();

// Paprašome naršyklės neištrinti duomenų
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Naudojimo balas: kiekvienas atidarymas prideda 1, bet per 30 d. jo svoris sumažėja perpus.
function usageScore(card, now = Date.now()) {
  const opens = card.opens || [];
  let score = 0;
  for (const t of opens) {
    const days = (now - t) / 86400000;
    score += Math.pow(0.5, days / HALF_LIFE_DAYS);
  }
  return score;
}

let geoMatches = new Map(); // kortelės id → 'shop' | 'mall' | 'learned'

function sortedCards() {
  const now = Date.now();
  return [...cards].sort((a, b) => {
    const ha = geoMatches.has(a.id), hb = geoMatches.has(b.id);
    if (ha !== hb) return hb ? 1 : -1; // parduotuvė, kurioje esi — pačiame viršuje
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    const diff = usageScore(b, now) - usageScore(a, now);
    if (Math.abs(diff) > 1e-9) return diff;
    return a.name.localeCompare(b.name, 'lt');
  });
}

function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function textColorOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1c1e21' : '#ffffff';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Ekranų valdymas ----------

const $ = sel => document.querySelector(sel);

function show(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === viewId));
  window.scrollTo(0, 0);
}

// Naršyklės „atgal“ mygtukas / iOS braukimas grąžina į sąrašą
function go(viewId) {
  if (viewId === 'view-list') {
    history.replaceState({ view: 'view-list' }, '');
  } else {
    history.pushState({ view: viewId }, '');
  }
  show(viewId);
}

window.addEventListener('popstate', () => {
  stopScan();
  releaseWakeLock();
  renderList();
  show('view-list');
});

document.querySelectorAll('[data-back]').forEach(btn =>
  btn.addEventListener('click', () => history.back())
);

// ---------- Sąrašas ----------

const PIN_ICON = '<svg class="ic" viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const HERE_LABEL = { shop: 'Esi čia', mall: 'Šiame centre', learned: 'Čia naudojai' };

const EYE_ICON = '<svg class="ic" viewBox="0 0 24 24"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const useCount = c => Number.isFinite(c.useCount) ? c.useCount : (c.opens || []).length;

// ---------- Paieška ----------
let searchActive = false;
let searchQuery = '';

// Paieška be lietuviškų raidžių skirtumų: „zalia“ randa „Žalia stotelė“
function searchRank(card, q) {
  const n = Geo._norm(card.name);
  if (n.startsWith(q)) return 0;                              // pavadinimo pradžia
  if (n.split(' ').some(w => w.startsWith(q))) return 1;      // kurio nors žodžio pradžia
  if (n.includes(q)) return 2;                                // bet kur
  return -1;
}

function filteredCards() {
  const all = sortedCards();
  const q = Geo._norm(searchQuery);
  if (!searchActive) return all;
  if (!q) return [];                                          // tuščia paieška — nerodome nieko
  return all
    .map((c, i) => ({ c, i, r: searchRank(c, q) }))
    .filter(x => x.r >= 0 && (q.length > 1 || x.r <= 1)) // viena raidė — tik pavadinimo/žodžio pradžia
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.c);
}

function openSearch() {
  searchActive = true;
  searchQuery = '';
  const input = $('#search-input');
  input.value = '';
  $('#search-bar').classList.remove('hidden');
  input.focus(); // iškart atidaro klaviatūrą (turi būti tame pačiame paspaudime)
  document.body.classList.add('searching');
  window.scrollTo(0, 0);
  renderList();
}

function closeSearch() {
  if (!searchActive) return;
  searchActive = false;
  searchQuery = '';
  $('#search-input').blur();
  $('#search-bar').classList.add('hidden');
  document.body.classList.remove('searching');
  renderList();
}

$('#btn-search').addEventListener('click', openSearch);
$('#search-cancel').addEventListener('click', closeSearch);
$('#search-input').addEventListener('input', e => { searchQuery = e.target.value; renderList(); window.scrollTo(0, 0); });
$('#search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {                         // Enter atidaro pirmą rastą kortelę
    const first = filteredCards()[0];
    if (first) openCard(first.id);
  } else if (e.key === 'Escape') closeSearch();
});

function renderList() {
  if (Geo.isEnabled() && Geo.last) geoMatches = Geo.matchCards(cards);
  const list = $('#card-list');
  const items = filteredCards();
  const q = searchActive && searchQuery.trim();
  $('#list-label').textContent = q ? `Rasta: ${items.length}` : geoMatches.size ? 'Siūlome pagal vietą, toliau — dažniausiai naudojamos' : 'Dažniausiai naudojamos viršuje';
  $('#list-label').classList.toggle('hidden', cards.length === 0 || (searchActive && !q));
  $('#empty').classList.toggle('hidden', cards.length > 0);
  $('#btn-search').classList.toggle('hidden', cards.length === 0 || searchActive);
  $('#search-empty').classList.toggle('hidden', !searchActive || (q && items.length > 0));
  if (searchActive) $('#search-empty').textContent = q ? `Kortelės „${searchQuery.trim()}“ nerasta` : 'Pradėk rašyti parduotuvės pavadinimą';
  list.innerHTML = items.map(c => {
    const bg = c.color || colorFor(c.name);
    const here = geoMatches.get(c.id);
    const tag = here ? `<span class="tag">${HERE_LABEL[here]}</span>` : '';
    return `
      <li class="card-row" data-id="${c.id}">
      <button class="swipe-del" type="button" data-del="${c.id}" tabindex="-1">${TRASH_ICON}<span>Ištrinti</span></button>
      <div class="card-item${here ? ' here' : ''}" data-id="${c.id}">
        <div class="badge" style="background:${bg};color:${textColorOn(bg)}">${escapeHtml(initials(c.name))}</div>
        <div class="card-main">
          <div class="card-name"><span>${escapeHtml(c.name)}</span>${c.pinned ? '<span class="pin-mark" aria-label="Prisegta">' + PIN_ICON + '</span>' : ''}</div>
        </div>
        <div class="card-uses" aria-label="Panaudota ${useCount(c)} k.">${EYE_ICON}<span>${useCount(c)}</span></div>
        ${tag}
      </div>
      </li>`;
  }).join('');
}

const TRASH_ICON = '<svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>';

$('#card-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { deleteCard(del.dataset.del); return; }
  const row = e.target.closest('.card-row');
  if (!row) return;
  if (swipeJustEnded) return;                                   // tai buvo braukimas, ne paspaudimas
  if (row.classList.contains('open')) { closeSwipes(); return; }
  if (document.querySelector('.card-row.open')) { closeSwipes(); return; }
  openCard(row.dataset.id);
});

// ---------- Braukimas kairėn → „Ištrinti“ ----------

const SWIPE_OPEN = 96;
let swipe = null;
let swipeJustEnded = false;

function closeSwipes(except) {
  document.querySelectorAll('.card-row.open').forEach(r => {
    if (r === except) return;
    r.classList.remove('open');
    r.querySelector('.card-item').style.transform = '';
  });
}

$('#card-list').addEventListener('pointerdown', e => {
  const row = e.target.closest('.card-row');
  if (!row || e.target.closest('[data-del]')) return;
  swipe = { row, x: e.clientX, y: e.clientY, dx: 0, active: false, base: row.classList.contains('open') ? -SWIPE_OPEN : 0 };
});

$('#card-list').addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipe.active = true; closeSwipes(swipe.row); swipe.row.classList.add('dragging'); }
    else if (Math.abs(dy) > 10) { swipe = null; return; }
    else return;
  }
  swipe.dx = Math.max(-SWIPE_OPEN - 30, Math.min(0, swipe.base + dx));
  swipe.row.querySelector('.card-item').style.transform = `translateX(${swipe.dx}px)`;
});

function endSwipe() {
  if (!swipe) return;
  const { row, active, dx } = swipe;
  swipe = null;
  if (!active) return;
  row.classList.remove('dragging');
  const open = dx < -SWIPE_OPEN / 2;
  row.classList.toggle('open', open);
  row.querySelector('.card-item').style.transform = open ? `translateX(${-SWIPE_OPEN}px)` : '';
  swipeJustEnded = true;
  setTimeout(() => { swipeJustEnded = false; }, 50);
}
$('#card-list').addEventListener('pointerup', endSwipe);
$('#card-list').addEventListener('pointercancel', endSwipe);

// ---------- Trynimas su „Atšaukti“ ----------

let undoTimer = null;
let lastDeleted = null;

function deleteCard(id) {
  const index = cards.findIndex(c => c.id === id);
  if (index < 0) return;
  lastDeleted = { card: cards[index], index };
  cards.splice(index, 1);
  saveCards();
  renderList();
  const bar = $('#undo');
  $('#undo-text').textContent = `„${lastDeleted.card.name}“ ištrinta`;
  bar.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { bar.classList.remove('show'); lastDeleted = null; }, 6000);
}

$('#undo-btn').addEventListener('click', () => {
  if (!lastDeleted) return;
  cards.splice(Math.min(lastDeleted.index, cards.length), 0, lastDeleted.card);
  lastDeleted = null;
  saveCards();
  renderList();
  $('#undo').classList.remove('show');
});

// ---------- Kodo piešimas ----------

// ZXing formatų pavadinimai → JsBarcode formatai
const JSBARCODE_FORMAT = {
  CODE_128: 'CODE128', EAN_13: 'EAN13', EAN_8: 'EAN8', UPC_A: 'UPC', UPC_E: 'UPCE',
  CODE_39: 'CODE39', ITF: 'ITF', CODABAR: 'codabar'
};

function renderCode(container, code, format, { big = false, ecl = 'M' } = {}) {
  container.innerHTML = '';
  container.classList.toggle('qr', format === 'QR_CODE');
  if (!code) return;

  if (format === 'QR_CODE') {
    const qr = qrcode(0, ['L', 'M', 'Q', 'H'].includes(ecl) ? ecl : 'M'); // klaidų taisymo lygis kaip originale
    qr.addData(code);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    return;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  container.appendChild(svg);
  const opts = { displayValue: false, margin: 10, height: big ? 140 : 80, width: 2, background: '#ffffff', lineColor: '#000000' };
  try {
    JsBarcode(svg, code, { ...opts, format: JSBARCODE_FORMAT[format] || 'CODE128' });
  } catch (e) {
    // Jei numeris netinka pasirinktam formatui, piešiame Code 128
    try { JsBarcode(svg, code, { ...opts, format: 'CODE128' }); } catch (e2) { container.innerHTML = ''; }
  }
}

// ---------- Kodo ekranas ----------

let currentCardId = null;
let wakeLock = null;

async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* nepalaikoma — nieko tokio */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#view-card').classList.contains('active')) keepScreenOn();
});

function openCard(id) {
  const card = cards.find(c => c.id === id);
  if (!card) return;
  currentCardId = id;

  card.useCount = useCount(card) + 1;
  card.opens = [...(card.opens || []), Date.now()].slice(-100);
  if (searchActive) { searchActive = false; searchQuery = ''; $('#search-input').blur(); $('#search-bar').classList.add('hidden'); document.body.classList.remove('searching'); }
  Geo.learn(card); // įsimename vietą, kad kitą kartą kortelė iššoktų pati
  saveCards();

  $('#cv-name').textContent = card.name;
  $('#cv-number').textContent = card.code;
  $('#cv-pin').classList.toggle('on', !!card.pinned);
  renderCode($('#cv-code'), card.code, card.format, { big: true, ecl: card.ecl });
  go('view-card');
  keepScreenOn();
}

$('#cv-pin').addEventListener('click', () => {
  const card = cards.find(c => c.id === currentCardId);
  if (!card) return;
  card.pinned = !card.pinned;
  saveCards();
  $('#cv-pin').classList.toggle('on', card.pinned);
});

$('#cv-edit').addEventListener('click', () => {
  releaseWakeLock();
  openEditor(currentCardId, { replace: true });
});

// ---------- Pridėjimas / redagavimas ----------

let editingId = null;
let selectedColor = null;

function renderSwatches() {
  $('#f-colors').innerHTML = COLORS.map(c =>
    `<button type="button" class="swatch${c === selectedColor ? ' selected' : ''}" data-color="${c}" style="background:${c}" aria-label="Spalva"></button>`
  ).join('');
}

$('#f-colors').addEventListener('click', e => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  selectedColor = b.dataset.color;
  renderSwatches();
});

// QR kodo klaidų taisymo lygis: iš nuskaityto originalo, kitaip — ankstesnis kortelės
let scanned = null;
function currentEcl() {
  const code = $('#f-code').value.trim();
  if (scanned && scanned.code === code && scanned.ecl) return scanned.ecl;
  const card = editingId && cards.find(c => c.id === editingId);
  return card && card.code === code ? card.ecl : undefined;
}

function updatePreview() {
  renderCode($('#preview'), $('#f-code').value.trim(), $('#f-format').value, { ecl: currentEcl() });
}

$('#f-code').addEventListener('input', updatePreview);
$('#f-format').addEventListener('change', updatePreview);
$('#f-name').addEventListener('input', () => {
  if (!editingId && !userPickedColor) {
    selectedColor = colorFor($('#f-name').value || '?');
    renderSwatches();
  }
});
let userPickedColor = false;
$('#f-colors').addEventListener('click', () => { userPickedColor = true; });

function setMsg(text, kind) {
  const m = $('#scan-msg');
  if (!text) { m.classList.add('hidden'); return; }
  m.textContent = text;
  m.className = 'msg ' + (kind || '');
}

function openEditor(id, { replace = false } = {}) {
  editingId = id || null;
  scanned = null;
  userPickedColor = false;
  const card = id ? cards.find(c => c.id === id) : null;

  $('#edit-title').textContent = card ? 'Redaguoti kortelę' : 'Nauja kortelė';
  $('#f-name').value = card ? card.name : '';
  $('#f-code').value = card ? card.code : '';
  $('#f-format').value = card ? card.format : 'CODE_128';
  selectedColor = card ? (card.color || colorFor(card.name)) : COLORS[0];
  $('#btn-delete').classList.toggle('hidden', !card);
  const nPlaces = card && card.places ? card.places.length : 0;
  $('#btn-forget').classList.toggle('hidden', !nPlaces);
  $('#btn-forget').textContent = `Pamiršti išmoktas vietas (${nPlaces})`;
  $('#scan-choices').classList.toggle('hidden', !!card);
  setMsg('');
  renderSwatches();
  updatePreview();

  if (replace) { history.replaceState({ view: 'view-edit' }, ''); show('view-edit'); }
  else go('view-edit');
}

$('#btn-add').addEventListener('click', () => openEditor(null));

$('#card-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const code = $('#f-code').value.trim();
  const format = $('#f-format').value;
  const ecl = format === 'QR_CODE' ? currentEcl() : undefined;
  if (!name || !code) return;

  if (editingId) {
    const card = cards.find(c => c.id === editingId);
    Object.assign(card, { name, code, format, color: selectedColor, ecl });
  } else {
    cards.push({ id: newId(), name, code, format, ecl, color: selectedColor, pinned: false, opens: [], createdAt: Date.now() });
  }
  saveCards();
  stopScan();
  history.back();
});

$('#btn-forget').addEventListener('click', () => {
  const card = cards.find(c => c.id === editingId);
  if (!card) return;
  Geo.forget(card);
  saveCards();
  $('#btn-forget').classList.add('hidden');
  setMsg('Išmoktos vietos ištrintos. Kortelė vėl bus siūloma tik prie tikros parduotuvės.', 'ok');
});

$('#btn-delete').addEventListener('click', () => {
  if (!editingId) return;
  const id = editingId;
  // Grįžtame į sąrašą (iš redagavimo arba kodo ekrano) ir ištriname su galimybe atšaukti
  history.back();
  setTimeout(() => { deleteCard(id); show('view-list'); }, 80);
});

// ---------- Skenavimas ----------

// Pagrindinis skaitytuvas — zxing-wasm (ZXing C++ versija, daug tikslesnė).
// Jei telefone jis nepasileistų, naudojame senesnį ZXing JS.

const WASM_FORMATS = ['QRCode', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'Codabar'];
const FORMAT_FROM_WASM = {
  QRCode: 'QR_CODE', EAN13: 'EAN_13', EAN8: 'EAN_8', UPCA: 'UPC_A', UPCE: 'CODE_128',
  Code128: 'CODE_128', Code39: 'CODE_39', ITF: 'ITF', Codabar: 'CODABAR',
  'QR Code': 'QR_CODE', 'EAN-13': 'EAN_13', 'EAN-8': 'EAN_8', 'UPC-A': 'UPC_A', 'UPC-E': 'CODE_128',
  'Code 128': 'CODE_128', 'Code 39': 'CODE_39'
};

let wasmReady = null;
function initWasm() {
  if (wasmReady) return wasmReady;
  wasmReady = (async () => {
    if (!window.ZXingWASM || typeof WebAssembly === 'undefined') return false;
    try {
      ZXingWASM.prepareZXingModule({
        overrides: { locateFile: (path, prefix) => path.endsWith('.wasm') ? 'lib/zxing_reader.wasm' : prefix + path },
        fireImmediately: true
      });
      // bandomasis nuskaitymas, kad modulis tikrai užsikrautų
      await ZXingWASM.readBarcodes(new ImageData(8, 8), { formats: ['QRCode'] });
      return true;
    } catch (e) {
      return false;
    }
  })();
  return wasmReady;
}
initWasm();

// Senasis skaitytuvas (atsarginis)
const JS_FORMATS = ['QR_CODE', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'CODABAR'];
const jsDecoder = new ZXing.MultiFormatReader();
(() => {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, JS_FORMATS.map(f => ZXing.BarcodeFormat[f]));
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  jsDecoder.setHints(hints);
})();

// Atmetame akivaizdžiai klaidingus nuskaitymus (valdymo simboliai, per trumpi kodai)
function plausible(text) {
  return typeof text === 'string' && text.length >= 3 && !/[\x00-\x1F\x7F]/.test(text);
}

/* Ieško kodo drobėje (canvas). Grąžina { text, format } arba null. */
async function decodeCanvas(canvas) {
  if (await initWasm()) {
    try {
      const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
      const results = await ZXingWASM.readBarcodes(data, { formats: WASM_FORMATS, tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 });
      const r = results.find(x => x.isValid && plausible(x.text));
      if (r) return { text: r.text, format: FORMAT_FROM_WASM[r.format] || 'CODE_128', ecl: (r.ecLevel || '').trim().toUpperCase().slice(0, 1) };
      return null;
    } catch (e) { /* krentame į atsarginį */ }
  }
  try {
    const src = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const r = jsDecoder.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src)));
    let format = ZXing.BarcodeFormat[r.getBarcodeFormat()];
    if (format === 'UPC_E') format = 'CODE_128';
    return plausible(r.getText()) ? { text: r.getText(), format } : null;
  } catch (e) {
    return null;
  }
}

function applyResult(result) {
  const code = result.text;
  // Šeimos nario QR kodas su kortelėmis
  if (Share.isImportText(code)) {
    if (navigator.vibrate) navigator.vibrate(60);
    history.back();
    setTimeout(() => Share.openImport(Share.parseLink(code)), 50);
    return;
  }
  let format = result.format;
  if (![...$('#f-format').options].some(o => o.value === format)) format = 'CODE_128';

  $('#f-code').value = code;
  $('#f-format').value = format;
  scanned = { code, ecl: ['L', 'M', 'Q', 'H'].includes(result.ecl) ? result.ecl : null };
  updatePreview();
  if (navigator.vibrate) navigator.vibrate(60);
  setMsg('✓ Kodas nuskaitytas. Patikrink, ar numeris sutampa su kortele, įrašyk parduotuvę ir išsaugok.', 'ok');
  $('#f-name').focus();
}

let stream = null;
let scanTimer = null;
const scanCanvas = document.createElement('canvas');

async function startScan() {
  setMsg('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMsg('Ši naršyklė neleidžia naudoti kameros. Pabandyk „Iš nuotraukos“ arba įvesk numerį ranka.', 'err');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
  } catch (e) {
    setMsg('Nepavyko įjungti kameros. Leisk naudoti kamerą naršyklės nustatymuose arba rinkis „Iš nuotraukos“.', 'err');
    return;
  }
  const video = $('#video');
  video.srcObject = stream;
  $('#scanner').classList.remove('hidden');
  $('#scan-choices').classList.add('hidden');
  try { await video.play(); } catch (e) {}

  // Kas ~120 ms paimame kadrą. Kodą priimame tik tada, kai du kadrai iš eilės rodo tą patį —
  // taip išvengiame klaidingų nuskaitymų.
  let last = null;
  const tick = async () => {
    if (!stream) return;
    if (video.videoWidth) {
      const k = Math.min(1, 1280 / video.videoWidth);
      scanCanvas.width = Math.round(video.videoWidth * k);
      scanCanvas.height = Math.round(video.videoHeight * k);
      scanCanvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
      const result = await decodeCanvas(scanCanvas);
      if (!stream) return;
      if (result && last && result.text === last.text) { stopScan(); applyResult(result); return; }
      last = result;
    }
    scanTimer = setTimeout(tick, 120);
  };
  tick();
}

function stopScan() {
  clearTimeout(scanTimer);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('#video').srcObject = null;
  $('#scanner').classList.add('hidden');
  if (!editingId) $('#scan-choices').classList.remove('hidden');
}

$('#btn-scan').addEventListener('click', startScan);
$('#btn-scan-stop').addEventListener('click', stopScan);

// Telefono nuotraukos didelės — sumažiname, kad kodas būtų randamas greitai
function imageToCanvas(url, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = url;
  });
}

$('#file-photo').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  setMsg('Ieškau kodo nuotraukoje…');
  const url = URL.createObjectURL(file);
  try {
    // Bandome keliais dydžiais: kartais kodas randamas tik didesnėje ar mažesnėje nuotraukoje
    let result = null;
    for (const size of [2000, 1400, 3000, 1000]) {
      result = await decodeCanvas(await imageToCanvas(url, size));
      if (result) break;
    }
    if (result) applyResult(result);
    else setMsg('Kodo nuotraukoje nepavyko rasti. Nufotografuok arčiau ir tiesiai arba įvesk numerį ranka.', 'err');
  } catch (err) {
    setMsg('Nepavyko atidaryti nuotraukos.', 'err');
  } finally {
    URL.revokeObjectURL(url);
  }
});

// ---------- Geolokacija ----------

let geoBusy = false;
let geoLastRun = 0;

function setGeoChip(text, kind) {
  const chip = $('#geo-chip');
  $('#geo-text').textContent = text;
  chip.className = 'geo-chip' + (kind ? ' ' + kind : '');
  $('#geo-off').classList.toggle('hidden', !Geo.isEnabled());
}

function geoIdle() {
  setGeoChip('Įjungti parduotuvės atpažinimą');
}

async function runGeo() {
  if (!Geo.isEnabled() || geoBusy) return;
  geoBusy = true;
  geoLastRun = Date.now();
  setGeoChip('Ieškau, kur esi…', 'searching');
  try {
    const state = await Geo.refresh();
    geoMatches = Geo.matchCards(cards, state);
    renderList();

    const shops = cards.filter(c => geoMatches.get(c.id) === 'shop' || geoMatches.get(c.id) === 'mall').map(c => c.name);
    const learned = cards.filter(c => geoMatches.get(c.id) === 'learned').map(c => c.name);
    const mall = Geo.mallName(state);
    const offline = state.source === 'none' ? ' (be interneto)' : '';
    const acc = Math.round(state.pos.accuracy || 0);
    if (!Geo.isAccurate(state)) setGeoChip(`Vieta netiksli (±${acc} m) — parduotuvės nespėlioju`, 'warn');
    else if (shops.length && mall) setGeoChip(`${mall}: ${shops.length} ${shops.length === 1 ? 'kortelė' : 'kortelės'}`, 'active');
    else if (shops.length) setGeoChip(`Esi: ${shops.join(', ')}`, 'active');
    else if (learned.length) setGeoChip(`Čia dažnai naudoji: ${learned.join(', ')}`, 'active');
    else if (mall) setGeoChip(`${mall}: tavo kortelių čia nėra${offline}`);
    else setGeoChip(`Šalia parduotuvių su tavo kortelėmis nėra${offline}`);
  } catch (e) {
    geoMatches = new Map();
    renderList();
    if (e.code === 'denied') setGeoChip('Vieta neleidžiama. Leisk ją telefono nustatymuose.', 'warn');
    else setGeoChip('Nepavyko nustatyti vietos. Spausk, kad bandytum dar kartą.', 'warn');
  } finally {
    geoBusy = false;
  }
}

$('#geo-chip').addEventListener('click', () => {
  if (!Geo.isEnabled()) Geo.setEnabled(true);
  runGeo();
});

$('#geo-off').addEventListener('click', () => {
  Geo.setEnabled(false);
  geoMatches = new Map();
  renderList();
  geoIdle();
});

// Grįžus į programą — patikriname vietą iš naujo (ne dažniau nei kas 20 s)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - geoLastRun > 20000) runGeo();
});

// ---------- Paleidimas ----------

history.replaceState({ view: 'view-list' }, '');
$('#brand-list').innerHTML = Geo.brandSuggestions().map(b => `<option value="${escapeHtml(b)}">`).join('');
renderList();
if (Geo.isEnabled()) runGeo(); else geoIdle();

if ('serviceWorker' in navigator) {
  // Kai atsisiunčiama nauja versija, programa persikrauna pati (vieną kartą), kad iškart matytum naujieną
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // grįžus į programą — patikriname, ar nėra naujos versijos
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  });
}
