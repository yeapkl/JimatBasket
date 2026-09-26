#!/usr/bin/env python3
"""Collect grocery prices from retailers' own websites -> data/online.json

How it works (no site-specific scraping code needed for most shops):
  1. Read the retailer's robots.txt. Pages it disallows are never fetched.
  2. Find product pages through the retailer's sitemaps.
  3. Read the standard product data most online shops embed for Google
     Shopping (schema.org Product JSON-LD, or product/og price meta tags):
     name, price, currency, barcode (GTIN), brand, image, availability.
  4. Group the same product across retailers (by barcode, otherwise by
     normalised name + size) so the site can rank retailers cheapest-first.

It's polite by design: one request at a time per site, at least
ONLINE_MIN_DELAY seconds apart (or the site's Crawl-delay if longer), an
honest User-Agent, backs off on 429/503, and gives up on a site that keeps
refusing. Each run fetches at most ONLINE_MAX_PAGES pages per retailer,
starting at a different point each day, so big catalogues are covered over
several days; offers seen in the last STALE_DAYS days are kept meanwhile.

Retailers are listed in scripts/retailers.json. Each starts disabled: check
that site's terms of use before enabling it. Sites built as JavaScript apps
may not expose product data in their HTML; the run report says so
("no-product-data") and those need a custom adapter.

Requires: pip install requests
Usage:  python scripts/fetch_online_prices.py [--only "Lotus's"] [--max-pages 50] [--dry-run]
"""
import argparse
import gzip
import html
import json
import os
import re
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from urllib import robotparser
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET

import requests

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path(os.environ.get("ONLINE_CONFIG", ROOT / "scripts" / "retailers.json"))
OUT = ROOT / "data" / "online.json"
UA = os.environ.get("ONLINE_USER_AGENT",
                    "JimatBasketBot/1.0 (+https://github.com/yeapkl/JimatBasket; grocery price comparison)")
MAX_PAGES = int(os.environ.get("ONLINE_MAX_PAGES", 3000))       # per retailer per run
MIN_DELAY = float(os.environ.get("ONLINE_MIN_DELAY", 1.5))      # seconds between requests
TIME_BUDGET = float(os.environ.get("ONLINE_TIME_BUDGET_MIN", 150)) * 60
STALE_DAYS = int(os.environ.get("ONLINE_STALE_DAYS", 14))
MAX_SITEMAPS = 300
ID_BASE = 1_000_000_000  # online product ids live above PriceCatcher item codes

