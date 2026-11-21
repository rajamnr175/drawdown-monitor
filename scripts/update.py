#!/usr/bin/env python3
"""Drawdown & Support Monitor - data pipeline.

Pulls weekly + monthly bars from Yahoo Finance (yfinance) and writes the JSON
files the static site reads from ./data. Safe to re-run: raw bars are
overwritten, JSON is regenerated from scratch each time.

    python scripts/update.py            # full run
    python scripts/update.py --offline  # rebuild JSON from data/raw only
"""
import json
import math
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
START = "1996-01-01"
UW_START = "2011-11-01"
OFFLINE = "--offline" in sys.argv

# ---------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------
# (yahoo symbol, display ticker, name, hyperliquid perp or None)
GROUPS = [
    ("mega", "AI mega-caps", True, [
        ("AAPL", "AAPL", "Apple", "xyz:AAPL"),
        ("MSFT", "MSFT", "Microsoft", "xyz:MSFT"),
        ("GOOGL", "GOOGL", "Alphabet", "xyz:GOOGL"),
        ("AMZN", "AMZN", "Amazon", "xyz:AMZN"),
        ("META", "META", "Meta Platforms", "xyz:META"),
        ("ORCL", "ORCL", "Oracle", "xyz:ORCL"),
    ]),
    ("chips", "AI chips & infra", True, [
        ("NVDA", "NVDA", "NVIDIA", "xyz:NVDA"),
        ("AVGO", "AVGO", "Broadcom", "xyz:AVGO"),
        ("2330.TW", "TSMC", "Taiwan Semiconductor", "xyz:TSM"),
        ("AMD", "AMD", "Advanced Micro Devices", "xyz:AMD"),
        ("BE", "BE", "Bloom Energy", "xyz:BE"),
        ("NBIS", "NBIS", "Nebius Group", "xyz:NBIS"),
        ("IREN", "IREN", "IREN", "xyz:IREN"),
        ("AAOI", "AAOI", "Applied Optoelectronics", "xyz:AAOI"),
    ]),
    ("memory", "Memory", True, [
        ("005930.KS", "Samsung", "Samsung Electronics", "xyz:SMSN"),
        ("MU", "MU", "Micron Technology", "xyz:MU"),
        ("000660.KS", "SK hynix", "SK hynix", "xyz:SKHX"),
        ("688825.SS", "CXMT", "ChangXin Memory", "xyz:CXMT"),
        ("SNDK", "SNDK", "SanDisk", "xyz:SNDK"),
        ("285A.T", "Kioxia", "Kioxia Holdings", "xyz:KIOXIA"),
        ("2408.TW", "Nanya", "Nanya Technology", None),
    ]),
    ("listings", "New AI listings", True, [
        ("SPCX", "SPCX", "SpaceX", "xyz:SPCX"),
        ("ANT", "ANT", "Anthropic", "xyz:ANT"),
        ("CBRS", "CBRS", "Cerebras Systems", "xyz:CBRS"),
        ("2513.HK", "Zhipu", "Zhipu AI", "xyz:ZHIPU"),
        ("CRWV", "CRWV", "CoreWeave", "xyz:CRWV"),
        ("0100.HK", "MiniMax", "MiniMax", "xyz:MINIMAX"),
    ]),
    ("crypto", "Crypto", True, [
        ("BTC-USD", "BTC", "Bitcoin", "BTC"),
        ("ETH-USD", "ETH", "Ethereum", "ETH"),
        ("SOL-USD", "SOL", "Solana", "SOL"),
        ("HYPE32196-USD", "HYPE", "Hyperliquid", "HYPE"),
        ("ZEC-USD", "ZEC", "Zcash", "ZEC"),
        ("NEAR-USD", "NEAR", "NEAR Protocol", "NEAR"),
    ]),
    ("index", "Index", False, [
        ("^GSPC", "S&P 500", "S&P 500", "xyz:SP500"),
        ("^NDX", "Nasdaq 100", "Nasdaq 100", "xyz:XYZ100"),
        ("^KS11", "KOSPI", "KOSPI Composite", "xyz:KR200"),
        ("^N225", "Nikkei 225", "Nikkei 225", "xyz:JP225"),
        ("^NSEI", "Nifty 50", "Nifty 50", "xyz:NIFTY"),
        ("000300.SS", "CSI 300", "CSI 300", None),
        ("^TWII", "TAIEX", "Taiwan Weighted", None),
    ]),
    ("metals", "Metals", False, [
        ("GC=F", "Gold", "Gold futures", "xyz:GOLD"),
        ("SI=F", "Silver", "Silver futures", "xyz:SILVER"),
        ("HG=F", "Copper", "Copper futures", "xyz:COPPER"),
        ("PL=F", "Platinum", "Platinum futures", "xyz:PLATINUM"),
        ("PA=F", "Palladium", "Palladium futures", "xyz:PALLADIUM"),
        ("ALI=F", "Aluminium", "Aluminium futures", "xyz:ALUMINIUM"),
    ]),
]
COMPANY_GROUPS = {"mega", "chips", "memory", "listings"}

