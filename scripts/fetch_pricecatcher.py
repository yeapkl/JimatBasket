#!/usr/bin/env python3
"""Build data/prices.json from KPDN PriceCatcher open data (data.gov.my).

PriceCatcher is the Ministry of Domestic Trade's daily price survey of
~2,000+ items across thousands of premises nationwide. It's published as
open data (CC BY 4.0): https://data.gov.my/data-catalogue/pricecatcher

We keep only supermarkets, hypermarkets, minimarts and convenience stores,
take each store's most recent price for each item, and keep the cheapest
N stores per item per state so the JSON stays small enough for a browser.

Requires: pip install pandas pyarrow requests
"""
import json
import os
import re
import sys
from datetime import date
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

BASE = "https://storage.data.gov.my/pricecatcher"
OUT = Path(__file__).resolve().parent.parent / "data" / "prices.json"
KEEP_PER_STATE = int(os.environ.get("KEEP_PER_STATE", 12))  # cheapest N stores per item per state
MAX_AGE_DAYS = 14     # ignore prices older than this (relative to newest date)
HISTORY_DAYS = 90     # length of the price-history chart

# PriceCatcher premise_type -> our store type, matched by keyword so small
# spelling differences ("Pasar Raya/Supermarket", "Kedai Runcit / Pasar Mini")
# don't silently drop stores. First match wins; anything else (wet markets,
# farmers' markets, wholesalers...) is excluded and listed in the report.
TYPE_RULES = [
    (r"hyper", "hypermarket"),
    (r"pasar\s*raya|super\s*market", "supermarket"),
    (r"serbaneka|convenience|kedai\s*24", "convenience"),
    (r"runcit|pasar\s*mini|mini\s*market|minimart|grocery", "minimart"),
]


def classify_type(premise_type) -> str | None:
    low = str(premise_type).strip().lower()
    for pattern, kind in TYPE_RULES:
        if re.search(pattern, low):
            return kind
    return None

# Recognisable chain names in premise names (first match wins)
CHAINS = [
    (r"lotus", "Lotus's"), (r"\baeon\b", "AEON"), (r"\bgiant\b", "Giant"),
    (r"mydin", "Mydin"), (r"econsave", "Econsave"), (r"\bnsk\b", "NSK Trade City"),
    (r"jaya grocer", "Jaya Grocer"), (r"village grocer", "Village Grocer"),
    (r"\bhero\b", "Hero Market"), (r"tf value", "TF Value-Mart"),
    (r"99 ?speed ?mart", "99 Speedmart"), (r"\bkk\b", "KK Mart"),
    (r"7[- ]?eleven", "7-Eleven"), (r"mynews", "myNEWS"), (r"speedmart", "99 Speedmart"),
    (r"the store", "The Store"), (r"pacific", "Pacific"), (r"billion", "Billion"),
    (r"servay", "Servay"), (r"sunshine", "Sunshine"), (r"cold storage", "Cold Storage"),
    (r"mercato", "Mercato"), (r"family ?mart", "FamilyMart"),
    (r"\btesco\b", "Lotus's"),  # Tesco Malaysia became Lotus's; some names still say Tesco
    # regional chains (several outlets each in PriceCatcher)
    (r"tunas manja", "Tunas Manja"), (r"segi fresh", "Segi Fresh"), (r"segi cash", "Segi Cash & Carry"),
    (r"pantai tim[uo]r", "Pantai Timur"), (r"bataras", "Bataras"), (r"pasaraya bs\b", "Pasaraya BS"),
    (r"\bbs freshmart", "BS Freshmart"), (r"\bbs supermart", "BS Supermart"), (r"pasaraya lyc", "Pasaraya LYC"),
    (r"maslee", "Maslee"), (r"save mini", "Save Mini Market"), (r"\btmg (mart|express)", "TMG Mart"),
    (r"cck fresh", "CCK Fresh Mart"), (r"\bwls enterprise", "WLS"), (r"econjaya", "Econjaya"),
    (r"econo jaya", "Econo Jaya"), (r"pasaraya econo\b", "Pasaraya Econo"), (r"everwin", "Everwin"),
    (r"\bty pasaraya", "TY Pasaraya"), (r"\bsk fresh", "SK Fresh"), (r"pasaraya pkt", "Pasaraya PKT"),
    (r"milimewa", "Milimewa"), (r"well ?mart", "Well Mart"), (r"nirwana maju", "Nirwana Maju"),
    (r"kim hock", "Kim Hock"), (r"new world mart", "New World Mart"), (r"lepapa", "Lepapa"),
    (r"target supermarket", "Target Supermarket"), (r"\b88 freshmart", "88 Freshmart"), (r"\bls mart", "LS Mart"),
    (r"k-ceria", "K-Ceria"), (r"sing kwong", "Sing Kwong"), (r"nam leong", "Nam Leong"), (r"\bmds mart", "MDS Mart"),
    (r"city fresh mart", "City Fresh Mart"), (r"instar", "Instar"), (r"doremart", "Doremart"),
    (r"family store", "Family Store"), (r"\bbig 10\b", "Big 10"),
]


