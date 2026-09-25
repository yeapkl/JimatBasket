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
import re
import sys
from datetime import date
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

BASE = "https://storage.data.gov.my/pricecatcher"
OUT = Path(__file__).resolve().parent.parent / "data" / "prices.json"
KEEP_PER_STATE = 12   # cheapest N stores per item per state
MAX_AGE_DAYS = 14     # ignore prices older than this (relative to newest date)

# PriceCatcher premise_type -> our store type
TYPE_MAP = {
    "hypermarket": "hypermarket",
    "pasar raya / supermarket": "supermarket",
    "kedai serbaneka": "convenience",
    "kedai runcit": "minimart",
}

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
]


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


def load_month() -> pd.DataFrame:
    today = date.today()
    months = [today.replace(day=1)]
    prev = (months[0] - pd.Timedelta(days=1)).replace(day=1)
    months.append(prev)
    frames = []
    for m in months:
        url = f"{BASE}/pricecatcher_{m:%Y-%m}.parquet"
        try:
            frames.append(read_parquet(url))
            print(f"loaded {url}")
        except requests.HTTPError as e:
            print(f"skip {url}: {e}")
    if not frames:
        sys.exit("no PriceCatcher data could be downloaded")
    return pd.concat(frames, ignore_index=True)


def main():
    prices = load_month()
    items = read_parquet(f"{BASE}/lookup_item.parquet")
    premises = read_parquet(f"{BASE}/lookup_premise.parquet")

    premises["type"] = premises["premise_type"].str.strip().str.lower().map(TYPE_MAP)
    premises = premises.dropna(subset=["type", "premise_code"])

    prices["date"] = pd.to_datetime(prices["date"])
    newest = prices["date"].max()
    prices = prices[prices["date"] >= newest - pd.Timedelta(days=MAX_AGE_DAYS)]
    prices = prices[prices["premise_code"].isin(premises["premise_code"])]
    prices = prices[prices["price"] > 0]

    # latest price per (item, premise)
    prices = (prices.sort_values("date")
                    .drop_duplicates(["item_code", "premise_code"], keep="last"))

    prices = prices.merge(premises[["premise_code", "state"]], on="premise_code")
    prices = (prices.sort_values("price")
                    .groupby(["item_code", "state"], sort=False)
                    .head(KEEP_PER_STATE))

    used_items = items[items["item_code"].isin(prices["item_code"])]
    used_prem = premises[premises["premise_code"].isin(prices["premise_code"])]

    out = {
        "source": "pricecatcher",
        "asOf": newest.date().isoformat(),
        "items": [
            {
                "id": int(r.item_code),
                "name": str(r.item).title(),
                "unit": str(r.unit),
                "category": str(r.item_category).title(),
            }
            for r in used_items.itertuples()
        ],
        "stores": [
            {
                "id": int(r.premise_code),
                "name": str(r.premise).title(),
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


if __name__ == "__main__":
    main()