UNDERWATER = [
    ("NVDA", "NVIDIA"), ("^GSPC", "S&P 500"), ("^NDX", "Nasdaq 100"),
    ("GC=F", "Gold"), ("SI=F", "Silver"), ("BTC-USD", "Bitcoin"),
]

# Section 5: sector / theme ETFs (used only for the "Who's winning" ranking)
ETFS = [
    ("XLK", "Technology"), ("XLC", "Communication services"), ("XLY", "Consumer discretionary"),
    ("XLP", "Consumer staples"), ("XLF", "Financials"), ("XLV", "Health care"),
    ("XLI", "Industrials"), ("XLE", "Energy"), ("XLB", "Materials"), ("XLU", "Utilities"),
    ("XLRE", "Real estate"), ("SMH", "Semiconductors"), ("DRAM", "Memory"),
    ("IGV", "Software"), ("CIBR", "Cybersecurity"), ("ITA", "Aerospace & defense"),
    ("PAVE", "Infrastructure"), ("URA", "Uranium"), ("TAN", "Solar"), ("GDX", "Gold miners"),
    ("COPX", "Copper miners"), ("XBI", "Biotech"), ("KRE", "Regional banks"),
    ("IBIT", "Bitcoin"), ("EWY", "South Korea"), ("EWJ", "Japan"), ("INDA", "India"),
    ("FXI", "China large-cap"),
]
THEMES = [
    ("AI compute", ["NVDA", "AVGO", "AMD", "MU", "ANET", "LRCX", "AMAT", "KLAC"]),
    ("Power & grid", ["VST", "CEG", "GEV", "NRG", "ETN", "PWR", "NEE"]),
    ("Software & data", ["PLTR", "ORCL", "NOW", "CRM", "ADBE", "CRWD", "PANW"]),
    ("Defense", ["LMT", "NOC", "GD", "RTX", "LHX", "HWM"]),
    ("Banks & brokers", ["JPM", "GS", "MS", "BAC", "WFC", "SCHW", "HOOD"]),
    ("Energy", ["XOM", "CVX", "COP", "EOG", "SLB", "OXY"]),
    ("Health care", ["LLY", "JNJ", "ABBV", "MRK", "UNH", "ISRG"]),
    ("Defensives", ["WMT", "COST", "PG", "KO", "PEP", "MCD"]),
    ("Miners & materials", ["NEM", "FCX", "LIN", "NUE", "MLM"]),
]

FX_TICKERS = {"KRW": "KRW=X", "JPY": "JPY=X", "TWD": "TWD=X", "HKD": "HKD=X", "CNY": "CNY=X"}

FALLBACK = {"000300.SS": ["399300.SZ"]}

missing = {}  # ticker -> list of empty fields