# PriceCatcher item_category (Malay) -> the site's 10 categories, so filter
# chips stay consistent with online products and get translated.
CATEGORY_MAP = {
    "ayam": "Meat & Seafood", "daging": "Meat & Seafood", "bahan laut": "Meat & Seafood",
    "ikan darat": "Meat & Seafood", "hasil laut kering": "Meat & Seafood",
    "bahan-bahan minuman": "Beverages", "tersedia minum": "Beverages",
    "bawang": "Vegetables & Fruits", "buah-buahan": "Vegetables & Fruits", "sayur-sayuran": "Vegetables & Fruits",
    "ubi kentang": "Vegetables & Fruits", "cili kering": "Vegetables & Fruits", "kelapa": "Vegetables & Fruits",
    "beras": "Rice & Grains", "bihun": "Rice & Grains", "tepung": "Rice & Grains",
    "mee/kuetiau": "Rice & Grains", "kacang": "Rice & Grains",
    "mi segera": "Bakery & Snacks", "sapuan (spreads)": "Bakery & Snacks",
    "esen dan ragi": "Cooking Essentials", "gula": "Cooking Essentials", "kicap dan sos": "Cooking Essentials",
    "minyak dan lemak": "Cooking Essentials", "rempah ratus (berbungkus)": "Cooking Essentials",
    "rempah ratus (tidak berbungkus)": "Cooking Essentials", "santan (kotak)": "Cooking Essentials",
    "ikan dalam tin": "Canned Food",
    "krimer dan susu tepung": "Eggs & Dairy", "mentega": "Eggs & Dairy", "telur": "Eggs & Dairy",
    "lampin pakai buang": "Baby & Personal Care", "makanan bayi": "Baby & Personal Care",
    "susu bayi": "Baby & Personal Care", "penjagaan diri": "Baby & Personal Care",
    "penjagaan rumah": "Household",
}


def category_of(raw) -> str:
    """Unknown (new) PriceCatcher categories pass through as-is, nicely cased."""
    return CATEGORY_MAP.get(" ".join(str(raw).lower().split()), nice(raw))


def nice(s: str) -> str:
    """'LOTUS'S SHAH ALAM' -> "Lotus's Shah Alam" (str.title() gives Lotus'S)."""
    return " ".join(w.capitalize() for w in str(s).split())


def chain_of(name: str) -> str:
    low = name.lower()
    for pattern, chain in CHAINS:
        if re.search(pattern, low):
            return chain
    return "Independent"


def read_parquet(url: str) -> pd.DataFrame:
    r = requests.get(url, timeout=300)
    r.raise_for_status()
    return pd.read_parquet(BytesIO(r.content))


def load_months(premise_codes) -> pd.DataFrame:
    """Current month plus enough previous months to cover HISTORY_DAYS."""
    first = date.today().replace(day=1)
    months = [first]
    for _ in range(HISTORY_DAYS // 30):  # e.g. Sep + Aug, Jul, Jun covers 90 days
        months.append((months[-1] - pd.Timedelta(days=1)).replace(day=1))
    frames = []
    for m in months:
        url = f"{BASE}/pricecatcher_{m:%Y-%m}.parquet"
        try:
            df = read_parquet(url)
        except requests.HTTPError as e:
            print(f"skip {url}: {e}")
            continue
        # keep memory down: only the store types we show
        frames.append(df[df["premise_code"].isin(premise_codes)][["date", "premise_code", "item_code", "price"]])
        print(f"loaded {url}")
    if not frames:
        sys.exit("no PriceCatcher data could be downloaded")
    return pd.concat(frames, ignore_index=True)


def main():
    items = read_parquet(f"{BASE}/lookup_item.parquet")
    premises = read_parquet(f"{BASE}/lookup_premise.parquet")

    premises["type"] = premises["premise_type"].map(classify_type)
    all_premises = premises
    premises = premises.dropna(subset=["type", "premise_code"])

    allp = load_months(set(premises["premise_code"]))
    allp["date"] = pd.to_datetime(allp["date"])
    allp = allp[allp["price"] > 0]
    newest = allp["date"].max()
    prices = allp[allp["date"] >= newest - pd.Timedelta(days=MAX_AGE_DAYS)]

    # latest price per (item, premise)
    prices = (prices.sort_values("date")
                    .drop_duplicates(["item_code", "premise_code"], keep="last"))
    write_coverage(all_premises, premises, prices, newest)

    prices = prices.merge(premises[["premise_code", "state", "premise"]], on="premise_code")
    prices["chain"] = prices["premise"].astype(str).map(chain_of)
    prices = prices.sort_values("price")
    # keep the cheapest N stores per item per state, plus each chain's
    # cheapest store there, so every chain shows up on the site
    cheapest = prices.groupby(["item_code", "state"], sort=False).head(KEEP_PER_STATE)
    per_chain = (prices[prices["chain"] != "Independent"]
                 .groupby(["item_code", "state", "chain"], sort=False).head(1))
    prices = pd.concat([cheapest, per_chain]).drop_duplicates(["item_code", "premise_code"])

    used_items = items[items["item_code"].isin(prices["item_code"])]
    used_prem = premises[premises["premise_code"].isin(prices["premise_code"])]

    out = {
        "source": "pricecatcher",
        "asOf": newest.date().isoformat(),
        "items": [
            {
                "id": int(r.item_code),
                "name": nice(r.item),
                "unit": str(r.unit),
                "category": category_of(r.item_category),
            }
            for r in used_items.itertuples()
        ],
        "stores": [
            {
                "id": int(r.premise_code),
                "name": nice(r.premise),
                "chain": chain_of(str(r.premise)),
                "type": r.type,
                "state": str(r.state),
                "district": str(r.district),
            }
            for r in used_prem.itertuples()
        ],
        "prices": [
            [int(r.item_code), int(r.premise_code), round(float(r.price), 2),
             r.date.date().isoformat()]
            for r in prices.itertuples()
        ],
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT}: {len(out['items'])} items, {len(out['stores'])} stores, "
          f"{len(out['prices'])} prices, as of {out['asOf']}")

    write_history(allp, newest, set(used_items["item_code"]))


