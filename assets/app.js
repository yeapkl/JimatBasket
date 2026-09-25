(() => {
  "use strict";

  const CFG = window.JIMAT_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const rm = (n) => "RM" + n.toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // English -> Malay search helpers, so "egg" finds "telur" etc.
  const SYNONYMS = {
    rice: "beras", egg: "telur", eggs: "telur", oil: "minyak", sugar: "gula", flour: "tepung",
    chicken: "ayam", beef: "daging", meat: "daging", fish: "ikan", prawn: "udang", shrimp: "udang",
    milk: "susu", butter: "mentega", onion: "bawang", garlic: "bawang putih", potato: "kentang",
    cabbage: "kobis", banana: "pisang", bread: "roti", biscuit: "biskut", noodle: "mi", noodles: "mi",
    coffee: "kopi", tea: "teh", water: "air", salt: "garam", soy: "kicap", chili: "cili", chilli: "cili",
    sardine: "sardin", detergent: "pencuci", soap: "sabun", tissue: "tisu", diaper: "lampin",
    shampoo: "syampu", toothpaste: "ubat gigi", sauce: "sos", milo: "coklat malt",
  };

  const TYPE_LABEL = { hypermarket: "Hypermarket", supermarket: "Supermarket", minimart: "Mini market", convenience: "Convenience" };

  const ui = {
    q: "", state: "", type: "", category: "", sort: "savings",
    basket: store.get("jb.basket", {}),
  };
  let DB = null; // { items, stores, byItem: Map<itemId, offer[]>, itemById, storeById }

  // ---------- Data ----------
  async function load() {
    const res = await fetch("data/prices.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load prices (" + res.status + ")");
    const raw = await res.json();
    const storeById = new Map(raw.stores.map((s) => [s.id, s]));
    const itemById = new Map(raw.items.map((i) => [i.id, { ...i, search: i.name.toLowerCase() + " " + i.category.toLowerCase() }]));
    const byItem = new Map();
    for (const [itemId, storeId, price, date] of raw.prices) {
      const s = storeById.get(storeId);
      if (!s || !itemById.has(itemId)) continue;
      if (!byItem.has(itemId)) byItem.set(itemId, []);
      byItem.get(itemId).push({ store: s, price, date });
    }
    for (const list of byItem.values()) list.sort((a, b) => a.price - b.price);
    DB = { ...raw, storeById, itemById, byItem };
  }

  function offersFor(itemId) {
    const all = DB.byItem.get(itemId) || [];
    return all.filter((o) => (!ui.state || o.store.state === ui.state) && (!ui.type || o.store.type === ui.type));
  }

  function matchesQuery(item) {
    const q = ui.q.trim().toLowerCase();
    if (!q) return true;
    return q.split(/\s+/).every((w) => item.search.includes(w) || (SYNONYMS[w] && item.search.includes(SYNONYMS[w])));
  }

  // ---------- Rendering: filters ----------
  function renderFilters() {
    const states = [...new Set(DB.stores.map((s) => s.state))].sort();
    $("#state").insertAdjacentHTML("beforeend", states.map((s) => `<option>${esc(s)}</option>`).join(""));
    $("#state").value = ui.state;

    const cats = [...new Set(DB.items.map((i) => i.category))].sort();
    $("#categories").innerHTML = [`<button class="chip active" data-cat="">All</button>`]
      .concat(cats.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`)).join("");

    const src = DB.source === "pricecatcher"
      ? `Data: <a href="https://data.gov.my/data-catalogue/pricecatcher" target="_blank" rel="noopener">KPDN PriceCatcher</a> (CC BY 4.0), updated ${fmtDate(DB.asOf)}.`
      : `Showing demo data (as of ${fmtDate(DB.asOf)}).`;
    $("#dataSource").innerHTML = src;
    $("#sampleBanner").hidden = DB.source !== "sample";
  }

  function fmtDate(iso) {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
  }

  // ---------- Rendering: results ----------
  function computeRows() {
    const rows = [];
    for (const item of DB.itemById.values()) {
      if (ui.category && item.category !== ui.category) continue;
      if (!matchesQuery(item)) continue;
      const offers = offersFor(item.id);
      if (!offers.length) continue;
      const min = offers[0].price, max = offers[offers.length - 1].price;
      rows.push({ item, offers, min, max, save: max - min, savePct: max > 0 ? (max - min) / max : 0 });
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
      <div class="stat"><b>${rows.length}</b><span>products</span></div>
      <div class="stat"><b>${storesInScope.size.toLocaleString()}</b><span>stores compared</span></div>
      <div class="stat"><b>${Math.round(avgSave * 100)}%</b><span>avg. price gap</span></div>`;

    const where = [ui.state || "all states", ui.type ? TYPE_LABEL[ui.type].toLowerCase() + "s" : null].filter(Boolean).join(" · ");
    $("#resultMeta").textContent = rows.length
      ? `${rows.length} product${rows.length > 1 ? "s" : ""} in ${where} — cheapest store shown first`
      : "";

    const html = [];
    rows.forEach((r, i) => {
      html.push(cardHTML(r));
      if (i === 7) html.push(inlineAdHTML());
    });
    $("#results").innerHTML = html.join("");
    $("#empty").hidden = rows.length > 0;
    pushAds();
  }

  function cardHTML({ item, offers, min, max, savePct }) {
    const best = offers[0];
    const inBasket = !!ui.basket[item.id];
    return `
      <article class="card" data-item="${item.id}" tabindex="0">
        <div class="card-top">
          <div>
            <div class="card-cat">${esc(item.category)}</div>
            <h3>${esc(item.name)}</h3>
            <div class="card-unit">${esc(item.unit)}</div>
          </div>
          ${savePct >= 0.05 ? `<span class="save-badge">Save ${Math.round(savePct * 100)}%</span>` : ""}
        </div>
        <div class="best">
          <div class="best-label">Cheapest</div>
          <div class="best-price"><small>RM</small>${best.price.toFixed(2)}</div>
          <div class="best-store">${esc(best.store.name)}</div>
          <div class="best-where">${esc(best.store.district)}, ${esc(best.store.state)}</div>
        </div>
        <div class="card-foot">
          <span>${offers.length} store${offers.length > 1 ? "s" : ""} · up to ${rm(max)}</span>
          <button class="add-btn ${inBasket ? "added" : ""}" data-add="${item.id}" aria-pressed="${inBasket}">
            ${inBasket ? "✓ In basket" : "+ Basket"}
          </button>
        </div>
      </article>`;
  }

  // ---------- Ads ----------
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
    return inner ? `<aside class="ad ad-card" aria-label="Sponsored">${inner}</aside>` : "";
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

  // ---------- Detail drawer ----------
  function openDetail(itemId) {
    const item = DB.itemById.get(itemId);
    const offers = offersFor(itemId);
    if (!item || !offers.length) return;
    $("#detail").dataset.item = itemId;
    const min = offers[0].price, max = offers[offers.length - 1].price;
    const avg = offers.reduce((s, o) => s + o.price, 0) / offers.length;
    const inBasket = !!ui.basket[itemId];
    const LIMIT = 25;

    $("#detailCat").textContent = item.category;
    $("#detailTitle").textContent = item.name;
    $("#detailUnit").textContent = `${item.unit} · ${ui.state || "All states"}`;

    const li = (o, i) => `
      <li class="${i === 0 ? "top" : ""}">
        <span class="rank-no">${i + 1}</span>
        <div>
          <div class="rank-store">${esc(o.store.name)}<span class="tag">${esc(TYPE_LABEL[o.store.type] || o.store.type)}</span></div>
          <div class="rank-where">${esc(o.store.district)}, ${esc(o.store.state)} · ${fmtDate(o.date)}</div>
        </div>
        <div class="rank-price">${rm(o.price)}
          <span class="rank-diff">${i === 0 ? "Cheapest" : "+" + rm(o.price - min)}</span></div>
      </li>`;

    $("#detailBody").innerHTML = `
      <div class="summary">
        <div><b>${rm(min)}</b><span>Lowest</span></div>
        <div><b>${rm(avg)}</b><span>Average</span></div>
        <div><b>${rm(max)}</b><span>Highest</span></div>
      </div>
      <button class="btn btn-primary btn-block" data-add="${itemId}">${inBasket ? "✓ In your basket" : "+ Add to basket"}</button>
      <p class="section-title">Cheapest first · ${offers.length} store${offers.length > 1 ? "s" : ""}</p>
      <ol class="rank" id="rankList">${offers.slice(0, LIMIT).map(li).join("")}</ol>
      ${offers.length > LIMIT ? `<button class="btn btn-outline btn-block" id="moreStores" style="margin-top:10px">Show all ${offers.length} stores</button>` : ""}`;
    const more = $("#moreStores");
    if (more) more.onclick = () => { $("#rankList").innerHTML = offers.map(li).join(""); more.remove(); };
    openPanel("#detail");
  }

  // ---------- Basket ----------
  function basketIds() { return Object.keys(ui.basket).map(Number).filter((id) => DB.itemById.has(id)); }

  function toggleBasket(itemId) {
    if (ui.basket[itemId]) { delete ui.basket[itemId]; toast("Removed from basket"); }
    else { ui.basket[itemId] = 1; toast("Added to basket 🛒"); }
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
      body.innerHTML = `<div class="empty"><div class="empty-emoji">🧺</div>
        <p>Your basket is empty.<br>Tap <b>+ Basket</b> on any product to plan the cheapest trip.</p></div>`;
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

    // Worst case for "you save" (most expensive store for each item)
    const worst = lines.reduce((s, l) => s + (l.offers.length ? l.offers[l.offers.length - 1].price * l.qty : 0), 0);

    const itemsHTML = lines.map((l) => `
      <div class="basket-item">
        <div class="grow"><b>${esc(l.item.name)}</b>
          <span>${esc(l.item.unit)} · ${l.offers.length ? "from " + rm(l.offers[0].price) : "not available in this filter"}</span></div>
        <div class="qty">
          <button data-qty="${l.item.id}" data-d="-1" aria-label="Decrease">−</button>
          <output>${l.qty}</output>
          <button data-qty="${l.item.id}" data-d="1" aria-label="Increase">+</button>
        </div>
      </div>`).join("");

    const oneStop = full.length
      ? full.slice(0, 3).map((e, i) => `
        <div class="plan ${i === 0 && e.total - mixTotal < 0.005 ? "win" : ""}">
          <div class="plan-head"><b>${i === 0 ? "🏪 " : ""}${esc(e.store.name)}</b><span class="plan-total">${rm(e.total)}</span></div>
          <p>${esc(e.store.district)}, ${esc(e.store.state)} · all ${needed} items in one trip${i === 0 ? ` · only ${rm(e.total - mixTotal)} more than the cheapest mix` : ""}</p>
        </div>`).join("")
      : `<div class="plan"><p>No single store in this filter stocks every item. Try "All stores" or a different state.</p></div>`;

    body.innerHTML = `
      <div class="basket-list">${itemsHTML}</div>
      <p class="section-title">Cheapest mix (visit several stores)</p>
      <div class="plan win">
        <div class="plan-head"><b>💰 Lowest possible total</b><span class="plan-total">${rm(mixTotal)}</span></div>
        <p>You save <b>${rm(worst - mixTotal)}</b> vs. the most expensive stores.</p>
        <ul>${[...mixStores].map(([n, c]) => `<li>${esc(n)} — ${c} item${c > 1 ? "s" : ""}</li>`).join("")}</ul>
      </div>
      ${missing.length ? `<p class="muted small-print">Not found in this filter: ${missing.map(esc).join(", ")}</p>` : ""}
      <p class="section-title">Best one-stop shop</p>
      ${oneStop}
      <button class="btn btn-outline btn-block" id="clearBasket" style="margin-top:20px">Clear basket</button>`;
  }

  // ---------- Panels, modal, toast ----------
  let lastFocus = null;
  function openPanel(sel) {
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
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
  }

  function renderSupport() {
    const s = CFG.support || {};
    $("#supportMsg").textContent = s.message || "";
    $("#supportLinks").innerHTML = (s.links || []).map((l) =>
      `<a class="btn btn-primary" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.icon || "")} ${esc(l.label)}</a>`).join("");
    $("#supportQr").innerHTML = s.duitNowQr
      ? `<p class="section-title">DuitNow / Touch 'n Go</p><img src="${esc(s.duitNowQr)}" alt="DuitNow QR code" />` : "";
  }

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $("#themeToggle").textContent = t === "dark" ? "☀️" : "🌙";
  }

  // ---------- URL state ----------
  function readURL() {
    const p = new URLSearchParams(location.search);
    ui.q = p.get("q") || ""; ui.state = p.get("state") || ui.state; ui.type = p.get("type") || "";
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
    let t;
    $("#q").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { ui.q = e.target.value; writeURL(); renderResults(); }, 120);
    });
    $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); $("#q").blur(); });
    $("#state").addEventListener("change", (e) => { ui.state = e.target.value; store.set("jb.state", ui.state); writeURL(); renderResults(); });
    $("#sort").addEventListener("change", (e) => { ui.sort = e.target.value; renderResults(); });

    $("#storeTypes").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      ui.type = b.dataset.type;
      $$("#storeTypes .chip").forEach((c) => c.classList.toggle("active", c === b));
      writeURL(); renderResults();
    });
    $("#categories").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      ui.category = b.dataset.cat;
      $$("#categories .chip").forEach((c) => c.classList.toggle("active", c === b));
      renderResults();
    });

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
      const card = e.target.closest(".card[data-item]");
      if (card) { openDetail(Number(card.dataset.item)); return; }
      if (e.target.closest("[data-open-support]")) { openPanel("#support"); return; }
      if (e.target.closest("[data-close]") || e.target === $("#overlay") || e.target === $("#support")) closePanels();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanels();
      if (e.key === "Enter" && e.target.matches(".card[data-item]")) e.target.click();
      if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
    });

    $("#openBasket").addEventListener("click", () => { renderBasket(); openPanel("#basket"); });
    $("#themeToggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      store.set("jb.theme", next); applyTheme(next);
    });
    $("#shareBtn").addEventListener("click", async () => {
      const data = { title: "JimatBasket", text: "Compare grocery prices across Malaysian supermarkets 🧺", url: location.origin + location.pathname };
      try {
        if (navigator.share) await navigator.share(data);
        else { await navigator.clipboard.writeText(data.url); toast("Link copied!"); }
      } catch { /* cancelled */ }
    });
  }

  // ---------- Boot ----------
  async function init() {
    applyTheme(store.get("jb.theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    ui.state = store.get("jb.state", "");
    readURL();
    renderSupport();
    initAds();
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
