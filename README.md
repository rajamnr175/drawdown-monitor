# Drawdown & Support Monitor

A static dashboard that tracks 46 assets (AI mega-caps, AI chips and infrastructure, memory makers, new AI listings, crypto, indices, metals) after the November 2026 AI-led correction.

- **Data:** `scripts/update.py` pulls weekly and monthly bars from Yahoo Finance via `yfinance` and writes JSON to `data/`. Raw bars are cached in `data/raw/`.
- **Live prices:** the page polls the Hyperliquid public info API every 60 s, both native perps and the `xyz` dex.
- **Hosting:** GitHub Pages serves the repo root. A GitHub Action re-runs the pipeline every weekday at 22:30 UTC and commits the JSON.

## Run locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/update.py           # fetch + rebuild JSON
.venv/bin/python scripts/update.py --offline # rebuild JSON from data/raw only
python3 -m http.server 8765                   # open http://localhost:8765
```

Screenshots at 1440 / 1024 / 390 px (needs `pip install playwright && playwright install chromium`):

```bash
.venv/bin/python scripts/screenshot.py screenshots local
```

## Files

| File | Contents |
|---|---|
| `data/overview.json` | close, ATH and date, % below ATH, 52-week range, week / MTD / 6-month / 1-year returns, 50/200-week MAs, market cap, P/E |
| `data/crashes.json` | counts of weeks down ≥15/20/25% and months down ≥20/25/30% since 1996, each with its most recent and worst date, plus every event |
| `data/underwater.json` | 15 years of weekly closes and drawdowns for NVDA, S&P 500, Nasdaq 100, gold, silver and BTC, with every 10%+ correction |
| `data/levels.json` | 4 nearest supports and 2 nearest resistances (swing pivots, MAs, 52-week low, Fibonacci) |
| `data/valuation.json` | market cap (USD), trailing and forward P/E, P/B, revenue and earnings growth, earnings dates |
| `data/leaders.json` | sector and theme ETFs, and themed S&P 500 stocks, by 6-month return relative to the S&P 500 |
| `data/meta.json` | tickers and fields that came back empty |

This is a screen, not financial advice.