# Our site categories, matched on product name + the retailer's category.
# Order matters: first match wins. Products that match nothing (electronics,
# clothes...) are skipped so the site stays about groceries.
CATEGORIES = [
    ("Canned Food", r"\bcanned\b|\bin tin\b|\bsardin|\btuna\b|baked beans|luncheon"),
    ("Baby & Personal Care", r"diaper|lampin|shampoo|syampu|toothpaste|ubat gigi|body ?wash|sabun mandi|\bbaby\b|sanitary|pad wanita|deodorant|lotion"),
    ("Household", r"detergent|pencuci|dishwash|softener|pelembut|bleach|\btissue|\btisu|toilet roll|floor clean|insect|garbage bag|aluminium foil|cling wrap"),
    ("Beverages", r"coffee|\bkopi|\btea\b|\bteh\b|\bmilo\b|horlicks|ovaltine|juice|\bjus\b|mineral water|air mineral|drinking water|\bsoda\b|carbonated|isotonic|100 ?plus|cordial|sirap|\bdrink|minuman"),
    ("Eggs & Dairy", r"\beggs?\b|\btelur|\bmilk\b|\bsusu|cheese|keju|butter|mentega|yogh?urt|dadih|\bcream\b|marjerin|margarine"),
    ("Meat & Seafood", r"chicken|\bayam|\bbeef\b|daging|mutton|kambing|\blamb\b|\bfish\b|\bikan\b|prawn|udang|squid|sotong|\bcrab|ketam|sausage|nugget|burger patty"),
    ("Vegetables & Fruits", r"vegetable|sayur|\bfruit|\bbuah|apple|epal|banana|pisang|orange|oren|onion|bawang|garlic|potato|kentang|tomato|cabbage|kobis|carrot|lobak|chilli|cili|spinach|bayam|cucumber|timun|lettuce|salad|papaya|betik|grape|anggur|mango|mangga|watermelon|tembikai"),
    ("Rice & Grains", r"\brice\b|\bberas|flour|tepung|\boats?\b|cereal|bijirin|pasta|spaghetti|macaroni|vermicelli|bihun|\bmeehoon|kuey teow"),
    ("Cooking Essentials", r"cooking oil|minyak masak|\boil\b|\bsugar|\bgula|\bsalt\b|\bgaram|soy sauce|kicap|\bsauce|\bsos\b|oyster|vinegar|cuka|\bspice|rempah|curry powder|serbuk kari|stock cube|kiub|belacan|santan|coconut milk|seasoning|perasa"),
    ("Bakery & Snacks", r"\bbread\b|\broti|bun\b|biscuit|biskut|cracker|kraker|cookie|\bchips\b|kerepek|snack|wafer|chocolate|coklat|instant noodle|mi segera|\bmee\b|\bmaggi\b|noodle|\bcake\b|kek"),
]
CATEGORIES = [(c, re.compile(p, re.I)) for c, p in CATEGORIES]
# Not groceries for people: pet food/treats, containers, toys...
EXCLUDE = re.compile(r"\bpuppy|\bkitten|\bdogs?\b|\bcats?\b|\bpets?\b|makanan kucing|makanan anjing|jerhigh|whiskas|"
                     r"pedigree|friskies|supercoat|smartheart|royal canin|\bme-o\b|\bcontainer\b|\btoy\b", re.I)
# Checked before CATEGORIES so e.g. "potato chips" is a snack, not a vegetable
SNACKS = re.compile(r"\bchips\b|crisps|kerepek|\bsnacks?\b", re.I)

SIZE_RE = re.compile(
    r"(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|gm|gram|l|ltr|litre|liter|ml|pcs|pc|biji|s|sheets|rolls?)\b", re.I)
