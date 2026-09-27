/* Korte — dalinimasis ir atsarginė kopija.
   Kortelė perduodama nuoroda: jos duomenys yra pačioje nuorodoje (po #k=), jokio serverio.
   Šeimos narys gali: nuskenuoti QR kodą programoje (+ → Skenuoti), atidaryti nuorodą
   arba įklijuoti ją per meniu → „Gauti korteles“. */

'use strict';

const Share = (() => {
  const PREFIX = '#k=';
  const FORMATS = ['CODE_128', 'EAN_13', 'EAN_8', 'UPC_A', 'CODE_39', 'ITF', 'CODABAR', 'QR_CODE'];
  const ICONS = {
    share: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    copy: '<svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    users: '<svg class="ic" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    download: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    upload: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>',
    link: '<svg class="ic" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    plus: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg class="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>'
  };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Kodavimas ----------

  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
  }

  function appUrl() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  function makeLink(list) {
    const data = { v: 1, c: list.map(c => [c.name, c.code, c.format, c.color || '', c.ecl || '']) };
    return appUrl() + PREFIX + toBase64Url(JSON.stringify(data));
  }

  function isImportText(text) {
    return typeof text === 'string' && text.includes(PREFIX);
  }

  // Iš nuorodos → kortelių sąrašas (arba null, jei nuoroda netinkama)
  function parseLink(text) {
    try {
      const raw = text.slice(text.indexOf(PREFIX) + PREFIX.length).trim().split(/[\s&]/)[0];
      const data = JSON.parse(fromBase64Url(raw));
      if (!data || !Array.isArray(data.c)) return null;
      return data.c.slice(0, 300).map(sanitize).filter(Boolean);
    } catch (e) {
      return null;
    }
  }

  function sanitize(item) {
    const [name, code, format, color, ecl] = Array.isArray(item) ? item : [item.name, item.code, item.format, item.color, item.ecl];
    if (typeof name !== 'string' || typeof code !== 'string' || !name.trim() || !code.trim()) return null;
    return {
      name: name.trim().slice(0, 40),
      code: code.trim().slice(0, 300),
      format: FORMATS.includes(format) ? format : 'CODE_128',
      color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : null,
      ecl: ['L', 'M', 'Q', 'H'].includes(ecl) ? ecl : undefined
    };
  }

  const sameCard = (a, b) => a.code === b.code && a.name.toLowerCase() === b.name.toLowerCase();

  // ---------- Lapas (apatinis langas) ----------

  function openSheet(html) {
    $('#sheet-body').innerHTML = html;
    $('#sheet').classList.remove('hidden');
    requestAnimationFrame(() => $('#sheet').classList.add('open'));
  }
  function closeSheet() {
    if (isImportText(location.hash)) history.replaceState(history.state, '', appUrl());
    $('#sheet').classList.remove('open');
    setTimeout(() => $('#sheet').classList.add('hidden'), 180);
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Nuoroda nukopijuota'); }
    catch (e) { window.prompt('Nukopijuok nuorodą:', text); }
  }

  // ---------- Dalintis ----------

  function openShare(list) {
    if (!list.length) return;
    const link = makeLink(list);
    const title = list.length === 1 ? `Dalintis: ${list[0].name}` : `Dalintis ${list.length} kortelėmis`;

    let qrSvg = '';
    try {
      const qr = qrcode(0, 'L');
      qr.addData(link);
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) {
      qrSvg = '<p class="sheet-note">Kortelių per daug vienam QR kodui — siųsk nuorodą.</p>';
    }

    openSheet(`
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <p>Šeimos narys savo programoje spaudžia <b>+</b> → <b>Skenuoti</b> ir nukreipia kamerą į šį kodą.</p>
      </div>
      <div class="share-qr">${qrSvg}</div>
      <div class="sheet-actions">
        <button class="btn lime wide" id="sh-send">${ICONS.share} Siųsti nuorodą</button>
        <button class="btn white wide" id="sh-copy">${ICONS.copy} Kopijuoti nuorodą</button>
      </div>
      <p class="sheet-note">Nuorodoje yra kortelės numeris — siųsk tik savo žmonėms.</p>
    `);

    $('#sh-copy').onclick = () => copy(link);
    $('#sh-send').onclick = async () => {
      const text = list.length === 1 ? `${list[0].name} kortelė` : `Nuolaidų kortelės (${list.length})`;
      if (navigator.share) {
        try { await navigator.share({ title: 'Korte', text, url: link }); } catch (e) { /* atšaukta */ }
      } else {
        copy(link);
      }
    };
  }

  // ---------- Gauti ----------

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

  function openImport(incoming, { fromBrowserLink = false } = {}) {
    if (!incoming || !incoming.length) {
      openSheet(`<div class="sheet-head"><h2>Nuoroda netinkama</h2><p>Nepavyko perskaityti kortelių. Paprašyk atsiųsti nuorodą dar kartą.</p></div>
        <div class="sheet-actions"><button class="btn white wide" data-close>Uždaryti</button></div>`);
      return;
    }
    const rows = incoming.map((c, i) => {
      const dup = cards.some(x => sameCard(x, c));
      return `<label class="imp-row${dup ? ' dup' : ''}">
        <input type="checkbox" data-i="${i}" ${dup ? '' : 'checked'}>
        <span class="imp-badge" style="background:${c.color || colorFor(c.name)};color:${textColorOn(c.color || colorFor(c.name))}">${esc(initials(c.name))}</span>
        <span class="imp-main"><b>${esc(c.name)}</b><small>${esc(c.code)}</small></span>
        ${dup ? '<span class="tag neutral">jau turi</span>' : ''}
      </label>`;
    }).join('');

    // iPhone: programa pradžios ekrane turi atskirą atmintį nuo Safari
    const iosNote = fromBrowserLink && isIOS() && !isStandalone()
      ? `<p class="sheet-note warn">Jei naudoji programą iš pradžios ekrano, kortelės čia, Safari, į ją nepateks.
         Tokiu atveju nukopijuok nuorodą, atidaryk programą ir meniu pasirink <b>Gauti korteles</b>.
         <button class="link-btn" id="imp-copy">Kopijuoti nuorodą</button></p>`
      : '';

    openSheet(`
      <div class="sheet-head">
        <h2>Gautos kortelės</h2>
        <p>Pažymėk, kurias pridėti.</p>
      </div>
      ${iosNote}
      <div class="imp-list">${rows}</div>
      <div class="sheet-actions">
        <button class="btn lime wide" id="imp-add"></button>
        <button class="btn white wide" data-close>Atšaukti</button>
      </div>
    `);

    const btn = $('#imp-add');
    const update = () => {
      const n = document.querySelectorAll('.imp-row input:checked').length;
      btn.textContent = n ? `Pridėti (${n})` : 'Nieko nepažymėta';
      btn.disabled = !n;
    };
    document.querySelectorAll('.imp-row input').forEach(i => i.addEventListener('change', update));
    update();
    if ($('#imp-copy')) $('#imp-copy').onclick = () => copy(location.href);

    btn.onclick = () => {
      const chosen = [...document.querySelectorAll('.imp-row input:checked')].map(i => incoming[+i.dataset.i]);
      for (const c of chosen) {
        cards.push({ id: newId(), name: c.name, code: c.code, format: c.format, ecl: c.ecl, color: c.color || colorFor(c.name), pinned: false, opens: [], createdAt: Date.now() });
      }
      saveCards();
      closeSheet();
      history.replaceState({ view: 'view-list' }, '', appUrl());
      renderList();
      show('view-list');
      toast(chosen.length === 1 ? 'Kortelė pridėta' : `Pridėta kortelių: ${chosen.length}`);
    };
  }

  function openPaste() {
    openSheet(`
      <div class="sheet-head">
        <h2>Gauti korteles</h2>
        <p>Įklijuok nuorodą, kurią tau atsiuntė šeimos narys. QR kodą gali nuskenuoti per <b>+</b> → <b>Skenuoti</b>.</p>
      </div>
      <label class="field"><span>Nuoroda</span><input id="paste-input" placeholder="https://…#k=…" autocomplete="off"></label>
      <div class="sheet-actions">
        <button class="btn white wide" id="paste-clip">${ICONS.copy} Įklijuoti iš iškarpinės</button>
        <button class="btn lime wide" id="paste-go">Tęsti</button>
      </div>
    `);
    $('#paste-clip').onclick = async () => {
      try { $('#paste-input').value = await navigator.clipboard.readText(); } catch (e) { $('#paste-input').focus(); }
    };
    $('#paste-go').onclick = () => {
      const text = $('#paste-input').value;
      openImport(isImportText(text) ? parseLink(text) : null);
    };
  }

  // ---------- Atsarginė kopija ----------

  async function exportBackup() {
    const data = { app: 'korteles', v: 1, exported: new Date().toISOString(), cards };
    const json = JSON.stringify(data, null, 1);
    const name = `korteles-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Kortelių kopija' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Kopija išsaugota');
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
    if (!data || data.app !== 'korteles' || !Array.isArray(data.cards)) {
      toast('Tai ne kortelių kopijos failas');
      return;
    }
    let added = 0;
    for (const raw of data.cards) {
      const c = sanitize(raw);
      if (!c || cards.some(x => sameCard(x, c))) continue;
      cards.push({
        id: newId(), ...c, color: c.color || colorFor(c.name),
        pinned: !!raw.pinned,
        opens: Array.isArray(raw.opens) ? raw.opens.filter(Number.isFinite).slice(-100) : [],
        useCount: Number.isFinite(raw.useCount) ? raw.useCount : undefined,
        places: Array.isArray(raw.places) ? raw.places.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice(-30) : [],
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
      });
      added++;
    }
    saveCards();
    renderList();
    closeSheet();
    toast(added ? `Atkurta kortelių: ${added}` : 'Naujų kortelių nerasta — visas jau turi');
  }

  // ---------- Meniu ----------

  function openMenu() {
    const n = cards.length;
    openSheet(`
      <div class="sheet-head"><h2>Meniu</h2></div>
      <div class="menu">
        <button class="menu-item dark" id="m-add">
          <span class="menu-ic">${ICONS.plus}</span>
          <span><b>Pridėti kortelę</b><small>nuskenuok kodą arba įvesk ranka</small></span>
        </button>
        <button class="menu-item" id="m-share" ${n ? '' : 'disabled'}>
          <span class="menu-ic">${ICONS.users}</span>
          <span><b>Dalintis visomis kortelėmis</b><small>${n} ${n === 1 ? 'kortelė' : 'kortelės'} · nuoroda arba QR</small></span>
        </button>
        <button class="menu-item" id="m-receive">
          <span class="menu-ic">${ICONS.link}</span>
          <span><b>Gauti korteles</b><small>įklijuoti atsiųstą nuorodą</small></span>
        </button>
        <button class="menu-item" id="m-export" ${n ? '' : 'disabled'}>
          <span class="menu-ic">${ICONS.download}</span>
          <span><b>Išsaugoti atsarginę kopiją</b><small>failas, kurį gali laikyti Failuose ar Drive</small></span>
        </button>
        <label class="menu-item">
          <span class="menu-ic">${ICONS.upload}</span>
          <span><b>Atkurti iš kopijos</b><small>pvz. pakeitus telefoną</small></span>
          <input type="file" id="m-import" accept="application/json,.json" hidden>
        </label>
      </div>
    `);
    $('#m-add').onclick = () => { closeSheet(); setTimeout(() => openEditor(null), 120); };
    $('#m-share').onclick = () => openShare(sortedCards());
    $('#m-receive').onclick = openPaste;
    $('#m-export').onclick = exportBackup;
    $('#m-import').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
  }

  // ---------- Paleidimas ----------

  $('#sheet').addEventListener('click', e => {
    if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet();
  });
  $('#btn-menu').addEventListener('click', openMenu);
  $('#cv-share').addEventListener('click', () => {
    const card = cards.find(c => c.id === currentCardId);
    if (card) openShare([card]);
  });

  // Atidaryta per nuorodą (arba nuoroda atidaryta jau veikiančioje programoje)
  const checkHash = () => {
    if (isImportText(location.hash)) openImport(parseLink(location.hash), { fromBrowserLink: true });
  };
  window.addEventListener('hashchange', checkHash);
  checkHash();

  return { isImportText, parseLink, openImport, openShare, makeLink, closeSheet };
})();
