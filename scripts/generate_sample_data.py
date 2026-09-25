#!/usr/bin/env python3
"""Generate demo data for JimatBasket (data/prices.json).

The output is SAMPLE data so the site works out of the box. It is marked
`"source": "sample"` and the site shows a banner saying so. Run
`scripts/fetch_pricecatcher.py` to replace it with real government data.
"""
import json
import random
import zlib
from datetime import date, timedelta
from pathlib import Path

random.seed(42)
OUT = Path(__file__).resolve().parent.parent / "data" / "prices.json"

# (name, unit, category, base price in RM)
ITEMS = [
    ("Beras Super Tempatan 5%", "5kg", "Rice & Grains", 26.00),
    ("Beras Wangi Import", "5kg", "Rice & Grains", 32.50),
    ("Tepung Gandum", "1kg", "Rice & Grains", 2.95),
    ("Gula Pasir Kasar", "1kg", "Cooking Essentials", 2.85),
    ("Minyak Masak Paket", "1kg", "Cooking Essentials", 2.50),
    ("Minyak Masak Botol", "5kg", "Cooking Essentials", 34.90),
    ("Garam Halus", "500g", "Cooking Essentials", 1.20),
    ("Kicap Masin", "345ml", "Cooking Essentials", 3.40),
    ("Sos Cili", "340g", "Cooking Essentials", 4.20),
    ("Telur Ayam Gred A", "30 biji", "Eggs & Dairy", 14.90),
    ("Telur Ayam Gred C", "30 biji", "Eggs & Dairy", 11.90),
    ("Susu Segar Penuh", "1L", "Eggs & Dairy", 7.50),
    ("Susu Pekat Manis", "500g", "Eggs & Dairy", 3.90),
    ("Mentega", "250g", "Eggs & Dairy", 9.80),
    ("Ayam Standard", "1kg", "Meat & Seafood", 9.90),
    ("Daging Lembu Import", "1kg", "Meat & Seafood", 34.00),
    ("Ikan Kembung", "1kg", "Meat & Seafood", 15.00),
    ("Udang Putih Sederhana", "1kg", "Meat & Seafood", 38.00),
    ("Bawang Merah India", "1kg", "Vegetables & Fruits", 6.50),
    ("Bawang Putih Import", "1kg", "Vegetables & Fruits", 9.50),
    ("Kentang Import", "1kg", "Vegetables & Fruits", 4.80),
    ("Tomato", "1kg", "Vegetables & Fruits", 6.20),
    ("Kobis Bulat", "1kg", "Vegetables & Fruits", 4.50),
    ("Pisang Berangan", "1kg", "Vegetables & Fruits", 6.90),
    ("Roti Putih", "600g", "Bakery & Snacks", 4.60),
    ("Biskut Krim Kraker", "428g", "Bakery & Snacks", 6.80),
    ("Mi Segera Kari (5 bungkus)", "5 x 79g", "Bakery & Snacks", 5.80),
    ("Minuman Coklat Malt", "1kg", "Beverages", 23.90),
    ("Kopi Segera", "200g", "Beverages", 19.50),
    ("Teh Uncang (100 uncang)", "200g", "Beverages", 11.90),
    ("Minuman Isotonik", "1.5L", "Beverages", 4.20),
    ("Air Mineral", "1.5L", "Beverages", 1.60),
    ("Sardin Dalam Sos Tomato", "425g", "Canned Food", 6.90),
    ("Ikan Tuna Dalam Air", "185g", "Canned Food", 7.50),
    ("Serbuk Pencuci", "2.3kg", "Household", 19.90),
    ("Sabun Pencuci Pinggan", "900ml", "Household", 5.90),
    ("Tisu Tandas (10 gulung)", "10 gulung", "Household", 14.50),
    ("Lampin Pakai Buang (M)", "60 keping", "Baby & Personal Care", 42.90),
    ("Syampu", "400ml", "Baby & Personal Care", 16.90),
    ("Ubat Gigi", "175g", "Baby & Personal Care", 7.20),
]

# chain, type, price factor (lower = cheaper on average)
CHAINS = [
    ("Lotus's", "hypermarket", 0.95),
    ("AEON", "hypermarket", 1.00),
    ("Giant", "hypermarket", 0.97),
    ("Mydin", "hypermarket", 0.92),
    ("Econsave", "supermarket", 0.93),
    ("NSK Trade City", "hypermarket", 0.91),
    ("Jaya Grocer", "supermarket", 1.12),
    ("Village Grocer", "supermarket", 1.10),
    ("Hero Market", "supermarket", 0.98),
    ("TF Value-Mart", "supermarket", 0.95),
    ("99 Speedmart", "minimart", 0.96),
    ("KK Mart", "convenience", 1.10),
    ("7-Eleven", "convenience", 1.18),
    ("myNEWS", "convenience", 1.15),
]

