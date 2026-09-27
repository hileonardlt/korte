/* Korte — geolokacija.
   1) Nustato, kur esi (tik kai programa atidaryta).
   2) Iš OpenStreetMap (Overpass API, nemokamai, be rakto) paima parduotuves aplink tave
      ir prekybos centrą, jei esi jame.
   3) Prisimena vietas, kuriose atidarei kortelę („išmoktos vietos“).
   Vieta niekur nesaugoma, išskyrus šį telefoną. */

'use strict';

const Geo = (() => {
  const SETTINGS_KEY = 'korteles.geo.enabled';
  const CACHE_KEY = 'korteles.geo.cache.v1';
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  const NEAR_RADIUS = 40;          // m: bazinis atstumas iki parduotuvės taško žemėlapyje
  const MAX_RADIUS = 90;           // m: daugiau niekada — kitaip „esi“ kaimyninėje parduotuvėje
  const MAX_ACCURACY = 65;         // m: jei vieta netikslesnė, parduotuvės nespėliojame
  const LEARN_MIN_DAYS = 2;        // išmokta vieta pradeda veikti tik panaudojus ją 2 skirtingas dienas
  const REUSE_DISTANCE = 60;       // m: jei pasislinkai mažiau, naudojame ankstesnį atsakymą
  const CACHE_MAX_AGE = 7 * 864e5; // 7 d.
  const CACHE_MAX_ITEMS = 40;
  const LEARN_RADIUS = 70;         // m: išmoktos vietos atstumas
  const MAX_PLACES_PER_CARD = 30;

  // Tinklai, kurių pavadinimai kortelėje ir žemėlapyje gali skirtis.
  // Pirmas žodis — kaip rodome pasiūlymuose, kiti — kaip gali būti OSM.
  const BRANDS = [
    ['Maxima'], ['Rimi'], ['Iki'], ['Lidl'], ['Norfa'], ['Aibė', 'aibe'], ['Šilas', 'silas'],
    ['Senukai', 'kesko senukai', 'senukai lt'], ['Ermitažas', 'ermitazas'], ['Depo'], ['Moki veži', 'moki vezi', 'mokivezi'],
    ['Drogas'], ['Eurovaistinė', 'eurovaistine'], ['Camelia', 'camelia vaistine'], ['Benu', 'benu vaistine'],
    ['Gintarinė vaistinė', 'gintarine vaistine', 'gintarine'], ['Norfos vaistinė', 'norfos vaistine'],
    ['Douglas'], ['Kristiana'], ['Pepco'], ['Jysk'], ['IKEA'], ['Topo Centras', 'topocentras'], ['Elektromarkt'],
    ['Apranga'], ['Lindex'], ['H&M', 'hm', 'h m'], ['Sportland'], ['Sportsdirect', 'sports direct'], ['Varle'],
    ['Circle K', 'circlek'], ['Viada'], ['Neste'], ['Orlen'], ['Baltic Petroleum'], ['Jammi'], ['Caffeine'], ['Vero Cafe', 'vero'],
    ['Pegasas'], ['Humanitas']
  ];

  // ---------- Pagalbinės ----------

  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function distance(a, b) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // Visi pavadinimai, kuriais kortelė gali atsirasti žemėlapyje
  function keysForName(name) {
    const n = norm(name);
    const keys = new Set([n]);
    for (const b of BRANDS) {
      const variants = b.map(norm);
      if (variants.includes(n)) variants.forEach(v => keys.add(v));
    }
    return [...keys].filter(k => k.length >= 2);
  }

  function nameMatches(cardKeys, placeKeys) {
    for (const c of cardKeys) {
      for (const p of placeKeys) {
        if (!p) continue;
        if (p === c) return true;
        // „maxima xx“ tinka „maxima“ kortelei, „rimi hyper“ — „rimi“
        if (c.length >= 3 && p.startsWith(c + ' ')) return true;
        if (p.length >= 3 && c.startsWith(p + ' ')) return true;
      }
    }
    return false;
  }

  // ---------- Vieta ----------

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, time: Date.now() }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
      );
    });
  }

  // ---------- OpenStreetMap ----------

  function buildQuery(pos) {
    const { lat, lon } = pos;
    const r = MAX_RADIUS + 60; // šiek tiek plačiau, tikslų atstumą skaičiuojame patys
    return `[out:json][timeout:20];
(
  nwr(around:${r},${lat},${lon})[shop];
  nwr(around:${r},${lat},${lon})[amenity~"^(pharmacy|fuel|cafe)$"];
)->.near;
is_in(${lat},${lon})->.inside;
wr(pivot.inside)[shop=mall]->.malls;
.malls map_to_area->.mallarea;
(
  nwr(area.mallarea)[shop];
  nwr(area.mallarea)[amenity~"^(pharmacy|cafe)$"];
)->.mallshops;
(.near; .malls; .mallshops;);
out tags center;`;
  }

  async function fetchOverpass(query) {
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // Paverčia OSM atsakymą į paprastą sąrašą
  function parse(json) {
    const places = [];
    const malls = [];
    for (const el of json.elements || []) {
      const t = el.tags || {};
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (t.shop === 'mall') { malls.push(t.name || 'Prekybos centras'); continue; }
      const keys = [t.brand, t['brand:lt'], t.name, t['name:lt'], t.operator].map(norm).filter(Boolean);
      if (!keys.length || lat == null) continue;
      places.push({ keys: [...new Set(keys)], label: t.brand || t.name, lat, lon });
    }
    return { places, malls };
  }

  // Ankstesni atsakymai — kad veiktų be interneto ir nekviestume serverio be reikalo
  function cachedNear(pos) {
    const cache = load(CACHE_KEY, []);
    const now = Date.now();
    return cache.find(c => now - c.time < CACHE_MAX_AGE && distance(c, pos) < REUSE_DISTANCE) || null;
  }
  function saveToCache(pos, data) {
    const now = Date.now();
    const cache = load(CACHE_KEY, []).filter(c => now - c.time < CACHE_MAX_AGE && distance(c, pos) >= REUSE_DISTANCE);
    cache.unshift({ lat: pos.lat, lon: pos.lon, time: now, ...data });
    store(CACHE_KEY, cache.slice(0, CACHE_MAX_ITEMS));
  }

  // ---------- Viešos funkcijos ----------

  let last = null; // paskutinė nustatyta vieta ir aplinka

  function isEnabled() { return load(SETTINGS_KEY, false) === true; }
  function setEnabled(on) { store(SETTINGS_KEY, !!on); if (!on) last = null; }

  /* Grąžina { pos, places, malls, source } arba meta klaidą su .code:
     'denied' (neleista), 'nopos' (vietos nepavyko nustatyti) */
  async function refresh() {
    let pos;
    try {
      pos = await getPosition();
    } catch (e) {
      const err = new Error('nopos');
      err.code = e && e.code === 1 ? 'denied' : 'nopos';
      throw err;
    }

    let data = cachedNear(pos);
    let source = 'cache';
    if (!data || Date.now() - data.time > 864e5) {
      try {
        data = parse(await fetchOverpass(buildQuery(pos)));
        saveToCache(pos, data);
        source = 'osm';
      } catch (e) {
        source = data ? 'cache' : 'none'; // be interneto — naudojame, ką turime
        data = data || { places: [], malls: [] };
      }
    }
    last = { pos, places: data.places, malls: data.malls, source };
    return last;
  }

  /* Kurioms kortelėms dabar tinka ši vieta.
     Grąžina Map: kortelės id → 'mall' | 'shop' | 'learned' */
  // Ar vieta pakankamai tiksli, kad galėtume sakyti, kurioje parduotuvėje esi
  function isAccurate(state = last) {
    return !!state && (state.pos.accuracy || 0) <= MAX_ACCURACY;
  }

  const dayKey = t => new Date(t).toISOString().slice(0, 10);

  // Išmokta vieta skaitosi tik tada, kai kortelė ten atidaryta bent 2 skirtingas dienas.
  // Taip vienas atidarymas namuose (pvz. tikrinant naują kortelę) nieko nesugadina.
  const placeIsLearned = pl => (pl.days ? pl.days.length : 0) >= LEARN_MIN_DAYS;

  /* Kurioms kortelėms dabar tinka ši vieta.
     Grąžina Map: kortelės id → 'shop' | 'mall' | 'learned' */
  function matchCards(cards, state = last) {
    const out = new Map();
    if (!state || !isAccurate(state)) return out;
    const { pos, places, malls } = state;
    const inMall = malls.length > 0;
    const acc = pos.accuracy || 0;
    const radius = Math.min(MAX_RADIUS, NEAR_RADIUS + acc);

    // 1) Kiekvienai kortelei — artimiausia jos tinklo parduotuvė
    const nearest = new Map(); // id → atstumas
    for (const card of cards) {
      const keys = keysForName(card.name);
      let best = Infinity, inSameMall = false;
      for (const p of places) {
        if (!nameMatches(keys, p.keys)) continue;
        best = Math.min(best, distance(pos, p));
        if (inMall) inSameMall = true;
      }
      if (best <= radius) nearest.set(card.id, best);
      else if (inSameMall) out.set(card.id, 'mall');
    }
    // 2) Jei šalia kelios parduotuvės (pvz. dvi vaistinės greta), siūlome tik artimiausią (±20 m)
    const dmin = Math.min(...nearest.values());
    for (const [id, d] of nearest) if (d <= dmin + 20) out.set(id, 'shop');

    // 3) Išmoktos vietos
    const learnR = Math.min(MAX_RADIUS, LEARN_RADIUS / 2 + acc);
    for (const card of cards) {
      if (out.has(card.id)) continue;
      if ((card.places || []).some(pl => placeIsLearned(pl) && distance(pos, pl) <= learnR)) out.set(card.id, 'learned');
    }
    return out;
  }

  // Atidarius kortelę įsimename vietą (jei vieta tiksli ir kortelė nėra ką tik pridėta)
  function learn(card) {
    if (!last || !isEnabled()) return false;
    const { pos } = last;
    const now = Date.now();
    if (now - pos.time > 3 * 60000 || pos.accuracy > 60) return false;
    if (card.createdAt && now - card.createdAt < 15 * 60000) return false; // ką tik pridėta — tikriausiai tikrini namuose
    const today = dayKey(now);
    const places = card.places || [];
    const near = places.find(pl => distance(pos, pl) < LEARN_RADIUS);
    if (near) {
      near.days = near.days || [];
      if (!near.days.includes(today)) near.days = [...near.days, today].slice(-10);
      near.time = now;
    } else {
      places.push({ lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5), time: now, days: [today] });
    }
    card.places = places.slice(-MAX_PLACES_PER_CARD);
    return true;
  }

  // Pamiršti visas kortelės išmoktas vietas
  function forget(card) {
    const had = (card.places || []).length;
    card.places = [];
    return had;
  }

  function mallName(state = last) {
    return state && state.malls.length ? state.malls[0] : null;
  }

  function brandSuggestions() {
    return [...new Set(BRANDS.map(b => b[0]))].sort((a, b) => a.localeCompare(b, 'lt'));
  }

  return { isEnabled, setEnabled, refresh, matchCards, learn, forget, isAccurate, mallName, brandSuggestions, get last() { return last; }, _norm: norm, _buildQuery: buildQuery };
})();