def write_coverage(all_premises, premises, prices, newest):
    """Which store types / chains / states actually have recent prices.

    Written to data/coverage.json and, inside GitHub Actions, to the run's
    summary page so you can see coverage without digging through logs.
    """
    types = (all_premises.assign(included=all_premises["type"].notna())
             .groupby(["premise_type", "included"]).size().reset_index(name="premises"))
    active = premises[premises["premise_code"].isin(prices["premise_code"])].copy()
    active["chain"] = active["premise"].astype(str).map(chain_of)
    per_chain = (active.groupby("chain")
                 .agg(stores=("premise_code", "nunique"), states=("state", "nunique"),
                      types=("type", lambda t: ", ".join(sorted(set(t)))))
                 .sort_values("stores", ascending=False).reset_index())
    per_state = active.groupby("state")["premise_code"].nunique().sort_values(ascending=False)
    items_per_store = prices.groupby("premise_code")["item_code"].nunique()

    report = {
        "asOf": newest.date().isoformat(),
        "stores_with_recent_prices": int(active["premise_code"].nunique()),
        "items_with_recent_prices": int(prices["item_code"].nunique()),
        "median_items_per_store": float(items_per_store.median()) if len(items_per_store) else 0,
        "keep_per_state": KEEP_PER_STATE,
        "premise_types": types.to_dict("records"),
        "chains": per_chain.to_dict("records"),
        "states": {k: int(v) for k, v in per_state.items()},
    }
    (OUT.parent / "coverage.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))

    md = [f"## PriceCatcher coverage ({report['asOf']})", "",
          f"- Stores with prices in the last {MAX_AGE_DAYS} days: **{report['stores_with_recent_prices']}**",
          f"- Products: **{report['items_with_recent_prices']}** (median {report['median_items_per_store']:.0f} per store)",
          f"- Site keeps the cheapest **{KEEP_PER_STATE}** stores per product per state, plus each chain's cheapest store", "",
          "### Store types in PriceCatcher", "", "| premise_type | premises | shown on site |", "|---|---:|---|"]
    md += [f"| {r['premise_type']} | {r['premises']} | {'✅' if r['included'] else '—'} |" for r in report["premise_types"]]
    md += ["", "### Chains", "", "| chain | stores | states | types |", "|---|---:|---:|---|"]
    md += [f"| {r['chain']} | {r['stores']} | {r['states']} | {r['types']} |" for r in report["chains"]]
    md += ["", "### States", "", "| state | stores |", "|---|---:|"]
    md += [f"| {k} | {v} |" for k, v in report["states"].items()]
    text = "\n".join(md)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(text + "\n")


def write_history(allp, newest, item_codes):
    """Malaysia-wide daily lowest & median price per item for the chart."""
    start = newest - pd.Timedelta(days=HISTORY_DAYS - 1)
    h = allp[(allp["date"] >= start) & allp["item_code"].isin(item_codes)]
    daily = h.groupby(["item_code", "date"])["price"].agg(["min", "median"])
    dates = pd.date_range(start, newest, freq="D")
    out = {}
    for code, g in daily.groupby(level=0):
        g = g.droplevel(0).reindex(dates)
        if g["min"].notna().sum() < 2:
            continue
        rnd = lambda col: [None if pd.isna(v) else round(float(v), 2) for v in g[col]]
        out[int(code)] = {"min": rnd("min"), "med": rnd("median")}
    path = OUT.parent / "history.json"
    path.write_text(json.dumps({
        "source": "pricecatcher",
        "dates": [d.date().isoformat() for d in dates],
        "items": out,
    }, separators=(",", ":")))
    print(f"wrote {path}: {len(out)} items x {len(dates)} days")


if __name__ == "__main__":
    main()