# state -> districts
PLACES = {
    "Selangor": ["Petaling Jaya", "Shah Alam", "Subang Jaya", "Klang", "Kajang"],
    "W.P. Kuala Lumpur": ["Cheras", "Kepong", "Bangsar", "Setapak"],
    "Johor": ["Johor Bahru", "Batu Pahat", "Kluang"],
    "Pulau Pinang": ["George Town", "Bayan Lepas", "Butterworth"],
    "Perak": ["Ipoh", "Taiping"],
    "Negeri Sembilan": ["Seremban", "Nilai"],
    "Melaka": ["Melaka Tengah", "Alor Gajah"],
    "Kedah": ["Alor Setar", "Sungai Petani"],
    "Pahang": ["Kuantan", "Temerloh"],
    "Kelantan": ["Kota Bharu"],
    "Terengganu": ["Kuala Terengganu"],
    "Sabah": ["Kota Kinabalu", "Sandakan"],
    "Sarawak": ["Kuching", "Miri"],
}
# East Malaysia & some states are a little pricier on average
STATE_FACTOR = {"Sabah": 1.08, "Sarawak": 1.06, "W.P. Kuala Lumpur": 1.03}

# chains that aren't in every state
CHAIN_STATES = {
    "Jaya Grocer": {"Selangor", "W.P. Kuala Lumpur", "Johor", "Pulau Pinang"},
    "Village Grocer": {"Selangor", "W.P. Kuala Lumpur", "Negeri Sembilan"},
    "NSK Trade City": {"Selangor", "W.P. Kuala Lumpur", "Pahang"},
    "Hero Market": {"Selangor", "Johor", "Perak"},
    "TF Value-Mart": {"Perak", "Pahang", "Kedah", "Selangor", "Johor"},
    "Econsave": {"Selangor", "Johor", "Perak", "Melaka", "Negeri Sembilan", "Kedah"},
    "Mydin": {"Selangor", "Kelantan", "Terengganu", "Pulau Pinang", "Melaka", "Perak", "Kedah", "Johor"},
}


def main():
    today = date(2026, 9, 24)
    stores = []
    for state, districts in PLACES.items():
        for district in districts:
            for chain, ctype, _ in CHAINS:
                allowed = CHAIN_STATES.get(chain)
                if allowed and state not in allowed:
                    continue
                if random.random() < 0.35:  # not every chain in every district
                    continue
                stores.append({
                    "id": len(stores) + 1,
                    "name": f"{chain} {district}",
                    "chain": chain,
                    "type": ctype,
                    "state": state,
                    "district": district,
                })

    items = [
        {"id": i + 1, "name": n, "unit": u, "category": c}
        for i, (n, u, c, _) in enumerate(ITEMS)
    ]
    chain_factor = {c: f for c, _, f in CHAINS}
    chain_type = {c: t for c, t, _ in CHAINS}

    prices = []
    for store in stores:
        for item, (_, _, cat, base) in zip(items, ITEMS):
            ctype = chain_type[store["chain"]]
            # convenience stores carry a narrower range, no fresh produce
            if ctype == "convenience" and cat in ("Meat & Seafood", "Vegetables & Fruits"):
                continue
            if random.random() < 0.12:
                continue
            p = base * chain_factor[store["chain"]] * STATE_FACTOR.get(store["state"], 1.0)
            p *= random.uniform(0.94, 1.06)
            # occasional promo
            if random.random() < 0.06:
                p *= random.uniform(0.78, 0.9)
            p = round(round(p * 20) / 20, 2)  # nearest 5 sen
            d = today - timedelta(days=random.choice([0, 0, 0, 1, 1, 2, 3]))
            prices.append([item["id"], store["id"], p, d.isoformat()])

    data = {
        "source": "sample",
        "asOf": today.isoformat(),
        "items": items,
        "stores": stores,
        "prices": prices,
    }
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} ({len(items)} items, {len(stores)} stores, {len(prices)} prices)")
    write_history(today, items, prices)
    write_online(today)


