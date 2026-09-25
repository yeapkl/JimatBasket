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
- 🛒 **Online shop prices**: thousands more products collected from retailer websites (Lotus's, AEON, Jaya Grocer...), grouped by barcode and ranked cheapest first, with links to buy
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

### Coverage report

Every PriceCatcher run writes `data/coverage.json` and a table on the Action's summary page. The table shows:

- every PriceCatcher store type, and whether the site shows it;
- how many stores each chain has (Lotus's, 99 Speedmart, KK Mart...) and in how many states;
- stores per state.

Use it to see which chains PriceCatcher actually surveys. Store types are matched by keyword, so small spelling changes in PriceCatcher don't drop stores. Wet markets and farmers' markets are left out on purpose. `KEEP_PER_STATE` (default 12) sets how many of the cheapest stores per product per state are kept.

## Online prices from retailer websites

PriceCatcher covers a fixed list of everyday items. For the full range on the shelf, `scripts/fetch_online_prices.py` collects prices from retailers' own online shops. It needs no site-specific code for most shops:

1. **Respects `robots.txt`.** Pages a site disallows are never fetched, and its `Crawl-delay` is honoured.
2. **Finds product pages through the site's sitemaps.**
3. **Reads the standard product data** that most shops publish for Google Shopping (schema.org JSON-LD, or product price meta tags): name, price, barcode, brand and stock status.
4. **Keeps only grocery categories.** Electronics, clothes and the like are skipped.
5. **Groups the same product across shops**, by barcode or otherwise by name and size, and ranks the shops cheapest first. Online prices apply in every state. Shoppers see them under the **Online** filter or alongside store prices.

It's polite by design:

- one request at a time per site, at least 1.5 s apart;
- a clear User-Agent (`JimatBasketBot`);
- backs off when a site says it's busy (429/503) and stops after repeated refusals;
- at most 3,000 pages per shop per run, starting from a different point each day, so large catalogues are covered over several days;
- prices seen in the last 14 days are kept in between.

**Turning a retailer on:** every entry in `scripts/retailers.json` starts with `"enabled": false`.

1. **Read the retailer's terms of use.** If they forbid automated collection, leave it off, or ask the retailer for a price feed or partnership instead.
2. Test it without saving anything:
   ```bash
   pip install requests
   python scripts/fetch_online_prices.py --only "Jaya Grocer" --max-pages 30 --dry-run
   ```
   You can also use *Actions → Update online prices → Run workflow* with `only` filled in.
3. Set `"enabled": true`. The **Update online prices** job then runs daily (about 2:43am Malaysia time) and redeploys the site.

**Reading the run report** (on the Action's summary page):

| status | meaning |
|---|---|
| `ok` | Working |
| `no-product-data` | Pages load, but the product data is drawn by JavaScript. This site needs a custom adapter |
| `robots.txt disallows crawling` | The site asks bots not to crawl, so it's skipped |
| `blocked` | Repeated 403/429 errors, so the run stopped |
| `unreachable` | The domain in `retailers.json` is probably wrong |
| `no product pages found in sitemaps` | Add the shop's sitemap to `sitemaps`, or its product URL pattern to `product_url` |

The retailer domains in `retailers.json` weren't verified when it was written. Shops without an online store with prices (many convenience stores) have nothing to collect. For those, PriceCatcher and shopper reports are the sources.

Settings (environment variables): `ONLINE_MAX_PAGES` (3000), `ONLINE_MIN_DELAY` (1.5 s), `ONLINE_TIME_BUDGET_MIN` (150), `ONLINE_STALE_DAYS` (14).

## How fresh are the prices?

Prices are **not** fetched live from stores when someone opens the site. Every visit loads the latest copies of the data files, which two daily GitHub Actions rebuild:

- **Update prices** (about 9:17am Malaysia time) reads PriceCatcher, a daily survey;
- **Update online prices** (about 2:43am Malaysia time) reads retailer websites.

Each one redeploys the site when it finishes.

## Maintaining the data files

| File | Who updates it | How |
|---|---|---|
| `data/prices.json`, `data/history.json`, `data/coverage.json` | GitHub Action (daily) | `scripts/fetch_pricecatcher.py` |
| `data/online.json` | GitHub Action (daily) | `scripts/fetch_online_prices.py`, retailers listed in `scripts/retailers.json` |
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

## Deploy to Google Cloud (Cloud Run)

`.github/workflows/deploy-gcp.yml` builds the site into a small nginx container (`Dockerfile`, `deploy/nginx.conf`) and deploys it to Cloud Run in `asia-southeast1` (Singapore). It runs:

- on every push to `main`,
- after each daily **Update prices** / **Update online prices** run, so new prices go live the same day,
- by hand from the Actions tab.

GitHub logs in to Google with Workload Identity Federation, so **no service-account key** is stored anywhere. Only this repo's `main` branch can deploy.

### One-time setup (existing GCP project)

JimatBasket shares the GCP project with your other app. Everything the setup creates is named for JimatBasket, and the deployer can only change the `jimatbasket` Cloud Run service, not your other services.

1. In **Cloud Shell**, select the project and run the setup script:
   ```bash
   gcloud config set project YOUR_EXISTING_PROJECT
   bash deploy/gcp-setup.sh
   ```
   It creates the Artifact Registry repo, two service accounts, a placeholder Cloud Run service (made public), and the GitHub login trust. If a `github` identity pool already exists in the project, it's reused and a new JimatBasket provider is added to it.
2. Add the **7 variables** the script prints under *Settings → Secrets and variables → Actions → Variables*: `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, `GCP_AR_REPO`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`. None are secret.
3. Merge to `main`, or run **Deploy to GCP** from the Actions tab.

### Permissions

**You (running the script once):** Owner on the project, or all of Service Usage Admin, Artifact Registry Admin, Service Account Admin, Project IAM Admin, Workload Identity Pool Admin, and Cloud Run Admin.

**Deployer `gh-deployer@PROJECT.iam.gserviceaccount.com`** (the script grants all of these):

| Role | Granted on | Why |
|---|---|---|
| `roles/run.developer` | the `jimatbasket` Cloud Run service only | Deploy new revisions |
| `roles/artifactregistry.writer` | the `jimatbasket` Artifact Registry repo only | Push images |
| `roles/iam.serviceAccountUser` | the runtime account only | Run the service as that account |
| `roles/iam.workloadIdentityUser` | the deployer, granted to this GitHub repo | Keyless login from GitHub Actions |

**Runtime account `jimatbasket-run`:** no roles. The site only serves static files.

**Public access:** `allUsers` gets `roles/run.invoker` on the service. If your organization enforces *Domain restricted sharing* (`iam.allowedPolicyMemberDomains`), an org admin must allow it for this project. The script prints a warning if the grant fails.

**GitHub workflow:** `id-token: write`, `contents: read`. You can require approval before each deploy by adding reviewers to the `production` environment (*Settings → Environments*).

## Deploy to GitHub Pages (alternative)

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
data/coverage.json             # which store types / chains / states PriceCatcher covers
data/online.json               # prices from retailer websites
data/promos.json               # weekly deals (hand-curated)
data/community.json            # approved user price reports
data/aid.json                  # SARA / Subsidi label rules
scripts/generate_sample_data.py
scripts/fetch_pricecatcher.py  # real data from data.gov.my
.github/workflows/update-prices.yml   # daily PriceCatcher refresh
.github/workflows/update-online-prices.yml  # daily retailer-website refresh
scripts/fetch_online_prices.py        # retailer website collector
scripts/retailers.json                # which retailer sites to collect (all off by default)
.github/workflows/deploy-gcp.yml      # build + deploy to Cloud Run
Dockerfile, .dockerignore, deploy/nginx.conf
deploy/gcp-setup.sh                   # one-time GCP setup (run in Cloud Shell)
```

*Prices can change without notice. JimatBasket isn't affiliated with any retailer.*
