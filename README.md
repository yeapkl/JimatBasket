# 🧺 JimatBasket

**Compare grocery prices across Malaysian supermarkets, hypermarkets and convenience stores. The cheapest store is always listed first.**

A clean, mobile-first static website with no build step and no backend. It runs on GitHub Pages, Netlify, Cloudflare Pages or any web host.

## Features

- 🔍 **Instant search** in Malay or English (`egg` finds *telur*, `rice` finds *beras*)
- 📍 **Filter by state** and **store type** (hypermarket, supermarket, mini market, convenience)
- 🥇 **Cheapest first**: every product shows its cheapest store, how much you can save, and a full ranked list
- 🛒 **Smart basket**: add items and see
  - the **cheapest mix** (buy each item wherever it's cheapest), and
  - the **best one-stop shop** (the single store with the lowest total)
- 📣 **Ad slots**: a top banner plus an inline card in the results. House ads show by default, and Google AdSense is ready to switch on
- ❤️ **Contribute button**: a support modal with Ko-fi, GitHub Sponsors and an optional DuitNow/TNG QR code
- 📈 **Price history**: a 90-day chart of the lowest and typical (median) price, with a "good time to buy?" verdict and a table view
- 🔥 **This week's deals**: weekly promotions from store catalogues, with "Promo" badges on products
- 📸 **Report a price**: shoppers can submit prices with a photo of the shelf tag or receipt. Once you approve a report, it appears as a "Community" price
- 🌐 **English / Bahasa Melayu / 中文** language switch (search also understands 鸡蛋, 米, and so on)
- 🛍️ **Buy online** buttons (affiliate links) and a sponsored **Featured deal** card
- 🏷️ **SARA / Subsidi labels** and an "Aid-eligible" filter
- 🌙 Dark mode, shareable filter URLs (`?q=beras&state=Selangor&lang=ms`), keyboard shortcut `/` to search

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(The page loads `data/prices.json` with `fetch`, so opening `index.html` directly from disk won't work.)

## Real price data: KPDN PriceCatcher

The repo ships with **demo data** (`scripts/generate_sample_data.py`), and the site shows a banner saying so.

For real prices, use **[PriceCatcher](https://data.gov.my/data-catalogue/pricecatcher)**, the Ministry of Domestic Trade's (KPDN) daily price survey. It covers about 2,000 items at thousands of premises nationwide and is published as free open data (CC BY 4.0).

```bash
pip install pandas pyarrow requests
python scripts/fetch_pricecatcher.py   # rewrites data/prices.json
```

The GitHub Action `.github/workflows/update-prices.yml` runs the fetcher **every day** and commits new prices automatically. After you push, enable it under *Actions* and click *Run workflow* once.

> Note: the fetcher could not be tested where it was written, because network access to data.gov.my was blocked. Run the Action once and check its log. If the column names in the PriceCatcher files have changed, adjust them in `scripts/fetch_pricecatcher.py`.

## How fresh are the prices?

Prices are **not** fetched live from stores when someone opens the site. Every visit loads the latest copy of `data/prices.json` and `data/history.json`. The GitHub Action rebuilds those files from PriceCatcher **once a day**, so visitors always see the most recent daily data. PriceCatcher itself is a daily survey, so this matches how often the source changes.

## Maintaining the data files

| File | Who updates it | How |
|---|---|---|
| `data/prices.json`, `data/history.json` | GitHub Action (daily) | `scripts/fetch_pricecatcher.py` |
| `data/promos.json` | You, weekly | Copy deals from store catalogues. Entries past `validTo` hide automatically. `states: []` means nationwide |
| `data/community.json` | You, after review | Add approved "Report a price" submissions. Set `verified: true` if you checked the photo |
| `data/aid.json` | You, when programmes change | Keyword rules for the SARA / Subsidi labels. **Check the official SARA item list and adjust the keywords.** The current rules are indicative |

## Configure ads, donations, affiliates & reports

Edit `assets/config.js`:

- `support.links`: your Ko-fi, GitHub Sponsors, etc. (replace `YOUR_NAME`)
- `support.duitNowQr`: the path to a QR image, e.g. `assets/duitnow.png`
- `ads.adsense.client` / `slots`: your AdSense IDs. Leave them empty to show house ads
- `ads.house`: your own "Advertise here" / partner cards
- `featured`: the sponsored "Featured deal" card at the top of the results (sell this slot)
- `shopOnline`: "Buy online" buttons. Replace the URLs with your affiliate links (`{q}` becomes the product name)
- `submit.endpoint`: where "Report a price" sends submissions. Use a free [Formspree](https://formspree.io) form or a Google Apps Script web app, both of which accept photos. While it's empty, the form opens the visitor's email app addressed to `submit.email`
- `defaultLang`: `en`, `ms` or `zh`. Translations live in `assets/i18n.js`

## Deploy to GitHub Pages

*Settings → Pages → Deploy from branch →* pick your branch and `/ (root)`. That's it.

---

## Does this idea work? (honest take)

**Yes, the need is real.** The cost of living is a top concern in Malaysia, and prices for the same item vary a lot between stores (often 20–40% for staples). The government runs PriceCatcher precisely because people want this. But the official app is functional rather than friendly, which leaves room for a better experience.

**What makes it hard:**
1. **Data** is the whole game. Scraping retailer websites is fragile and may break their terms of service. PriceCatcher is legal and free, but it covers a fixed list of about 2,000 surveyed items, not every SKU, and some prices can be a few days old.
2. **Promotions** such as weekly specials, member prices and bundles are where the real savings are. PriceCatcher doesn't capture them.
3. **Distance matters.** Saving RM2 isn't worth a 20 km drive, so location awareness is essential.
4. **Monetisation is thin.** Display ads pay little until you reach large traffic. Donations help, but they won't cover much on their own.

**Verdict:** it's viable as a free, useful public-good site, and it can grow into a business if you add promotions data and location, then move into partnerships.

## Suggestions / roadmap

Done ✅: price history charts, weekly promos, crowdsourced prices, BM/中文, affiliate links + featured deals, SARA/Subsidi tags.

Still open:
1. **"Near me"**: use the browser's location to sort by *price + distance*. PriceCatcher includes premise addresses, which can be geocoded once.
2. **Price-drop alerts**: let people "watch" an item and get an email or Telegram message when it drops. This builds a returning audience (needs a small backend).
3. **PWA / "Add to home screen"**: works offline in the store with the shopping list.
4. **B2B price reports** for SMEs and kedai runcit owners.

## Project structure

```
index.html                     # page
assets/styles.css              # design (light + dark)
assets/app.js                  # search, ranking, basket, chart, deals, reports, ads
assets/config.js               # your ads/donation/affiliate/report settings
assets/i18n.js                 # EN / BM / 中文 translations
data/prices.json               # price data (demo or PriceCatcher)
data/history.json              # 90-day lowest/median per item
data/promos.json               # weekly deals (hand-curated)
data/community.json            # approved user price reports
data/aid.json                  # SARA / Subsidi label rules
scripts/generate_sample_data.py
scripts/fetch_pricecatcher.py  # real data from data.gov.my
.github/workflows/update-prices.yml
```

*Prices can change without notice. JimatBasket isn't affiliated with any retailer.*