def write_online(today):
    """Demo data/online.json in the format scripts/fetch_online_prices.py writes."""
    rnd = random.Random(7)  # separate stream: keeps prices.json unchanged
    products = [
        ("Milo Activ-Go Chocolate Malt Drink 1kg", "1kg", "Beverages", 23.90),
        ("Nescafe Classic Instant Coffee 200g", "200g", "Beverages", 19.90),
        ("Lipton Yellow Label Tea 100 Teabags", "100pcs", "Beverages", 12.50),
        ("100PLUS Isotonic Drink 1.5L", "1.5L", "Beverages", 4.30),
        ("Spritzer Natural Mineral Water 1.5L", "1.5L", "Beverages", 1.80),
        ("Dutch Lady Full Cream Milk 1L", "1L", "Eggs & Dairy", 7.60),
        ("Anchor Salted Butter 227g", "227g", "Eggs & Dairy", 12.90),
        ("Farm Fresh Yogurt Plain 700g", "700g", "Eggs & Dairy", 10.90),
        ("Gardenia Original Classic Bread 600g", "600g", "Bakery & Snacks", 4.70),
        ("Maggi Kari Instant Noodles 5 x 79g", "5 x 79g", "Bakery & Snacks", 6.10),
        ("Munchy's Lexus Cream Crackers 190g", "190g", "Bakery & Snacks", 5.40),
        ("Ayam Brand Sardines in Tomato Sauce 425g", "425g", "Canned Food", 7.40),
        ("Knife Cooking Oil 5kg", "5kg", "Cooking Essentials", 36.90),
        ("Adabi Serbuk Kari Daging 250g", "250g", "Cooking Essentials", 5.90),
        ("Jasmine Super Tempatan 5% Beras 5kg", "5kg", "Rice & Grains", 26.90),
        ("Quaker Instant Oatmeal 800g", "800g", "Rice & Grains", 13.90),
        ("Dynamo Power Gel Detergent 2.7kg", "2.7kg", "Household", 29.90),
        ("Kleenex Ultra Soft Bath Tissue 10 Rolls", "10 rolls", "Household", 16.90),
        ("Colgate Great Regular Flavour Toothpaste 175g", "175g", "Baby & Personal Care", 7.90),
        ("Pampers Baby Dry Pants M 62s", "62pcs", "Baby & Personal Care", 54.90),
    ]
    retailers = {"Lotus's": 0.97, "AEON": 1.0, "Jaya Grocer": 1.1, "Mydin": 0.95}
    out = []
    for name, unit, cat, base in products:
        key = "demo:" + name.lower()
        offers = []
        for r, factor in retailers.items():
            if rnd.random() < 0.2:
                continue
            price = round(round(base * factor * rnd.uniform(0.93, 1.07) * 20) / 20, 2)
            offers.append([r, price, "https://example.com/demo-product", 0 if rnd.random() < 0.08 else 1, today.isoformat()])
        offers.sort(key=lambda o: o[1])
        out.append({"key": key, "id": 1_000_000_000 + zlib.crc32(key.encode()) % 1_000_000_000,
                    "name": name, "unit": unit, "category": cat, "offers": offers})
    path = OUT.parent / "online.json"
    path.write_text(json.dumps({"source": "sample", "asOf": today.isoformat(),
                                "retailers": [{"name": r, "status": "demo"} for r in retailers],
                                "products": out}, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {path} ({len(out)} products)")


def write_history(today, items, prices):
    """90 days of Malaysia-wide lowest & median price per item, ending today."""
    days = 90
    dates = [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
    by_item = {}
    for item_id, _, p, _ in prices:
        by_item.setdefault(item_id, []).append(p)
    out = {}
    for item in items:
        ps = sorted(by_item.get(item["id"], []))
        if not ps:
            continue
        lo_now, med_now = ps[0], ps[len(ps) // 2]
        # walk backwards from today's values
        ratio = lo_now / med_now
        med = [med_now]
        drift = random.uniform(-0.0015, 0.003)  # most things got a bit pricier
        for _ in range(days - 1):
            med.append(med[-1] * (1 - drift + random.gauss(0, 0.004)))
        med.reverse()
        # lowest price moves in steps (promos run for days), sometimes dipping
        lo, cur = [], random.uniform(1.0, 1.06)
        for i in range(days):
            if random.random() < 0.15:
                cur = random.uniform(0.94, 0.99) if random.random() < 0.25 else random.uniform(1.0, 1.08)
            lo.append(min(med[i] * ratio * cur, med[i]))
        lo[-1], med[-1] = lo_now, med_now
        out[item["id"]] = {
            "min": [round(x, 2) for x in lo],
            "med": [round(x, 2) for x in med],
        }
    path = OUT.parent / "history.json"
    path.write_text(json.dumps({"source": "sample", "dates": dates, "items": out}, separators=(",", ":")))
    print(f"wrote {path} ({len(out)} items x {days} days)")


if __name__ == "__main__":
    main()