STOPWORDS = {"x", "pack", "pck", "pkt", "promo", "free", "new", "value", "the", "and", "dan", "with", "of"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def parse_price(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    m = re.search(r"\d+(?:[.,]\d{1,2})?", str(v).replace(",", ""))
    return float(m.group(0)) if m and float(m.group(0)) > 0 else None


def parse_size(name):
    """'Milo 1kg' -> '1kg', 'Dutch Lady 1000ml' -> '1L', '6 x 250ml' -> '6 x 250ml'."""
    matches = list(SIZE_RE.finditer(name or ""))
    if not matches:
        return ""
    m = matches[-1]
    pack, qty, unit = m.group(1), float(m.group(2).replace(",", ".")), m.group(3).lower()
    unit = {"gm": "g", "gram": "g", "ltr": "L", "litre": "L", "liter": "L", "l": "L",
            "pc": "pcs", "s": "pcs", "roll": "rolls"}.get(unit, unit)
    if unit == "g" and qty >= 1000 and not pack:
        qty, unit = qty / 1000, "kg"
    if unit == "ml" and qty >= 1000 and not pack:
        qty, unit = qty / 1000, "L"
    q = f"{qty:g}"
    return f"{pack} x {q}{unit}" if pack else f"{q}{unit}"


def product_key(name, size, gtin):
    digits = re.sub(r"\D", "", str(gtin or ""))
    if 8 <= len(digits) <= 14:
        return "gtin:" + digits.zfill(14)
    base = SIZE_RE.sub(" ", (name or "").lower())
    tokens = {t for t in re.findall(r"[a-z0-9]+", base) if t not in STOPWORDS}
    return "name:" + " ".join(sorted(tokens)) + "|" + size.lower()


def product_id(key):
    return ID_BASE + zlib.crc32(key.encode()) % ID_BASE


def categorize(*texts):
    text = " ".join(t for t in texts if t)
    if EXCLUDE.search(text):
        return None
    if SNACKS.search(text):
        return "Bakery & Snacks"
    for cat, rx in CATEGORIES:
        if rx.search(text):
            return cat
    return None


def first(v):
    return v[0] if isinstance(v, list) and v else v


def text_of(v):
    v = first(v)
    if isinstance(v, dict):
        v = v.get("name") or v.get("@id") or v.get("url")
    return html.unescape(str(v)).strip() if v else ""


# ---------------------------------------------------------------------------
# product data extraction (JSON-LD first, then meta tags)
# ---------------------------------------------------------------------------
LDJSON_RE = re.compile(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", re.I | re.S)
META_RE = re.compile(r"<meta\s+([^>]+?)/?>", re.I)
ATTR_RE = re.compile(r"([a-zA-Z:-]+)\s*=\s*(\"[^\"]*\"|'[^']*')")


def iter_products(node):
    if isinstance(node, list):
        for x in node:
            yield from iter_products(x)
    elif isinstance(node, dict):
        types = node.get("@type")
        types = types if isinstance(types, list) else [types]
        if "Product" in types or "ProductGroup" in types:
            yield node
        for k, v in node.items():
            if k != "@context" and isinstance(v, (dict, list)):
                yield from iter_products(v)


def offer_of(product):
    """Return (price, currency, in_stock, was) from a schema.org Product."""
    offers = product.get("offers")
    if offers is None and product.get("hasVariant"):
        offers = [v.get("offers") for v in product["hasVariant"] if isinstance(v, dict)]
    cands = list(offers) if isinstance(offers, list) else [offers]
    best = None
    for o in cands:
        if isinstance(o, list):
            cands.extend(o)
            continue
        if not isinstance(o, dict):
            continue
        if o.get("offers"):  # AggregateOffer with nested offers
            inner = o["offers"]
            cands.extend(inner if isinstance(inner, list) else [inner])
        price = parse_price(o.get("price") or o.get("lowPrice"))
        if price is None and isinstance(o.get("priceSpecification"), (dict, list)):
            for spec in o["priceSpecification"] if isinstance(o["priceSpecification"], list) else [o["priceSpecification"]]:
                if "Strikethrough" not in str(spec.get("priceType", "")):
                    price = parse_price(spec.get("price"))
        if price is None:
            continue
        currency = str(o.get("priceCurrency") or "").upper()
        in_stock = "outofstock" not in str(o.get("availability", "")).lower().replace(" ", "")
        if best is None or price < best[0]:
            best = (price, currency, in_stock)
    return best


def extract(page_html, url):
    for raw in LDJSON_RE.findall(page_html):
        try:
            data = json.loads(raw.strip())
        except json.JSONDecodeError:
            try:
                data = json.loads(re.sub(r"[\x00-\x1f]", " ", raw.strip()))
            except json.JSONDecodeError:
                continue
        for p in iter_products(data):
            offer = offer_of(p)
            name = text_of(p.get("name"))
            if not offer or not name:
                continue
            price, currency, in_stock = offer
            if currency and currency not in ("MYR", "RM"):
                continue
            return {
                "name": name,
                "brand": text_of(p.get("brand")),
                "gtin": text_of(p.get("gtin13") or p.get("gtin") or p.get("gtin12") or p.get("gtin14") or p.get("gtin8")),
                "image": text_of(p.get("image")),
                "category": text_of(p.get("category")),
                "price": price,
                "inStock": in_stock,
                "url": url,
            }

    # fallback: Open Graph / product meta tags
    meta = {}
    for attrs in META_RE.findall(page_html):
        a = {k.lower(): v[1:-1] for k, v in ATTR_RE.findall(attrs)}
        key = a.get("property") or a.get("name") or a.get("itemprop")
        if key and "content" in a:
            meta.setdefault(key.lower(), html.unescape(a["content"]))
    price = parse_price(meta.get("product:price:amount") or meta.get("og:price:amount") or meta.get("price"))
    currency = (meta.get("product:price:currency") or meta.get("og:price:currency") or meta.get("pricecurrency") or "").upper()
    name = meta.get("og:title") or meta.get("name")
    if price and name and currency in ("", "MYR", "RM"):
        return {"name": name.strip(), "brand": meta.get("product:brand", ""), "gtin": "",
                "image": meta.get("og:image", ""), "category": "", "price": price,
                "inStock": "out" not in meta.get("product:availability", "in").lower(), "url": url}
    return None


# ---------------------------------------------------------------------------
# polite fetching per site
# ---------------------------------------------------------------------------
class Site:
    def __init__(self, cfg, max_pages, deadline, log):
        self.cfg, self.name = cfg, cfg["name"]
        self.base = cfg["base"].rstrip("/")
        self.max_pages, self.deadline, self.log = max_pages, deadline, log
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "en-MY,ms;q=0.8"})
        self.last = 0.0
        self.errors = 0
        self.blocked = False
        self.responded = False  # did the server ever answer?
        self.stats = {"name": self.name, "status": "ok", "sitemaps": 0, "candidates": 0,
                      "fetched": 0, "products": 0, "skipped_non_grocery": 0}
        self.rp = robotparser.RobotFileParser()
        self.delay = max(MIN_DELAY, float(cfg.get("delay", 0)))

    def get(self, url, allow_redirects=True):
        if self.blocked or time.time() > self.deadline:
            return None
        for attempt in range(3):
            wait = self.last + self.delay - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                r = self.s.get(url, timeout=25, allow_redirects=allow_redirects)
            except requests.RequestException as e:
                self.log(f"  {self.name}: {url} -> {type(e).__name__}")
                r = None
            if r is not None:
                self.responded = True
            if r is not None and r.status_code == 200:
                self.errors = 0
                return r
            code = r.status_code if r is not None else 0
            if code in (429, 503):
                retry = r.headers.get("Retry-After", "")
                time.sleep(min(int(retry) if retry.isdigit() else 10 * (attempt + 1), 60))
                continue
            if code == 404:
                return None
            break
        self.errors += 1
        if self.errors >= 15:
            self.blocked = True
            self.stats["status"] = "blocked (repeated errors / 403 / 429)"
            self.log(f"  {self.name}: giving up after repeated errors")
        return None

    def load_robots(self):
        r = self.get(self.base + "/robots.txt")
        self.rp.parse(r.text.splitlines() if r is not None else [])
        cd = self.rp.crawl_delay(UA)
        if cd:
            self.delay = max(self.delay, float(cd))
        return list(self.rp.site_maps() or [])

    def allowed(self, url):
        return self.rp.can_fetch(UA, url)

    def sitemap_urls(self, robots_sitemaps):
        queue = list(dict.fromkeys(self.cfg.get("sitemaps", []) + robots_sitemaps + [self.base + "/sitemap.xml"]))
        seen, pages = set(), []
        # product sitemaps first
        queue.sort(key=lambda u: 0 if "product" in u.lower() else 1)
        while queue and len(seen) < MAX_SITEMAPS:
            sm = queue.pop(0)
            if sm in seen or not self.allowed(sm):
                continue
            seen.add(sm)
            r = self.get(sm)
            if r is None:
                continue
            body = r.content
            if body[:2] == b"\x1f\x8b":
                try:
                    body = gzip.decompress(body)
                except OSError:
                    continue
            try:
                root = ET.fromstring(body)
            except ET.ParseError:
                continue
            self.stats["sitemaps"] += 1
            is_index = root.tag.split("}")[-1] == "sitemapindex"
            for entry in root:
                for el in entry:
                    if el.tag.split("}")[-1] == "loc" and el.text:
                        loc = el.text.strip()
                        (queue if is_index else pages).append(loc)
            if is_index:
                queue.sort(key=lambda u: 0 if "product" in u.lower() else 1)
        return list(dict.fromkeys(pages))

    def looks_like_product(self, url):
        pattern = self.cfg.get("product_url")
        if pattern:
            return re.search(pattern, url) is not None
        path = urlparse(url).path.lower()
        if re.search(r"/(blog|news|pages?|category|categories|collections?/[^/]+/?$|search|tag|brand|store-locator|promotions?|careers?)(/|$)", path):
            return False
        return path.count("/") >= 1 and path not in ("", "/")

    def run(self):
        if not self.base.startswith("http"):
            self.stats["status"] = "bad base url"
            return []
        robots_sitemaps = self.load_robots()
        if not self.responded:
            self.get(self.base + "/")
        if not self.responded:
            self.stats["status"] = "unreachable (check the domain in retailers.json)"
            return []
        if not self.allowed(self.base + "/"):
            self.stats["status"] = "robots.txt disallows crawling"
            return []
        pages = [u for u in self.sitemap_urls(robots_sitemaps)
                 if urlparse(u).netloc.endswith(urlparse(self.base).netloc.replace("www.", ""))
                 and self.looks_like_product(u) and self.allowed(u)]
        self.stats["candidates"] = len(pages)
        if not pages:
            if self.stats["status"] == "ok":
                self.stats["status"] = "no product pages found in sitemaps"
            return []
        # rotate the start point daily so big catalogues get covered over time
        start = (date.today().toordinal() * self.max_pages) % len(pages)
        batch = (pages[start:] + pages[:start])[: self.max_pages]
        found = []
        for url in batch:
            r = self.get(url)
            if r is None:
                if self.blocked or time.time() > self.deadline:
                    break
                continue
            self.stats["fetched"] += 1
            p = extract(r.text, r.url)
            if not p:
                continue
            p["size"] = parse_size(p["name"])
            p["category"] = categorize(p["name"], p["category"], p["brand"])
            if not p["category"]:
                self.stats["skipped_non_grocery"] += 1
                continue
            found.append(p)
            if self.stats["fetched"] % 100 == 0:
                self.log(f"  {self.name}: {self.stats['fetched']} pages, {len(found)} products")
        self.stats["products"] = len(found)
        if self.stats["status"] == "ok" and self.stats["fetched"] >= 20 and not found:
            self.stats["status"] = "no-product-data (likely a JavaScript app; needs a custom adapter)"
        return found


# ---------------------------------------------------------------------------
# merge & write
# ---------------------------------------------------------------------------
def merge(results, previous, today):
    """Group offers by product; keep previous offers not re-checked if recent."""
    products = {}

    def add(key, info, offer):
        p = products.get(key)
        if p is None:
            p = products[key] = {"key": key, "nkey": product_key(info["name"], info.get("unit") or info.get("size") or "", None),
                                 "id": product_id(key), "name": info["name"],
                                 "unit": info.get("unit") or info.get("size") or "",
                                 "category": info["category"], "offers": {}}
            if info.get("gtin"):
                p["gtin"] = info["gtin"]
            if info.get("image"):
                p["image"] = info["image"]
        retailer = offer[0]
        if retailer not in p["offers"] or offer[1] < p["offers"][retailer][1]:
            p["offers"][retailer] = offer

    for retailer, items in results.items():
        for it in items:
            key = product_key(it["name"], it["size"], it["gtin"])
            add(key, it, [retailer, round(it["price"], 2), it["url"], 1 if it["inStock"] else 0, today])

    cutoff = (date.fromisoformat(today) - timedelta(days=STALE_DAYS)).isoformat()
    for old in (previous or {}).get("products", []):
        for offer in old.get("offers", []):
            if offer[4] < cutoff:
                continue
            p = products.get(old["key"])
            if p and offer[0] in p["offers"]:
                continue  # re-checked this run
            add(old["key"], old, offer)

    # a shop without barcodes lists the same item as one with barcodes:
    # fold name-matched products into the barcode product with that name
    by_name = {}
    for p in products.values():
        if p["key"].startswith("gtin:"):
            by_name.setdefault(p["nkey"], []).append(p)
    for key in [k for k, p in products.items() if k.startswith("name:")]:
        targets = by_name.get(products[key]["nkey"], [])
        if len(targets) == 1:
            for retailer, offer in products.pop(key)["offers"].items():
                t = targets[0]["offers"]
                if retailer not in t or offer[1] < t[retailer][1]:
                    t[retailer] = offer

    out = []
    for p in products.values():
        p["offers"] = sorted(p["offers"].values(), key=lambda o: o[1])
        out.append(p)
    return sorted(out, key=lambda p: (p["category"], p["name"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", help="run just this retailer (ignores 'enabled')")
    ap.add_argument("--max-pages", type=int, default=MAX_PAGES)
    ap.add_argument("--dry-run", action="store_true", help="print results, don't write data/online.json")
    args = ap.parse_args()

    retailers = json.loads(CONFIG.read_text())["retailers"]
    if args.only:
        retailers = [r for r in retailers if r["name"].lower() == args.only.lower()]
        if not retailers:
            sys.exit(f"no retailer named {args.only!r} in {CONFIG}")
    else:
        retailers = [r for r in retailers if r.get("enabled")]
        if not retailers:
            print(f"No retailers enabled in {CONFIG}; nothing to do.")
            return

    lock = threading.Lock()

    def log(msg):
        with lock:
            print(msg, flush=True)

    deadline = time.time() + TIME_BUDGET
    sites = [Site(r, args.max_pages, deadline, log) for r in retailers]
    log(f"Crawling {len(sites)} retailer(s), up to {args.max_pages} pages each: "
        + ", ".join(s.name for s in sites))
    results = {}
    with ThreadPoolExecutor(max_workers=max(1, len(sites))) as pool:
        for site, found in zip(sites, pool.map(lambda s: s.run(), sites)):
            results[site.name] = found

    today = date.today().isoformat()
    previous = json.loads(OUT.read_text()) if OUT.exists() else None
    if previous and previous.get("source") != "online":
        previous = None  # never carry demo/sample offers into real data
    products = merge(results, previous, today)
    compared = sum(1 for p in products if len(p["offers"]) > 1)

    report = [s.stats for s in sites]
    md = ["## Online prices", "",
          f"Products: **{len(products)}**, sold by 2+ retailers: **{compared}**", "",
          "| retailer | status | sitemaps | product pages | fetched | grocery products | non-grocery skipped |",
          "|---|---|---:|---:|---:|---:|---:|"]
    md += [f"| {r['name']} | {r['status']} | {r['sitemaps']} | {r['candidates']} | {r['fetched']} | "
           f"{r['products']} | {r['skipped_non_grocery']} |" for r in report]
    text = "\n".join(md)
    log(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(text + "\n")

    if args.dry_run:
        for p in products[:20]:
            log(f"  {p['category']:<22} {p['name'][:50]:<50} {p['unit']:<10} "
                + ", ".join(f"{o[0]} RM{o[1]:.2f}" for o in p["offers"]))
        return
    OUT.write_text(json.dumps({"source": "online", "asOf": today, "retailers": report,
                               "products": products}, separators=(",", ":"), ensure_ascii=False))
    log(f"wrote {OUT}: {len(products)} products")


if __name__ == "__main__":
    main()
