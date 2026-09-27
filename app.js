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

function renderList() {
  if (Geo.isEnabled() && Geo.last) geoMatches = Geo.matchCards(cards);
  const list = $('#card-list');
  const items = sortedCards();
  $('#list-label').textContent = geoMatches.size ? 'Siūlome pagal vietą, toliau — dažniausiai naudojamos' : 'Dažniausiai naudojamos viršuje';
  $('#list-label').classList.toggle('hidden', items.length === 0);
  $('#empty').classList.toggle('hidden', items.length > 0);
  list.innerHTML = items.map(c => {
    const bg = c.color || colorFor(c.name);
    const here = geoMatches.get(c.id);
    const tag = here ? `<span class="tag">${HERE_LABEL[here]}</span>` : '';
    return `
      <li class="card-item${here ? ' here' : ''}" data-id="${c.id}">
        <div class="badge" style="background:${bg};color:${textColorOn(bg)}">${escapeHtml(initials(c.name))}</div>
        <div class="card-main">
          <div class="card-name">${escapeHtml(c.name)}</div>
          <div class="card-sub">${escapeHtml(c.code)}</div>
        </div>
        ${tag}
        ${c.pinned ? '<span class="pin-mark" aria-label="Prisegta">' + PIN_ICON + '</span>' : ''}
      </li>`;
  }).join('');
}

$('#card-list').addEventListener('click', e => {
  const li = e.target.closest('.card-item');
  if (li) openCard(li.dataset.id);
});

// ---------- Kodo piešimas ----------

// ZXing formatų pavadinimai → JsBarcode formatai
const JSBARCODE_FORMAT = {
  CODE_128: 'CODE128', EAN_13: 'EAN13', EAN_8: 'EAN8', UPC_A: 'UPC', UPC_E: 'UPCE',
  CODE_39: 'CODE39', ITF: 'ITF', CODABAR: 'codabar'
};

function renderCode(container, code, format, { big = false } = {}) {
  container.innerHTML = '';
  container.classList.toggle('qr', format === 'QR_CODE');
  if (!code) return;

  if (format === 'QR_CODE') {
    const qr = qrcode(0, 'M');
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

  card.opens = [...(card.opens || []), Date.now()].slice(-100);
  Geo.learn(card); // įsimename vietą, kad kitą kartą kortelė iššoktų pati
  saveCards();

  $('#cv-name').textContent = card.name;
  $('#cv-number').textContent = card.code;
  $('#cv-pin').classList.toggle('on', !!card.pinned);
  renderCode($('#cv-code'), card.code, card.format, { big: true });
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

function updatePreview() {
  renderCode($('#preview'), $('#f-code').value.trim(), $('#f-format').value);
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
  userPickedColor = false;
  const card = id ? cards.find(c => c.id === id) : null;

  $('#edit-title').textContent = card ? 'Redaguoti kortelę' : 'Nauja kortelė';
  $('#f-name').value = card ? card.name : '';
  $('#f-code').value = card ? card.code : '';
  $('#f-format').value = card ? card.format : 'CODE_128';
  selectedColor = card ? (card.color || colorFor(card.name)) : COLORS[0];
  $('#btn-delete').classList.toggle('hidden', !card);
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
  if (!name || !code) return;

  if (editingId) {
    const card = cards.find(c => c.id === editingId);
    Object.assign(card, { name, code, format, color: selectedColor });
  } else {
    cards.push({ id: newId(), name, code, format, color: selectedColor, pinned: false, opens: [], createdAt: Date.now() });
  }
  saveCards();
  stopScan();
  history.back();
});

$('#btn-delete').addEventListener('click', () => {
  if (!editingId) return;
  const card = cards.find(c => c.id === editingId);
  if (!confirm(`Ištrinti „${card.name}“ kortelę?`)) return;
  cards = cards.filter(c => c.id !== editingId);
  saveCards();
  history.back();
});

// ---------- Skenavimas ----------

const SCAN_FORMATS = ['QR_CODE', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'CODABAR'];

function scanHints() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS.map(f => ZXing.BarcodeFormat[f]));
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return hints;
}

// Ieško kodo drobėje (canvas). Grąžina rezultatą arba null.
const decoder = new ZXing.MultiFormatReader();
decoder.setHints(scanHints());
function decodeCanvas(canvas) {
  try {
    const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    return decoder.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source)));
  } catch (e) {
    return null; // kodo šiame kadre nėra
  }
}

function applyResult(result) {
  const code = result.getText();
  // Šeimos nario QR kodas su kortelėmis
  if (Share.isImportText(code)) {
    if (navigator.vibrate) navigator.vibrate(60);
    history.back();
    setTimeout(() => Share.openImport(Share.parseLink(code)), 50);
    return;
  }
  let format = ZXing.BarcodeFormat[result.getBarcodeFormat()];
  if (format === 'UPC_E') format = 'CODE_128'; // UPC-E retas, piešiame kaip Code 128
  if (![...$('#f-format').options].some(o => o.value === format)) format = 'CODE_128';

  $('#f-code').value = code;
  $('#f-format').value = format;
  updatePreview();
  if (navigator.vibrate) navigator.vibrate(60);
  setMsg('✓ Kodas nuskaitytas. Įrašyk parduotuvės pavadinimą ir išsaugok.', 'ok');
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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
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

  // Kas 150 ms paimame kadrą ir ieškome kodo
  const tick = () => {
    if (!stream) return;
    if (video.videoWidth) {
      const k = Math.min(1, 1000 / video.videoWidth);
      scanCanvas.width = Math.round(video.videoWidth * k);
      scanCanvas.height = Math.round(video.videoHeight * k);
      scanCanvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
      const result = decodeCanvas(scanCanvas);
      if (result) { stopScan(); applyResult(result); return; }
    }
    scanTimer = setTimeout(tick, 150);
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
    const canvas = await imageToCanvas(url, 1600);
    const result = decodeCanvas(canvas);
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

    const names = cards.filter(c => geoMatches.has(c.id)).map(c => c.name);
    const mall = Geo.mallName(state);
    const offline = state.source === 'none' ? ' (be interneto)' : '';
    if (names.length && mall) setGeoChip(`${mall}: ${names.length} ${names.length === 1 ? 'kortelė' : 'kortelės'}`, 'active');
    else if (names.length) setGeoChip(`Esi: ${names.join(', ')}`, 'active');
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
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