def note_missing(t, field):
    missing.setdefault(t, []).append(field)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def fnum(x, nd=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def d(ts):
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def safe_name(sym):
    return sym.replace("^", "_").replace("=", "_").replace("/", "_")


def fetch(sym, interval, start=START, retries=3):
    """Download bars, cache to data/raw, return DataFrame (may be empty)."""
    tag = "" if start == START else "_" + start[:4]
    path = RAW / f"{safe_name(sym)}_{interval}{tag}.csv"
    if OFFLINE:
        if path.exists():
            return pd.read_csv(path, index_col=0, parse_dates=True)
        return pd.DataFrame()
    for attempt in range(retries):
        try:
            h = yf.Ticker(sym).history(start=start, interval=interval, auto_adjust=True)
            h = h[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
            h.index = pd.to_datetime(h.index).tz_localize(None).normalize()
            h = h[~h.index.duplicated(keep="last")]
            if len(h):
                h.to_csv(path)
            return h
        except Exception as e:  # network hiccup / rate limit
            print(f"  ! {sym} {interval} attempt {attempt + 1}: {e}")
            time.sleep(2 + attempt * 3)
    return pd.DataFrame()


def fetch_info(sym):
    path = RAW / f"{safe_name(sym)}_info.json"
    if OFFLINE:
        return json.loads(path.read_text()) if path.exists() else {}
    for attempt in range(3):
        try:
            t = yf.Ticker(sym)
            info = t.info or {}
            keep = {k: info.get(k) for k in (
                "shortName", "longName", "currency", "financialCurrency", "marketCap",
                "trailingPE", "forwardPE", "priceToBook", "revenueGrowth", "earningsGrowth",
                "trailingEps", "forwardEps", "quoteType", "exchange")}
            try:
                cal = t.calendar or {}
                ed = cal.get("Earnings Date") if isinstance(cal, dict) else None
                if ed:
                    keep["earningsDates"] = [str(x) for x in ed]
            except Exception:
                pass
            path.write_text(json.dumps(keep, default=str, indent=1))
            return keep
        except Exception as e:
            print(f"  ! {sym} info attempt {attempt + 1}: {e}")
            time.sleep(2 + attempt * 3)
    return {}


def pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return fnum(a / b - 1, 5)


def close_n_back(s, n):
    return float(s.iloc[-1 - n]) if len(s) > n else None


# ---------------------------------------------------------------------------
# Computations
# ---------------------------------------------------------------------------
def overview_for(w, m):
    c = w["Close"]
    close = float(c.iloc[-1])
    hi_idx = w["High"].idxmax()
    ath = float(w["High"].max())
    last52 = w.iloc[-52:]
    lo_idx = last52["Low"].idxmin()
    out = {
        "close": fnum(close),
        "asOf": d(w.index[-1]),
        "ath": fnum(ath), "athDate": d(hi_idx),
        "pctFromAth": pct(close, ath),
        "low52": fnum(last52["Low"].min()), "low52Date": d(lo_idx),
        "high52": fnum(last52["High"].max()), "high52Date": d(last52["High"].idxmax()),
        "retWeek": pct(close, close_n_back(c, 1)),
        "ret6m": pct(close, close_n_back(c, 26)),
        "ret1y": pct(close, close_n_back(c, 52)),
        "ma50w": fnum(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else None,
        "ma200w": fnum(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else None,
        "firstBar": d(w.index[0]),
        "weeks": len(w),
    }
    # month to date: vs previous month-end close
    if m is not None and len(m) >= 2:
        out["retMtd"] = pct(close, float(m["Close"].iloc[-2]))
    else:
        out["retMtd"] = None
    # 1y weekly close series for sparklines (52 points)
    out["spark"] = [fnum(x) for x in c.iloc[-52:].tolist()]
    return out


def crashes_for(w, m):
    wr = w["Close"].pct_change().dropna()
    mr = m["Close"].pct_change().dropna() if m is not None and len(m) else pd.Series(dtype=float)
    res = {"firstBar": d(w.index[0])}
    for lbl, s, ths in (("w", wr, (0.15, 0.20, 0.25)), ("m", mr, (0.20, 0.25, 0.30))):
        for th in ths:
            hit = s[s <= -th]
            key = f"{lbl}{int(th * 100)}"
            res[key] = {
                "count": int(len(hit)),
                "recent": {"date": d(hit.index[-1]), "pct": fnum(hit.iloc[-1], 4)} if len(hit) else None,
                "worst": {"date": d(hit.idxmin()), "pct": fnum(hit.min(), 4)} if len(hit) else None,
            }
    res["weekEvents"] = [{"date": d(i), "pct": fnum(v, 4)} for i, v in wr[wr <= -0.15].items()]
    res["monthEvents"] = [{"date": d(i), "pct": fnum(v, 4)} for i, v in mr[mr <= -0.20].items()]
    return res


def episodes(close, min_depth=0.10):
    """Peak-to-trough drops of min_depth+ on a close series."""
    out = []
    peak_v, peak_i = close.iloc[0], close.index[0]
    trough_v, trough_i = peak_v, peak_i
    in_dd = False
    for i, v in close.items():
        if v >= peak_v:
            if in_dd and trough_v / peak_v - 1 <= -min_depth:
                out.append(_ep(close, peak_i, trough_i, trough_v / peak_v - 1, i))
            peak_v, peak_i, trough_v, trough_i, in_dd = v, i, v, i, False
        else:
            in_dd = True
            if v < trough_v:
                trough_v, trough_i = v, i
    if in_dd and trough_v / peak_v - 1 <= -min_depth:
        out.append(_ep(close, peak_i, trough_i, trough_v / peak_v - 1, None))
    return out


def _ep(close, p, t, depth, rec):
    idx = close.index
    return {
        "peak": d(p), "trough": d(t), "recovered": d(rec) if rec is not None else None,
        "depth": fnum(depth, 4),
        "weeksDown": int(idx.get_loc(t) - idx.get_loc(p)),
        "weeksToRecover": int(idx.get_loc(rec) - idx.get_loc(t)) if rec is not None else None,
        "ongoing": rec is None,
    }


def levels_for(w):
    c = w["Close"]
    close = float(c.iloc[-1])
    look = w.iloc[-260:]  # ~5 years of pivots
    lows, highs = look["Low"].values, look["High"].values
    cands = []
    n = 4
    for i in range(n, len(look) - n):
        if lows[i] == min(lows[i - n:i + n + 1]):
            cands.append((float(lows[i]), "Swing low", d(look.index[i])))
        if highs[i] == max(highs[i - n:i + n + 1]):
            cands.append((float(highs[i]), "Swing high", d(look.index[i])))
    for p in (50, 100, 200):
        if len(c) >= p:
            cands.append((float(c.rolling(p).mean().iloc[-1]), f"{p}-wk MA", None))
    last52 = w.iloc[-52:]
    cands.append((float(last52["Low"].min()), "52-wk low", d(last52["Low"].idxmin())))
    ath = float(w["High"].max())
    cands.append((ath, "All-time high", d(w["High"].idxmax())))

    # Last big up-leg: highest high in last 2y, lowest low in the 2y before it
    leg = None
    recent = w.iloc[-104:]
    if len(recent) > 10:
        hi_i = recent["High"].idxmax()
        pos = w.index.get_loc(hi_i)
        before = w.iloc[max(0, pos - 104):pos + 1]
        lo_i = before["Low"].idxmin()
        hi, lo = float(w.loc[hi_i, "High"]), float(w.loc[lo_i, "Low"])
        if hi > lo * 1.2:
            leg = {"low": fnum(lo), "lowDate": d(lo_i), "high": fnum(hi), "highDate": d(hi_i)}
            for r in (0.5, 0.618, 0.786):
                cands.append((hi - r * (hi - lo), f"Fib {r * 100:.1f}%".replace(".0%", "%"), None))

    # dedupe: keep first label per ~1% bucket, preferring MAs/fibs/52wk over generic swings
    prio = lambda lbl: 0 if ("MA" in lbl or "Fib" in lbl or "52" in lbl or "All-time" in lbl) else 1
    cands.sort(key=lambda x: (prio(x[1]), abs(x[0] - close)))
    kept = []
    for v, lbl, dt in cands:
        if v <= 0:
            continue
        if any(abs(v / k[0] - 1) < 0.012 for k in kept):
            continue
        kept.append((v, lbl, dt))
    below = sorted([k for k in kept if k[0] < close and "high" not in k[1].lower()],
                   key=lambda x: -x[0])[:4]
    above = sorted([k for k in kept if k[0] > close and "low" not in k[1].lower()],
                   key=lambda x: x[0])[:2]
    fmt = lambda k, side: {"price": fnum(k[0]), "label": k[1], "date": k[2], "side": side,
                           "dist": pct(k[0], close)}
    return {
        "close": fnum(close),
        "support": [fmt(k, "support") for k in below],
        "resistance": [fmt(k, "resistance") for k in above],
        "leg": leg,
        "series": [[d(i), fnum(v)] for i, v in c.iloc[-78:].items()],  # 18 months
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    RAW.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # FX: local currency per 1 USD
    fx = {"USD": 1.0}
    for cur, sym in FX_TICKERS.items():
        h = fetch(sym, "1d", start="2026-01-01")
        if len(h):
            fx[cur] = float(h["Close"].iloc[-1])
        else:
            print(f"  ! FX {cur} unavailable")

    overview, crashes, levels, valuation = [], {}, {}, []
    bars = {}
    for gkey, gname, _sorted, items in GROUPS:
        for sym, tick, name, perp in items:
            print(f"- {sym}")
            w = fetch(sym, "1wk")
            m = fetch(sym, "1mo")
            if (w is None or len(w) < 2) and sym in FALLBACK:
                for alt in FALLBACK[sym]:
                    w2 = fetch(alt, "1wk")
                    if len(w2) > len(w):
                        print(f"  using fallback {alt}")
                        w, m = w2, fetch(alt, "1mo")
            if w is None or len(w) < 1:
                print(f"  !! {sym} did not resolve - skipped")
                note_missing(tick, "all price data")
                overview.append({"symbol": sym, "ticker": tick, "name": name, "group": gkey,
                                 "perp": perp, "missing": True})
                continue
            bars[sym] = w
            info = fetch_info(sym) if gkey in COMPANY_GROUPS or gkey == "crypto" else {}
            cur = info.get("currency") or ("USD" if gkey in ("crypto", "metals") else None)
            if cur is None:
                cur = {"^KS11": "KRW", "^N225": "JPY", "^NSEI": "INR", "000300.SS": "CNY",
                       "^TWII": "TWD"}.get(sym, "USD")
            if cur in ("GBp", "ZAc"):
                cur = cur.upper()
            o = overview_for(w, m)
            if o["weeks"] < 26:
                note_missing(tick, f"price history (only {o['weeks']} weekly bar(s) since {o['firstBar']})")
            o.update({"symbol": sym, "ticker": tick, "name": name, "group": gkey,
                      "perp": perp, "currency": cur})
            rate = fx.get(cur)
            mcap = info.get("marketCap")
            o["marketCapUSD"] = fnum(mcap / rate, 0) if (mcap and rate) else None
            o["pe"] = fnum(info.get("trailingPE"), 2)
            o["fwdPe"] = fnum(info.get("forwardPE"), 2)
            if gkey in COMPANY_GROUPS or gkey == "crypto":
                if o["marketCapUSD"] is None:
                    note_missing(tick, "market cap" + ("" if rate else f" (no FX for {cur})"))
            overview.append(o)
            crashes[sym] = crashes_for(w, m)
            crashes[sym].update({"ticker": tick, "name": name, "group": gkey})
            lv = levels_for(w)
            lv.update({"ticker": tick, "name": name, "group": gkey, "currency": cur})
            levels[sym] = lv
            if gkey in COMPANY_GROUPS:
                v = {
                    "symbol": sym, "ticker": tick, "name": name, "group": gkey,
                    "currency": cur, "marketCapUSD": o["marketCapUSD"],
                    "pe": o["pe"], "fwdPe": o["fwdPe"],
                    "pb": fnum(info.get("priceToBook"), 2),
                    "revGrowth": fnum(info.get("revenueGrowth"), 4),
                    "epsGrowth": fnum(info.get("earningsGrowth"), 4),
                    "pctFromAth": o["pctFromAth"], "close": o["close"],
                    "earningsDates": info.get("earningsDates") or [],
                }
                for f, lbl in (("pe", "trailing P/E"), ("fwdPe", "forward P/E"), ("pb", "P/B"),
                               ("revGrowth", "revenue growth"), ("epsGrowth", "earnings growth")):
                    if v[f] is None:
                        note_missing(tick, lbl)
                if not v["earningsDates"]:
                    note_missing(tick, "earnings date")
                valuation.append(v)
            if not OFFLINE:
                time.sleep(0.3)

    # sort company + crypto groups by market cap (desc), keep fixed order otherwise
    order = []
    for gkey, gname, sort_mc, items in GROUPS:
        rows = [o for o in overview if o["group"] == gkey]
        if sort_mc:
            rows.sort(key=lambda o: -(o.get("marketCapUSD") or 0))
        order.extend(rows)
    groups_meta = []
    for gkey, gname, sort_mc, items in GROUPS:
        rows = [o for o in order if o["group"] == gkey]
        caps = [o.get("marketCapUSD") for o in rows if o.get("marketCapUSD")]
        groups_meta.append({"key": gkey, "name": gname,
                            "marketCapUSD": sum(caps) if caps and gkey not in ("index", "metals") else None})

    write("overview.json", {"generated": now, "fx": fx, "groups": groups_meta, "assets": order})
    write("crashes.json", {"generated": now, "since": START[:4], "assets": crashes})
    write("levels.json", {"generated": now, "assets": levels})
    write("valuation.json", {"generated": now, "assets": valuation})

    # ---------------- underwater ----------------
    uw = []
    for sym, name in UNDERWATER:
        w = bars.get(sym)
        if w is None:
            continue
        c = w["Close"][w.index >= UW_START]
        dd = c / c.cummax() - 1
        eps = episodes(c, 0.10)
        peak12 = float(w["Close"].iloc[-52:].max())
        cur_dd12 = pct(float(c.iloc[-1]), peak12)
        depths = sorted([e["depth"] for e in eps])
        uw.append({
            "symbol": sym, "name": name,
            "close": fnum(c.iloc[-1]),
            "peak12m": fnum(peak12), "peak12mDate": d(w["Close"].iloc[-52:].idxmax()),
            "ddFrom12mPeak": cur_dd12,
            "ddFromRunningPeak": fnum(dd.iloc[-1], 4),
            "series": [[d(i), fnum(v), fnum(x, 4)] for i, v, x in zip(c.index, c.values, dd.values)],
            "episodes": eps,
            "medianDepth": fnum(depths[len(depths) // 2], 4) if depths else None,
            "count10": len(eps),
            "count20": len([e for e in eps if e["depth"] <= -0.2]),
            "count30": len([e for e in eps if e["depth"] <= -0.3]),
        })
    write("underwater.json", {"generated": now, "since": UW_START, "assets": uw,
                              "insights": insights(uw)})

    # ---------------- who's winning ----------------
    write("leaders.json", leaders(now, bars))

    write("meta.json", {"generated": now, "missing": missing})
    print("\nEmpty tickers / fields:")
    for t, fs in missing.items():
        print(f"  {t}: {', '.join(fs)}")


def insights(uw):
    by = {u["symbol"]: u for u in uw}
    out = []

    def pctf(x):
        return f"{abs(x) * 100:.0f}%"

    for sym in ("NVDA", "^NDX", "BTC-USD"):
        u = by.get(sym)
        if not u or not u["episodes"]:
            continue
        cur = u["ddFromRunningPeak"]
        past = [e for e in u["episodes"] if not e["ongoing"]]
        deeper = len([e for e in past if e["depth"] < cur])
        rec = [e["weeksToRecover"] for e in past if e["weeksToRecover"] is not None]
        med_rec = sorted(rec)[len(rec) // 2] if rec else None
        txt = (f"{u['name']} is {pctf(cur)} below its peak. {deeper} of {len(past)} completed "
               f"10%+ corrections since 2011 went deeper than this.")
        if med_rec:
            txt += f" The typical one took {med_rec} weeks to recover from the trough."
        out.append({"title": f"{u['name']}: {pctf(cur)} down", "text": txt, "symbol": sym})
    g, s = by.get("GC=F"), by.get("^GSPC")
    if g and s:
        out.append({
            "title": "Gold versus stocks",
            "text": (f"Gold is {pctf(g['ddFrom12mPeak'])} below its 12-month high while the S&P 500 "
                     f"is {pctf(s['ddFrom12mPeak'])} below its own. "
                     + ("Gold is holding up better: the hedge is working."
                        if g["ddFrom12mPeak"] > s["ddFrom12mPeak"]
                        else "Gold is falling at least as hard: this is broad deleveraging, not a flight to safety.")),
            "symbol": "GC=F"})
    if s:
        out.append({
            "title": "How often the S&P falls this far",
            "text": (f"Since late 2011 the S&P 500 has had {s['count10']} weekly-close corrections of 10% or more, "
                     f"{s['count20']} of 20%+. It is now {pctf(s['ddFromRunningPeak'])} below its peak."),
            "symbol": "^GSPC"})
    sv = by.get("SI=F")
    if sv:
        out.append({
            "title": "Silver amplifies gold",
            "text": (f"Silver's median 10%+ correction since 2011 was {pctf(sv['medianDepth'] or 0)} deep, "
                     f"against {pctf(g['medianDepth'] or 0) if g else 'n/a'} for gold. "
                     f"It is now {pctf(sv['ddFrom12mPeak'])} off its 12-month high."),
            "symbol": "SI=F"})
    return out[:6]


def leaders(now, bars):
    spx = bars.get("^GSPC")
    spx6 = pct(float(spx["Close"].iloc[-1]), close_n_back(spx["Close"], 26)) if spx is not None else None

    def rel(sym, start="2024-01-01"):
        w = bars.get(sym)
        if w is None:
            w = fetch(sym, "1wk", start=start)
        if w is None or len(w) < 27:
            note_missing(sym, "6-month history")
            return None
        c = w["Close"]
        r6 = pct(float(c.iloc[-1]), close_n_back(c, 26))
        return {"ret6m": r6, "rel6m": fnum(r6 - spx6, 5) if (r6 is not None and spx6 is not None) else None,
                "ret1m": pct(float(c.iloc[-1]), close_n_back(c, 4)),
                "pctFromHigh": pct(float(c.iloc[-1]), float(w["High"].max())),
                "close": fnum(c.iloc[-1])}

    etfs = []
    for sym, name in ETFS:
        r = rel(sym)
        if r:
            etfs.append({"symbol": sym, "name": name, **r})
        if not OFFLINE:
            time.sleep(0.2)
    etfs.sort(key=lambda x: -(x["rel6m"] if x["rel6m"] is not None else -9))
    themes = []
    for tname, syms in THEMES:
        rows = []
        for sym in syms:
            r = rel(sym)
            if r:
                rows.append({"symbol": sym, **r})
            if not OFFLINE:
                time.sleep(0.2)
        rows.sort(key=lambda x: -(x["rel6m"] if x["rel6m"] is not None else -9))
        vals = [r["rel6m"] for r in rows if r["rel6m"] is not None]
        themes.append({"name": tname, "avgRel6m": fnum(sum(vals) / len(vals), 5) if vals else None,
                       "stocks": rows})
    themes.sort(key=lambda t: -(t["avgRel6m"] if t["avgRel6m"] is not None else -9))
    return {"generated": now, "spx6m": spx6, "etfs": etfs, "themes": themes}


def write(name, obj):
    (DATA / name).write_text(json.dumps(obj, separators=(",", ":"), default=str))
    print(f"wrote data/{name}")


if __name__ == "__main__":
    main()
