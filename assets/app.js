(() => {
  "use strict";

  const CFG = window.JIMAT_CONFIG || {};
  const I18N = window.JIMAT_I18N || { en: {} };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const rm = (n) => "RM" + n.toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  // English -> Malay search helpers, so "egg" finds "telur" etc.
  const SYNONYMS = {
    rice: "beras", egg: "telur", eggs: "telur", oil: "minyak", sugar: "gula", flour: "tepung",
    chicken: "ayam", beef: "daging", meat: "daging", fish: "ikan", prawn: "udang", shrimp: "udang",
    milk: "susu", butter: "mentega", onion: "bawang", garlic: "bawang putih", potato: "kentang",
    cabbage: "kobis", banana: "pisang", bread: "roti", biscuit: "biskut", noodle: "mi", noodles: "mi",
    coffee: "kopi", tea: "teh", water: "air", salt: "garam", soy: "kicap", chili: "cili", chilli: "cili",
    sardine: "sardin", detergent: "pencuci", soap: "sabun", tissue: "tisu", diaper: "lampin",
    shampoo: "syampu", toothpaste: "ubat gigi", sauce: "sos", milo: "coklat malt",
    米: "beras", 鸡蛋: "telur", 蛋: "telur", 油: "minyak", 糖: "gula", 面粉: "tepung", 鸡: "ayam",
    牛肉: "daging", 鱼: "ikan", 虾: "udang", 牛奶: "susu", 奶: "susu", 洋葱: "bawang", 蒜: "bawang putih",
    马铃薯: "kentang", 包菜: "kobis", 香蕉: "pisang", 面包: "roti", 饼干: "biskut", 面: "mi", 咖啡: "kopi",
    茶: "teh", 水: "air", 盐: "garam", 酱油: "kicap", 沙丁鱼: "sardin", 纸巾: "tisu", 尿布: "lampin",
  };
  const STATES = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis",
    "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"];

  const ui = {
    q: "", state: "", type: "", category: "", aid: false, sort: "savings", limit: 60,
    lang: "en",
    basket: store.get("jb.basket", {}),
  };
  let DB = null;
  let HISTORY = null; // loaded lazily
  let PROMOS = [], AID = [];
  let ONLINE_AS_OF = null, ONLINE_SAMPLE = false;
  const PAGE = 60; // cards per "page" of results
  let chartScale = null; // set by historyHTML, used by bindChart

  // ---------- i18n ----------
  function t(key, vars) {
    let s = (I18N[ui.lang] && I18N[ui.lang][key]) ?? (I18N.en && I18N.en[key]) ?? key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  const catLabel = (c) => { const k = "cat." + c; const v = t(k); return v === k ? c : v; };
  const typeLabel = (ty) => t("type." + ty);
  const locale = () => ({ en: "en-MY", ms: "ms-MY", zh: "zh-MY" }[ui.lang] || "en-MY");
  function fmtDate(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
    return new Date(iso + "T00:00:00").toLocaleDateString(locale(), opts);
  }
  function applyI18n() {
    document.documentElement.lang = { en: "en", ms: "ms", zh: "zh-Hans" }[ui.lang];
    $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    $$("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    $$("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
    $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $("#lang").value = ui.lang;
  }

  // ---------- Data ----------
  async function getJSON(path, optional) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error(path + " (" + res.status + ")");
      return await res.json();
    } catch (e) {
      if (optional) return null;
      throw e;
    }
  }

  async function load() {
    const [raw, online, promos, community, aid] = await Promise.all([
      getJSON("data/prices.json"),
      getJSON("data/online.json", true),
      getJSON("data/promos.json", true),
      getJSON("data/community.json", true),
      getJSON("data/aid.json", true),
    ]);
    const storeById = new Map(raw.stores.map((s) => [s.id, s]));
    const itemById = new Map(raw.items.map((i) => [i.id, { ...i, search: i.name.toLowerCase() + " " + i.category.toLowerCase() }]));
    const byItem = new Map();
    const push = (itemId, o) => { if (!byItem.has(itemId)) byItem.set(itemId, []); byItem.get(itemId).push(o); };
    for (const [itemId, storeId, price, date] of raw.prices) {
      const s = storeById.get(storeId);
      if (s && itemById.has(itemId)) push(itemId, { store: s, price, date });
    }
    // Approved community reports appear as extra stores
    ((community && community.reports) || []).forEach((r, i) => {
      if (!itemById.has(r.itemId) || !(r.price > 0)) return;
      const s = { id: "c" + i, name: r.store, chain: "Community", type: r.type || "minimart",
        state: r.state, district: r.district || "", community: true, verified: !!r.verified };
      push(r.itemId, { store: s, price: r.price, date: r.date });
    });
    // Prices from retailers' own websites (scripts/fetch_online_prices.py).
    // They're separate products (online catalogues are far bigger than the
    // PriceCatcher list) and apply in every state.
    const webStores = new Map();
    for (const p of (online && online.products) || []) {
      if (!itemById.has(p.id)) {
        itemById.set(p.id, { id: p.id, name: p.name, unit: p.unit, category: p.category, online: true,
          search: p.name.toLowerCase() + " " + p.category.toLowerCase() });
      }
      for (const [retailer, price, url, inStock, date] of p.offers) {
        if (!webStores.has(retailer)) {
          webStores.set(retailer, { id: "web:" + retailer, name: retailer, chain: retailer, type: "online", state: "", district: "", online: true });
        }
        push(p.id, { store: webStores.get(retailer), price, date, url, inStock: !!inStock });
      }
    }
    ONLINE_AS_OF = online && online.products && online.products.length ? online.asOf : null;
    ONLINE_SAMPLE = !!(online && online.source === "sample");
    for (const list of byItem.values()) list.sort((a, b) => a.price - b.price);

    AID = (aid && aid.programmes) || [];
    for (const item of itemById.values()) {
      const name = item.name.toLowerCase();
      item.aid = AID.filter((p) => p.keywords.some((k) => name.includes(k)));
    }
    const today = todayISO();
    PROMOS = ((promos && promos.promos) || []).filter((p) => p.validFrom <= today && today <= p.validTo);
    DB = { ...raw, storeById, itemById, byItem };
  }

  async function loadHistory() {
    if (HISTORY === null) HISTORY = (await getJSON("data/history.json", true)) || false;
    return HISTORY;
  }

  function offersFor(itemId) {
    const all = DB.byItem.get(itemId) || [];
    return all.filter((o) => (!ui.state || o.store.online || o.store.state === ui.state) && (!ui.type || o.store.type === ui.type));
  }
  function promosInScope() {
    return PROMOS.filter((p) => !ui.state || !p.states.length || p.states.includes(ui.state));
  }
  function dealsFor(itemId) {
    const out = [];
    for (const p of promosInScope()) for (const d of p.deals) if (d.itemId === itemId) out.push({ promo: p, ...d });
    return out.sort((a, b) => a.price - b.price);
  }

  function matchesQuery(item) {
    const q = ui.q.trim().toLowerCase();
    if (!q) return true;
    return q.split(/\s+/).every((w) => item.search.includes(w) || (SYNONYMS[w] && item.search.includes(SYNONYMS[w])));
  }

  // ---------- Filters ----------
  function renderFilters() {
    const states = [...new Set(DB.stores.map((s) => s.state))].sort();
    const sel = $("#state");
    sel.innerHTML = `<option value="">${esc(t("state.all"))}</option>` + states.map((s) => `<option>${esc(s)}</option>`).join("");
    sel.value = ui.state;

    const cats = [...new Set([...DB.itemById.values()].map((i) => i.category))].sort();
    $("#categories").innerHTML =
      `<button class="chip ${ui.category ? "" : "active"}" data-cat="">${esc(t("cat.all"))}</button>` +
      (AID.length ? `<button class="chip chip-aid ${ui.aid ? "active" : ""}" data-aid aria-pressed="${ui.aid}">🏷️ ${esc(t("filter.aid"))}</button>` : "") +
      cats.map((c) => `<button class="chip ${ui.category === c ? "active" : ""}" data-cat="${esc(c)}">${esc(catLabel(c))}</button>`).join("");

    $("#dataSource").innerHTML = (DB.source === "pricecatcher" ? t("footer.source", { d: fmtDate(DB.asOf) }) : esc(t("footer.demo", { d: fmtDate(DB.asOf) })))
      + (ONLINE_AS_OF ? " " + esc(t(ONLINE_SAMPLE ? "footer.onlineDemo" : "footer.online", { d: fmtDate(ONLINE_AS_OF) })) : "");
    $("#sampleBanner").hidden = DB.source !== "sample";
  }

  // ---------- Results ----------
  function computeRows() {
    const rows = [];
    for (const item of DB.itemById.values()) {
      if (ui.category && item.category !== ui.category) continue;
      if (ui.aid && !item.aid.length) continue;
      if (!matchesQuery(item)) continue;
      const offers = offersFor(item.id);
      if (!offers.length) continue;
      const min = offers[0].price, max = offers[offers.length - 1].price;
      rows.push({ item, offers, min, max, savePct: max > 0 ? (max - min) / max : 0 });
    }
    const sorters = {
      savings: (a, b) => b.savePct - a.savePct,
      price: (a, b) => a.min - b.min,
      name: (a, b) => a.item.name.localeCompare(b.item.name),
    };
    return rows.sort(sorters[ui.sort]);
  }

  function renderResults() {
    const rows = computeRows();
    const storesInScope = new Set();
    rows.forEach((r) => r.offers.forEach((o) => storesInScope.add(o.store.id)));
    const avgSave = rows.length ? rows.reduce((s, r) => s + r.savePct, 0) / rows.length : 0;

    $("#stats").innerHTML = `
      <div class="stat"><b>${rows.length}</b><span>${esc(t("stats.products"))}</span></div>
      <div class="stat"><b>${storesInScope.size.toLocaleString()}</b><span>${esc(t("stats.stores"))}</span></div>
      <div class="stat"><b>${Math.round(avgSave * 100)}%</b><span>${esc(t("stats.gap"))}</span></div>`;

    const where = [ui.state || t("state.all"), ui.type ? typeLabel(ui.type) : null].filter(Boolean).join(" · ");
    $("#resultMeta").textContent = rows.length ? t("meta.results", { n: rows.length, where }) : "";

    const html = [];
    if (rows.length) html.push(featuredHTML());
    rows.slice(0, ui.limit).forEach((r, i) => {
      html.push(cardHTML(r));
      if (i === 7) html.push(inlineAdHTML());
    });
    $("#results").innerHTML = html.join("");
    $("#moreResults").hidden = rows.length <= ui.limit;
    $("#moreResults").textContent = t("results.more", { n: (rows.length - ui.limit).toLocaleString() });
    $("#empty").hidden = rows.length > 0;
    renderDeals();
    pushAds();
  }

  function whereOf(o) {
    return o.store.online ? t("online.where") : [o.store.district, o.store.state].filter(Boolean).join(", ");
  }

  function aidTags(item) {
    return item.aid.map((p) => `<span class="aid-tag aid-${esc(p.id)}" title="${esc(p.name)}">${esc(p.label)}</span>`).join("");
  }

  function cardHTML({ item, offers, max, savePct }) {
    const best = offers[0];
    const inBasket = !!ui.basket[item.id];
    const promo = dealsFor(item.id).length > 0;
    return `
      <article class="card" data-item="${item.id}" tabindex="0">
        <div class="card-top">
          <div>
            <div class="card-cat">${esc(catLabel(item.category))}</div>
            <h3>${esc(item.name)}</h3>
            <div class="card-unit">${esc(item.unit)} ${aidTags(item)}</div>
          </div>
          <div class="card-badges">
            ${savePct >= 0.05 ? `<span class="save-badge">${esc(t("card.save", { n: Math.round(savePct * 100) }))}</span>` : ""}
            ${promo ? `<span class="promo-badge">🔥 ${esc(t("card.promo"))}</span>` : ""}
          </div>
        </div>
        <div class="best">
          <div class="best-label">${esc(t("card.cheapest"))}</div>
          <div class="best-price"><small>RM</small>${best.price.toFixed(2)}</div>
          <div class="best-store">${esc(best.store.name)}${best.store.community ? ` <span class="tag tag-community">${esc(t("detail.community"))}</span>` : ""}</div>
          <div class="best-where">${esc(whereOf(best))}</div>
        </div>
        <div class="card-foot">
          <span>${esc(t("card.stores", { n: offers.length, max: rm(max) }))}</span>
          <button class="add-btn ${inBasket ? "added" : ""}" data-add="${item.id}" aria-pressed="${inBasket}">
            ${esc(inBasket ? t("card.added") : t("card.add"))}
          </button>
        </div>
      </article>`;
  }

  // ---------- Deals (weekly promos) ----------
  function renderDeals() {
    const promos = promosInScope();
    $("#deals").hidden = !promos.length;
    $("#dealsRow").innerHTML = promos.map((p) => `
      <article class="deal-card">
        <div class="deal-head">
          <div><b>${esc(p.chain)}</b><span>${esc(p.title)}</span></div>
          <span class="deal-until">${esc(t("deals.until", { d: fmtDate(p.validTo, { day: "numeric", month: "short" }) }))}</span>
        </div>
        <ul>${p.deals.filter((d) => DB.itemById.has(d.itemId)).slice(0, 3).map((d) => {
          const it = DB.itemById.get(d.itemId);
          return `<li><button class="deal-item" data-open-item="${d.itemId}">
            <span>${esc(it.name)} <small>${esc(it.unit)}</small></span>
            <span class="deal-price">${rm(d.price)}${d.was ? `<s>${rm(d.was)}</s>` : ""}</span></button></li>`;
        }).join("")}</ul>
        ${p.url ? `<a class="deal-link" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t("deals.view"))} →</a>` : ""}
      </article>`).join("");
  }

  // ---------- Ads & featured ----------
  function houseAd(i, cls = "") {
    const list = (CFG.ads && CFG.ads.house) || [];
    if (!list.length) return "";
    const ad = list[i % list.length];
    return `<a class="house-ad ${cls}" href="${esc(ad.url)}" target="_blank" rel="noopener sponsored">
      <span class="house-ad-icon">📣</span>
      <div><h3>${esc(ad.title)}</h3><p>${esc(ad.text)}</p></div>
      <span class="btn btn-outline">${esc(ad.cta)}</span></a>`;
  }
  const adsense = () => (CFG.ads && CFG.ads.adsense && CFG.ads.adsense.client) || "";
  function adsenseUnit(slot) {
    return `<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(adsense())}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  }
  function inlineAdHTML() {
    const inner = adsense() ? adsenseUnit(CFG.ads.adsense.slots.inline) : houseAd(1);
    return inner ? `<aside class="ad ad-card" data-label="${esc(t("ad.sponsored"))}" aria-label="Sponsored">${inner}</aside>` : "";
  }
  function featuredHTML() {
    const f = (CFG.featured || [])[0];
    if (!f) return "";
    return `<a class="card featured-card" href="${esc(f.url)}" target="_blank" rel="noopener sponsored">
      <span class="featured-badge">⭐ ${esc(f.badge || t("ad.featured"))} · ${esc(t("ad.sponsored"))}</span>
      <h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>
      <span class="btn btn-primary">${esc(f.cta)}</span></a>`;
  }
  function pushAds() {
    if (!adsense()) return;
    $$("ins.adsbygoogle:not([data-adsbygoogle-status])").forEach(() => {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ }
    });
  }
  function initAds() {
    if (adsense()) {
      const s = document.createElement("script");
      s.async = true; s.crossOrigin = "anonymous";
      s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(adsense());
      document.head.appendChild(s);
      $("#adTop").innerHTML = adsenseUnit(CFG.ads.adsense.slots.top);
    } else {
      $("#adTop").innerHTML = houseAd(0);
    }
  }
  function labelAds() { $$(".ad").forEach((a) => (a.dataset.label = t("ad.sponsored"))); }

  // ---------- Price history chart ----------
  function historyHTML(itemId) {
    if (!HISTORY || !HISTORY.items || !HISTORY.items[itemId]) return "";
    const { min: lo, med } = HISTORY.items[itemId];
    const dates = HISTORY.dates;
    const pts = lo.map((v, i) => ({ i, d: dates[i], lo: v, med: med[i] })).filter((p) => p.lo != null && p.med != null);
    if (pts.length < 2) return "";

    // verdict: today's lowest vs its own 90-day range
    const cur = pts[pts.length - 1].lo;
    const loMin = Math.min(...pts.map((p) => p.lo));
    const loAvg = pts.reduce((s, p) => s + p.lo, 0) / pts.length;
    const verdict = cur <= loMin + 0.005 ? ["good", "✅", t("detail.verdictBest")]
      : cur < loAvg ? ["ok", "👍", t("detail.verdictBelow")]
      : ["wait", "⏳", t("detail.verdictAbove")];

    const W = 440, H = 200, L = 44, R = 62, T = 12, B = 26;
    const vals = pts.flatMap((p) => [p.lo, p.med]);
    let yMin = Math.min(...vals), yMax = Math.max(...vals);
    const pad = (yMax - yMin) * 0.12 || yMax * 0.05;
    yMin = Math.max(0, yMin - pad); yMax += pad;
    const n = dates.length - 1;
    const x = (i) => L + (i / n) * (W - L - R);
    const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
    chartScale = { L, PW: W - L - R, n, y };
    const path = (key) => pts.map((p, k) => (k ? "L" : "M") + x(p.i).toFixed(1) + " " + y(p[key]).toFixed(1)).join("");

    const ticks = [];
    for (let k = 0; k <= 3; k++) ticks.push(yMin + ((yMax - yMin) * k) / 3);
    const xTicks = [0, Math.round(n / 2), n];
    const last = pts[pts.length - 1];
    let yLo = y(last.lo), yMed = y(last.med);
    if (Math.abs(yLo - yMed) < 14) { const mid = (yLo + yMed) / 2; yLo = mid + 7; yMed = mid - 7; }

    const svg = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("detail.history"))}">
        ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
          <text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(v < 10 ? 2 : 0)}</text>`).join("")}
        ${xTicks.map((i, k) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${["start", "middle", "end"][k]}">${esc(fmtDate(dates[i], { day: "numeric", month: "short" }))}</text>`).join("")}
        <path class="ln ln-med" d="${path("med")}"/>
        <path class="ln ln-min" d="${path("lo")}"/>
        <circle class="dot dot-med" cx="${x(last.i)}" cy="${y(last.med)}" r="4"/>
        <circle class="dot dot-min" cx="${x(last.i)}" cy="${y(last.lo)}" r="4"/>
        <text class="end-label" x="${x(last.i) + 8}" y="${yMed + 4}">${rm(last.med)}</text>
        <text class="end-label strong" x="${x(last.i) + 8}" y="${yLo + 4}">${rm(last.lo)}</text>
        <g class="hover" hidden>
          <line class="crosshair" y1="${T}" y2="${H - B}"/>
          <circle class="dot dot-med" r="4"/><circle class="dot dot-min" r="4"/>
        </g>
        <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
      </svg>`;

    const weekly = pts.filter((_, k) => (pts.length - 1 - k) % 7 === 0).reverse();
    return `
      <p class="section-title">${esc(t("detail.history"))}</p>
      <div class="verdict verdict-${verdict[0]}"><span aria-hidden="true">${verdict[1]}</span> ${esc(verdict[2])}</div>
      <div class="chart-card">
        <div class="legend">
          <span><i class="sw sw-min"></i>${esc(t("detail.lowestLine"))}</span>
          <span><i class="sw sw-med"></i>${esc(t("detail.typicalLine"))}</span>
        </div>
        <div class="chart-wrap" id="chartWrap">${svg}<div class="tip" hidden></div></div>
        <details class="chart-table"><summary>${esc(t("detail.table"))}</summary>
          <table><thead><tr><th>${esc(t("detail.date"))}</th><th>${esc(t("detail.lowestLine"))}</th><th>${esc(t("detail.typicalLine"))}</th></tr></thead>
          <tbody>${weekly.map((p) => `<tr><td>${esc(fmtDate(p.d))}</td><td>${rm(p.lo)}</td><td>${rm(p.med)}</td></tr>`).join("")}</tbody></table>
        </details>
      </div>`;
  }

  function bindChart(itemId) {
    const wrap = $("#chartWrap");
    if (!wrap) return;
    const { min: lo, med } = HISTORY.items[itemId];
    const dates = HISTORY.dates;
    const svg = wrap.querySelector("svg"), g = svg.querySelector(".hover"), tip = wrap.querySelector(".tip");
    const hit = svg.querySelector(".hit");
    const { L, PW, n } = chartScale;
    const yOf = chartScale.y;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
      const i = Math.max(0, Math.min(n, Math.round(((sx - L) / PW) * n)));
      if (lo[i] == null || med[i] == null) return;
      const cx = L + (i / n) * PW;
      g.hidden = false;
      g.querySelector(".crosshair").setAttribute("x1", cx); g.querySelector(".crosshair").setAttribute("x2", cx);
      const [dm, dd] = [g.querySelector(".dot-min"), g.querySelector(".dot-med")];
      dm.setAttribute("cx", cx); dm.setAttribute("cy", yOf(lo[i]));
      dd.setAttribute("cx", cx); dd.setAttribute("cy", yOf(med[i]));
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(fmtDate(dates[i]))}</b>
        <span><i class="sw sw-min"></i>${esc(t("detail.lowestLine"))} <b>${rm(lo[i])}</b></span>
        <span><i class="sw sw-med"></i>${esc(t("detail.typicalLine"))} <b>${rm(med[i])}</b></span>`;
      const px = (cx / svg.viewBox.baseVal.width) * r.width;
      tip.style.left = Math.min(Math.max(px, 70), r.width - 70) + "px";
    };
    const leave = () => { g.hidden = true; tip.hidden = true; };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }

  // ---------- Detail drawer ----------
  async function openDetail(itemId) {
    const item = DB.itemById.get(itemId);
    const offers = offersFor(itemId);
    if (!item || !offers.length) return;
    $("#detail").dataset.item = itemId;
    const min = offers[0].price, max = offers[offers.length - 1].price;
    const avg = offers.reduce((s, o) => s + o.price, 0) / offers.length;
    const inBasket = !!ui.basket[itemId];
    const LIMIT = 25;

    $("#detailCat").textContent = catLabel(item.category);
    $("#detailTitle").textContent = item.name;
    $("#detailUnit").textContent = `${item.unit} · ${ui.state || t("state.all")}`;

    const li = (o, i) => `
      <li class="${i === 0 ? "top" : ""}">
        <span class="rank-no">${i + 1}</span>
        <div>
          <div class="rank-store">${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.store.name)} ↗</a>` : esc(o.store.name)}<span class="tag ${o.store.online ? "tag-online" : ""}">${esc(typeLabel(o.store.type))}</span>${o.inStock === false
            ? `<span class="tag tag-oos">${esc(t("detail.outOfStock"))}</span>` : ""}${o.store.community
            ? `<span class="tag tag-community">${esc(t("detail.community"))}${o.store.verified ? " ✓" : ""}</span>` : ""}</div>
          <div class="rank-where">${esc(whereOf(o))} · ${esc(fmtDate(o.date))}</div>
        </div>
        <div class="rank-price">${rm(o.price)}
          <span class="rank-diff">${i === 0 ? esc(t("card.cheapest")) : "+" + rm(o.price - min)}</span></div>
      </li>`;

    const deals = dealsFor(itemId);
    const dealsHTML = deals.length ? `
      <p class="section-title">🔥 ${esc(t("detail.promos"))}</p>
      <div class="promo-list">${deals.map((d) => `
        <a class="promo-row" ${d.promo.url ? `href="${esc(d.promo.url)}" target="_blank" rel="noopener"` : ""}>
          <span><b>${esc(d.promo.chain)}</b> · ${esc(d.promo.title)}<small>${esc(t("deals.until", { d: fmtDate(d.promo.validTo) }))}</small></span>
          <span class="deal-price">${rm(d.price)}${d.was ? `<s>${rm(d.was)}</s>` : ""}</span>
        </a>`).join("")}</div>` : "";

    const aidHTML = item.aid.length ? `<div class="aid-info">${item.aid.map((p) =>
      `<p><span class="aid-tag aid-${esc(p.id)}">${esc(p.label)}</span> ${esc((p.info && (p.info[ui.lang] || p.info.en)) || p.name)}</p>`).join("")}</div>` : "";

    const shops = CFG.shopOnline || [];
    const onlineHTML = shops.length ? `
      <p class="section-title">🛍️ ${esc(t("detail.buyOnline"))}</p>
      <div class="online-row">${shops.map((s) => `<a class="btn btn-outline" href="${esc(s.url.replace("{q}", encodeURIComponent(item.name)))}" target="_blank" rel="noopener sponsored">${esc(s.name)} ↗</a>`).join("")}</div>` : "";

    const render = () => {
      $("#detailBody").innerHTML = `
        <div class="summary">
          <div><b>${rm(min)}</b><span>${esc(t("detail.lowest"))}</span></div>
          <div><b>${rm(avg)}</b><span>${esc(t("detail.average"))}</span></div>
          <div><b>${rm(max)}</b><span>${esc(t("detail.highest"))}</span></div>
        </div>
        ${aidHTML}
        <button class="btn btn-primary btn-block" data-add="${itemId}">${esc(inBasket ? t("detail.added") : t("detail.add"))}</button>
        ${dealsHTML}
        ${HISTORY ? historyHTML(itemId) : ""}
        <p class="section-title">${esc(t("detail.cheapestFirst", { n: offers.length }))}</p>
        <ol class="rank" id="rankList">${offers.slice(0, LIMIT).map(li).join("")}</ol>
        ${offers.length > LIMIT ? `<button class="btn btn-outline btn-block" id="moreStores" style="margin-top:10px">${esc(t("detail.showAll", { n: offers.length }))}</button>` : ""}
        <button class="link-btn" data-open-report="${itemId}">📸 ${esc(t("detail.reportLower"))}</button>
        ${onlineHTML}`;
      const more = $("#moreStores");
      if (more) more.onclick = () => { $("#rankList").innerHTML = offers.map(li).join(""); more.remove(); };
      if (HISTORY) bindChart(itemId);
    };
    const keepScroll = $("#detail").hidden ? 0 : $("#detailBody").scrollTop;
    render();
    openPanel("#detail");
    $("#detailBody").scrollTop = keepScroll;
    if (HISTORY === null) {
      await loadHistory();
      if (HISTORY && Number($("#detail").dataset.item) === itemId && !$("#detail").hidden) render();
    }
  }

  // ---------- Basket ----------
  function basketIds() { return Object.keys(ui.basket).map(Number).filter((id) => DB.itemById.has(id)); }

  function toggleBasket(itemId) {
    if (ui.basket[itemId]) { delete ui.basket[itemId]; toast(t("toast.removed")); }
    else { ui.basket[itemId] = 1; toast(t("toast.added")); }
    saveBasket();
  }
  function saveBasket() {
    store.set("jb.basket", ui.basket);
    $("#basketCount").textContent = basketIds().length;
    renderResults();
    if (!$("#basket").hidden) renderBasket();
    if (!$("#detail").hidden) openDetail(Number($("#detail").dataset.item));
  }

  function renderBasket() {
    const ids = basketIds();
    const body = $("#basketBody");
    if (!ids.length) {
      body.innerHTML = `<div class="empty"><div class="empty-emoji">🧺</div><p>${t("basket.empty")}</p></div>`;
      return;
    }
    const lines = ids.map((id) => ({ item: DB.itemById.get(id), qty: ui.basket[id], offers: offersFor(id) }));

    // Option A: cheapest mix (buy each item wherever it's cheapest)
    let mixTotal = 0; const mixStores = new Map(); const missing = [];
    for (const l of lines) {
      if (!l.offers.length) { missing.push(l.item.name); continue; }
      const o = l.offers[0];
      mixTotal += o.price * l.qty;
      mixStores.set(o.store.name, (mixStores.get(o.store.name) || 0) + 1);
    }

    // Option B: one-stop shop (single store with the lowest total)
    const perStore = new Map();
    for (const l of lines) {
      for (const o of l.offers) {
        const e = perStore.get(o.store.id) || { store: o.store, total: 0, count: 0 };
        e.total += o.price * l.qty; e.count++;
        perStore.set(o.store.id, e);
      }
    }
    const needed = lines.filter((l) => l.offers.length).length;
    const full = [...perStore.values()].filter((e) => e.count === needed).sort((a, b) => a.total - b.total);
    const worst = lines.reduce((s, l) => s + (l.offers.length ? l.offers[l.offers.length - 1].price * l.qty : 0), 0);

    const itemsHTML = lines.map((l) => `
      <div class="basket-item">
        <div class="grow"><b>${esc(l.item.name)}</b>
          <span>${esc(l.item.unit)} · ${esc(l.offers.length ? t("basket.from", { p: rm(l.offers[0].price) }) : t("basket.na"))}</span></div>
        <div class="qty">
          <button data-qty="${l.item.id}" data-d="-1" aria-label="−">−</button>
          <output>${l.qty}</output>
          <button data-qty="${l.item.id}" data-d="1" aria-label="+">+</button>
        </div>
      </div>`).join("");

    const oneStop = full.length
      ? full.slice(0, 3).map((e, i) => `
        <div class="plan ${i === 0 && e.total - mixTotal < 0.005 ? "win" : ""}">
          <div class="plan-head"><b>${i === 0 ? "🏪 " : ""}${esc(e.store.name)}</b><span class="plan-total">${rm(e.total)}</span></div>
          <p>${esc([e.store.district, e.store.state].filter(Boolean).join(", "))} · ${esc(t("basket.allin", { n: needed }))}${i === 0 ? " · " + esc(t("basket.more", { p: rm(e.total - mixTotal) })) : ""}</p>
        </div>`).join("")
      : `<div class="plan"><p>${esc(t("basket.nostore"))}</p></div>`;

    body.innerHTML = `
      <div class="basket-list">${itemsHTML}</div>
      <p class="section-title">${esc(t("basket.mix"))}</p>
      <div class="plan win">
        <div class="plan-head"><b>${esc(t("basket.lowest"))}</b><span class="plan-total">${rm(mixTotal)}</span></div>
        <p>${t("basket.save", { p: rm(worst - mixTotal) })}</p>
        <ul>${[...mixStores].map(([n, c]) => `<li>${esc(n)} — ${esc(t("basket.nItems", { n: c }))}</li>`).join("")}</ul>
      </div>
      ${missing.length ? `<p class="muted small-print">${esc(t("basket.notfound"))} ${missing.map(esc).join(", ")}</p>` : ""}
      <p class="section-title">${esc(t("basket.onestop"))}</p>
      ${oneStop}
      <button class="btn btn-outline btn-block" id="clearBasket" style="margin-top:20px">${esc(t("basket.clear"))}</button>`;
  }

  // ---------- Report a price ----------
  function openReport(itemId) {
    const items = [...DB.itemById.values()].filter((i) => !i.online).sort((a, b) => a.name.localeCompare(b.name));
    $("#rItem").innerHTML = items.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join("") +
      `<option value="other">${esc(t("submit.itemOther"))}</option>`;
    if (itemId) $("#rItem").value = String(itemId);
    $("#rOtherWrap").hidden = $("#rItem").value !== "other";
    $("#rState").innerHTML = STATES.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#rState").value = ui.state || "Selangor";
    $("#rDate").value = todayISO(); $("#rDate").max = todayISO();
    $("#rStatus").textContent = "";
    openPanel("#report");
  }

  async function sendReport(e) {
    e.preventDefault();
    const form = e.target, fd = new FormData(form), status = $("#rStatus"), btn = $("#rSend");
    if (fd.get("_gotcha")) return;
    const itemId = fd.get("itemId");
    const it = DB.itemById.get(Number(itemId));
    fd.set("itemLabel", it ? `${it.name} (${it.unit})` : fd.get("itemName") || "");
    const cfg = CFG.submit || {};
    if (cfg.endpoint) {
      btn.disabled = true; btn.textContent = t("submit.sending");
      try {
        const res = await fetch(cfg.endpoint, { method: "POST", body: fd, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(res.status);
        status.textContent = t("submit.thanks"); form.reset(); $("#rDate").value = todayISO();
      } catch {
        status.textContent = t("submit.error");
      } finally {
        btn.disabled = false; btn.textContent = t("submit.send");
      }
      return;
    }
    const body = ["itemLabel", "itemId", "store", "type", "area", "state", "price", "date", "email"]
      .map((k) => `${k}: ${fd.get(k) || ""}`).join("\n");
    status.textContent = t("submit.mailto");
    location.href = `mailto:${encodeURIComponent(cfg.email || "")}?subject=${encodeURIComponent("JimatBasket price report")}&body=${encodeURIComponent(body)}`;
  }

  // ---------- Panels, modal, toast ----------
  let lastFocus = null;
  function openPanel(sel) {
    if (!$(sel).hidden) return;
    lastFocus = lastFocus || document.activeElement;
    $$(".drawer, .modal").forEach((el) => { if ("#" + el.id !== sel) el.hidden = true; });
    $(sel).hidden = false;
    $("#overlay").hidden = !$(sel).classList.contains("drawer");
    document.body.style.overflow = "hidden";
    const c = $(sel).querySelector("[data-close]"); if (c) c.focus();
  }
  function closePanels() {
    $$(".drawer, .modal").forEach((el) => (el.hidden = true));
    $("#overlay").hidden = true;
    document.body.style.overflow = "";
    if (lastFocus) { lastFocus.focus({ preventScroll: true }); lastFocus = null; }
  }
  let toastTimer;
  function toast(msg) {
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 1800);
  }

  function renderSupport() {
    const s = CFG.support || {};
    const msg = typeof s.message === "object" ? s.message[ui.lang] || s.message.en : s.message;
    $("#supportMsg").textContent = msg || "";
    $("#supportLinks").innerHTML = (s.links || []).map((l) =>
      `<a class="btn btn-primary" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.icon || "")} ${esc(l.label)}</a>`).join("");
    $("#supportQr").innerHTML = s.duitNowQr
      ? `<p class="section-title">DuitNow / Touch 'n Go</p><img src="${esc(s.duitNowQr)}" alt="DuitNow QR" />` : "";
  }

  // ---------- Theme & language ----------
  function applyTheme(th) {
    document.documentElement.dataset.theme = th;
    $("#themeToggle").textContent = th === "dark" ? "☀️" : "🌙";
  }
  function setLang(l) {
    ui.lang = I18N[l] ? l : "en";
    store.set("jb.lang", ui.lang);
    applyI18n(); labelAds(); renderSupport();
    if (!DB) return;
    renderFilters(); renderResults();
    if (!$("#basket").hidden) renderBasket();
    if (!$("#detail").hidden) openDetail(Number($("#detail").dataset.item));
  }

  // ---------- URL state ----------
  function readURL() {
    const p = new URLSearchParams(location.search);
    ui.q = p.get("q") || ""; ui.state = p.get("state") || ui.state; ui.type = p.get("type") || "";
    if (p.get("lang")) ui.lang = p.get("lang");
    $("#q").value = ui.q;
    $$("#storeTypes .chip").forEach((c) => c.classList.toggle("active", c.dataset.type === ui.type));
  }
  function writeURL() {
    const p = new URLSearchParams();
    if (ui.q) p.set("q", ui.q); if (ui.state) p.set("state", ui.state); if (ui.type) p.set("type", ui.type);
    history.replaceState(null, "", p.toString() ? "?" + p : location.pathname);
  }

  // ---------- Events ----------
  function bind() {
    let timer;
    $("#q").addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { ui.q = e.target.value; writeURL(); refresh(); }, 120);
    });
    $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); $("#q").blur(); });
    $("#state").addEventListener("change", (e) => { ui.state = e.target.value; store.set("jb.state", ui.state); writeURL(); refresh(); });
    $("#sort").addEventListener("change", (e) => { ui.sort = e.target.value; refresh(); });
    $("#lang").addEventListener("change", (e) => setLang(e.target.value));

    $("#storeTypes").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      ui.type = b.dataset.type;
      $$("#storeTypes .chip").forEach((c) => c.classList.toggle("active", c === b));
      writeURL(); refresh();
    });
    $("#categories").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      if (b.hasAttribute("data-aid")) {
        ui.aid = !ui.aid;
        b.classList.toggle("active", ui.aid); b.setAttribute("aria-pressed", ui.aid);
      } else {
        ui.category = b.dataset.cat;
        $$("#categories .chip[data-cat]").forEach((c) => c.classList.toggle("active", c === b));
      }
      refresh();
    });
    $("#rItem").addEventListener("change", (e) => {
      $("#rOtherWrap").hidden = e.target.value !== "other";
      $("#rOther").required = e.target.value === "other";
    });
    $("#reportForm").addEventListener("submit", sendReport);
    $("#moreResults").addEventListener("click", () => { ui.limit += PAGE; renderResults(); });

    document.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add) { e.stopPropagation(); toggleBasket(Number(add.dataset.add)); return; }
      const qty = e.target.closest("[data-qty]");
      if (qty) {
        const id = Number(qty.dataset.qty);
        ui.basket[id] = (ui.basket[id] || 0) + Number(qty.dataset.d);
        if (ui.basket[id] <= 0) delete ui.basket[id];
        saveBasket(); return;
      }
      if (e.target.closest("#clearBasket")) { ui.basket = {}; saveBasket(); return; }
      const rep = e.target.closest("[data-open-report]");
      if (rep) { closePanelsSoft(); openReport(Number(rep.dataset.openReport) || 0); return; }
      const oi = e.target.closest("[data-open-item]");
      if (oi) { openDetail(Number(oi.dataset.openItem)); return; }
      const card = e.target.closest(".card[data-item]");
      if (card) { openDetail(Number(card.dataset.item)); return; }
      if (e.target.closest("[data-open-support]")) { closePanelsSoft(); openPanel("#support"); return; }
      if (e.target.closest("[data-close]") || e.target === $("#overlay") || e.target === $("#support")) closePanels();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanels();
      if (e.key === "Enter" && e.target.matches(".card[data-item]")) e.target.click();
      if (e.key === "/" && !e.target.matches("input, select, textarea")) { e.preventDefault(); $("#q").focus(); }
    });

    $("#openBasket").addEventListener("click", () => { closePanelsSoft(); renderBasket(); openPanel("#basket"); });
    $("#themeToggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      store.set("jb.theme", next); applyTheme(next);
    });
    $("#shareBtn").addEventListener("click", async () => {
      const data = { title: "JimatBasket", text: "Compare grocery prices across Malaysian supermarkets 🧺", url: location.origin + location.pathname };
      try {
        if (navigator.share) await navigator.share(data);
        else { await navigator.clipboard.writeText(data.url); toast(t("toast.copied")); }
      } catch { /* cancelled */ }
    });
  }
  // filters changed: start again from the first page of results
  function refresh() { ui.limit = PAGE; renderResults(); }
  // switch between panels without losing the original focus target
  function closePanelsSoft() { $$(".drawer, .modal").forEach((el) => (el.hidden = true)); }

  // ---------- Boot ----------
  async function init() {
    applyTheme(store.get("jb.theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    ui.state = store.get("jb.state", "");
    ui.lang = store.get("jb.lang", CFG.defaultLang || "en");
    readURL();
    initAds();
    setLang(ui.lang);
    bind();
    try {
      await load();
    } catch (err) {
      $("#results").innerHTML = `<div class="notice">⚠️ ${esc(err.message)}. If you opened the file directly, run a local server (see README).</div>`;
      return;
    }
    renderFilters();
    $("#basketCount").textContent = basketIds().length;
    renderResults();
  }
  init();
})();
