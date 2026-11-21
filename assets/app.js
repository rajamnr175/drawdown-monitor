/* Drawdown & Support Monitor — front end. Plain JS, no dependencies. */
(function () {
  "use strict";

  const GC = { mega: "#00A389", chips: "#635BFF", memory: "#8B5CF6", listings: "#E0539A",
    crypto: "#FF7A45", index: "#1F9BDB", metals: "#D99A00" };
  const UP = "#0B8A5F", DOWN = "#D92D45", INK = "#111439", MUTED = "#4A4E6E";
  const CUR = { USD: "$", KRW: "₩", JPY: "¥", TWD: "NT$", HKD: "HK$", CNY: "¥", INR: "₹" };
  const HL = "https://api.hyperliquid.xyz/info";

  const S = { live: {}, liveAt: null, view: "tiles", uwSel: "NVDA", lvFilter: "all", sort: null };
  let D = {};

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  };
  const NS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isNum = (x) => typeof x === "number" && isFinite(x);
  const pct = (x, dp = 1, sign = true) => !isNum(x) ? "—" : (sign && x > 0 ? "+" : "") + (x * 100).toFixed(dp) + "%";
  const pctAbs = (x, dp = 0) => !isNum(x) ? "—" : (x * 100).toFixed(dp).replace("-", "−") + "%";
  const cls = (x) => !isNum(x) ? "" : x > 0 ? "up" : x < 0 ? "down" : "";
  function num(x) {
    if (!isNum(x)) return "—";
    const a = Math.abs(x);
    const dp = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
    return x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function money(x, cur, group) {
    if (!isNum(x)) return "—";
    if (group === "index") return num(x);
    return (CUR[cur] || (cur ? cur + " " : "")) + num(x);
  }
  function moneyShort(x, cur, group) {
    if (!isNum(x) || Math.abs(x) < 100000) return money(x, cur, group);
    const p = group === "index" ? "" : (CUR[cur] || "");
    return Math.abs(x) >= 1e6 ? p + (x / 1e6).toFixed(2) + "M" : p + (x / 1e3).toFixed(1) + "k";
  }
  function cap(x) {
    if (!isNum(x)) return "—";
    if (x >= 1e12) return "$" + (x / 1e12).toFixed(2) + "T";
    if (x >= 1e9) return "$" + (x / 1e9).toFixed(x >= 1e11 ? 0 : 1) + "B";
    return "$" + (x / 1e6).toFixed(0) + "M";
  }
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dt(s, withDay = true) {
    if (!s) return "—";
    const [y, m, d] = s.split("-").map(Number);
    return withDay ? `${d} ${MON[m - 1]} ${y}` : `${MON[m - 1]} ${y}`;
  }
  const t = (s) => new Date(s + "T00:00:00Z").getTime();
  function debounce(fn, ms) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }
  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const W = (el) => Math.max(260, Math.floor(el.getBoundingClientRect().width));

  // ---------------------------------------------------------------- tooltip
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(), pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const row = (k, v) => `<div class="r"><span>${k}</span><span>${v}</span></div>`;
  function bindTip(el, fn) {
    el.addEventListener("mousemove", (e) => showTip(fn(e), e));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("touchstart", (e) => { const tt = e.touches[0]; showTip(fn(tt), tt); }, { passive: true });
  }

  // ---------------------------------------------------------------- load
  async function load() {
    const names = ["overview", "underwater", "crashes", "levels", "valuation", "leaders", "meta"];
    const res = await Promise.all(names.map((n) => fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => r.json())));
    names.forEach((n, i) => (D[n] = res[i]));
    const g = new Date(D.overview.generated);
    $("#dataStamp").textContent = `Weekly data as of ${g.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
    renderAll();
    pollLive();
    setInterval(pollLive, 60000);
    addEventListener("resize", debounce(renderCharts, 150));
  }

  function renderAll() {
    renderTiles(); renderOverviewTable(); renderDDBars(); renderInsights();
    renderHeat(); renderCrashPicker(); renderLevelFilters();
    renderThemes(); renderValCards(); renderValSummary(); renderValTable(); renderMissing();
    renderCharts();
  }
  function renderCharts() {
    renderUW(); renderEpisodes(); renderTimeline(); renderLevels(); renderETF(); renderScatter();
  }

  // ---------------------------------------------------------------- live prices
  async function hl(body) {
    const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const [meta, ctxs] = await r.json();
    const out = {};
    meta.universe.forEach((u, i) => {
      const c = ctxs[i]; if (!c) return;
      const px = parseFloat(c.markPx), prev = parseFloat(c.prevDayPx);
      if (isFinite(px)) out[u.name] = { px, prev, chg: isFinite(prev) && prev ? px / prev - 1 : null };
    });
    return out;
  }
  async function pollLive() {
    const btn = $("#refreshBtn"); btn.disabled = true;
    try {
      const [a, b] = await Promise.all([hl({ type: "metaAndAssetCtxs" }), hl({ type: "metaAndAssetCtxs", dex: "xyz" })]);
      S.live = Object.assign({}, a, b);
      S.liveAt = new Date();
      $("#liveStamp").textContent = "Updated " + S.liveAt.toLocaleTimeString("en-GB", { hour12: false });
      renderStrip(); renderTiles(); renderOverviewTable();
    } catch (e) {
      $("#liveStamp").textContent = "Live prices unavailable (" + e.message + "). Showing last weekly close.";
    } finally { btn.disabled = false; }
  }
  $("#refreshBtn").addEventListener("click", pollLive);

  function liveFor(a) {
    const L = a.perp && S.live[a.perp];
    if (!L) return null;
    const usd = a.currency === "USD" && a.group !== "index" || a.symbol === "^GSPC" || a.symbol === "^NDX";
    return { ...L, usd, dd: usd && isNum(a.ath) ? Math.min(0, L.px / a.ath - 1) : null };
  }
  const perpLabel = (p) => (p || "").replace("xyz:", "");

  function renderStrip() {
    const el = $("#liveStrip"); el.innerHTML = "";
    D.overview.assets.forEach((a) => {
      const L = a.perp && S.live[a.perp]; if (!L) return;
      el.appendChild(h("div", { class: "chip" }, `<b>${esc(a.ticker)}</b><span>$${num(L.px)}</span> <span class="${cls(L.chg)}">${pct(L.chg)}</span>`));
    });
  }

  // ---------------------------------------------------------------- section 1
  document.querySelectorAll(".seg-btn[data-view]").forEach((b) => b.addEventListener("click", () => {
    S.view = b.dataset.view;
    document.querySelectorAll(".seg-btn[data-view]").forEach((x) => x.classList.toggle("on", x === b));
    $("#tiles").hidden = S.view !== "tiles"; $("#overviewTable").hidden = S.view !== "table";
  }));

  function heroDD(a) {
    const L = liveFor(a);
    if (L && isNum(L.dd)) return { v: L.dd, src: "live" };
    return { v: a.pctFromAth, src: "close" };
  }

  function tileHTML(a) {
    const c = GC[a.group];
    if (a.missing) return `<div class="tile" style="--gc:${c}"><div class="t-tick">${esc(a.ticker)}</div><div class="t-name">${esc(a.name)}</div><p class="t-note">No price data from Yahoo for ${esc(a.symbol)}.</p></div>`;
    const dd = heroDD(a), L = liveFor(a);
    const lo = a.low52, hi = a.ath, span = hi - lo;
    const pos = (v) => span > 0 ? Math.max(0, Math.min(100, ((v - lo) / span) * 100)) : 100;
    const cur = L && L.usd ? L.px : a.close;
    const pills = [];
    if (isNum(a.marketCapUSD)) pills.push(`<span class="pill"><span class="k">Cap</span>${cap(a.marketCapUSD)}</span>`);
    if (isNum(a.pe)) pills.push(`<span class="pill"><span class="k">P/E</span>${a.pe.toFixed(1)}</span>`);
    else if (isNum(a.fwdPe)) pills.push(`<span class="pill"><span class="k">Fwd P/E</span>${a.fwdPe.toFixed(1)}</span>`);
    const live = L
      ? `<div class="px">$${num(L.px)}</div><div class="${cls(L.chg)}">${pct(L.chg)} 24h</div><div class="src">${esc(perpLabel(a.perp))} perp${L.usd ? "" : " · USD"}</div>`
      : `<div class="src">No live perp</div>`;
    const maOk = isNum(a.ma200w);
    const maPos = maOk ? pos(a.ma200w) : null;
    const maOut = maOk && (a.ma200w < lo || a.ma200w > hi);
    const short = a.weeks < 26 ? `<p class="t-note">History only since ${dt(a.firstBar)} (${a.weeks} week${a.weeks === 1 ? "" : "s"}).</p>` : "";
    return `<div class="tile" style="--gc:${c}">
      <div class="t-top"><div><div class="t-tick">${esc(a.ticker)}</div><div class="t-name">${esc(a.name)}</div></div><div class="t-pills">${pills.join("")}</div></div>
      <div class="t-mid"><div class="t-big">${pctAbs(dd.v)}<small>from high · ${dd.src === "live" ? "live" : "weekly close"}</small></div><div class="t-live">${live}</div></div>
      <div>
        <div class="rng" data-tip="rng"><div class="fill" style="width:${pos(cur)}%"></div>${maOk && !maOut ? `<div class="ma" style="left:${maPos}%"></div>` : ""}<div class="now" style="left:${pos(cur)}%"></div></div>
        <div class="rng-lab"><span>52-wk low</span><span>${maOk ? (maOut ? `200-wk MA ${a.ma200w < lo ? "below" : "above"} range` : "┆ 200-wk MA") : "200-wk MA n/a"}</span><span>ATH</span></div>
      </div>
      <div class="t-boxes">
        <div class="t-box"><div class="k">52-wk low</div><div class="v">${money(a.low52, a.currency, a.group)}</div><div class="dt">wk of ${dt(a.low52Date)}</div></div>
        <div class="t-box"><div class="k">All-time high</div><div class="v">${money(a.ath, a.currency, a.group)}</div><div class="dt">wk of ${dt(a.athDate)}</div></div>
      </div>
      <div class="t-foot">
        <span class="pill"><span class="k">Close</span>${money(a.close, a.currency, a.group)}</span>
        <span class="pill"><span class="k">Wk</span><span class="${cls(a.retWeek)}">${pct(a.retWeek)}</span></span>
        <span class="pill"><span class="k">${MON[new Date(a.asOf).getUTCMonth()]}</span><span class="${cls(a.retMtd)}">${pct(a.retMtd)}</span></span>
        <span class="pill"><span class="k">1 yr</span><span class="${cls(a.ret1y)}">${pct(a.ret1y)}</span></span>
      </div>${short}
    </div>`;
  }

  function renderTiles() {
    const root = $("#tiles"); root.innerHTML = "";
    D.overview.groups.forEach((g) => {
      const rows = D.overview.assets.filter((a) => a.group === g.key);
      const sec = h("div", { class: "group" });
      sec.innerHTML = `<div class="group-head"><h3><span class="dot" style="background:${GC[g.key]}"></span>${esc(g.name)}</h3><span class="gv">${isNum(g.marketCapUSD) ? "Combined market value " + cap(g.marketCapUSD) : rows.length + " " + (g.key === "index" ? "indices" : "contracts")}</span></div>`;
      const grid = h("div", { class: "tiles" });
      grid.innerHTML = rows.map(tileHTML).join("");
      sec.appendChild(grid); root.appendChild(sec);
      grid.querySelectorAll(".rng").forEach((el, i) => {
        const a = rows.filter((r) => !r.missing)[i]; if (!a) return;
        bindTip(el, () => `<b>${esc(a.ticker)}</b>${row("52-wk low", money(a.low52, a.currency, a.group))}${row("Close", money(a.close, a.currency, a.group))}${row("200-wk MA", money(a.ma200w, a.currency, a.group))}${row("50-wk MA", money(a.ma50w, a.currency, a.group))}${row("All-time high", money(a.ath, a.currency, a.group))}`);
      });
    });
  }

  const OV_COLS = [
    ["ticker", "Asset", (a) => `<span class="dot" style="background:${GC[a.group]}"></span>${esc(a.ticker)} <span class="muted">${esc(a.name)}</span>`, "l"],
    ["dd", "From high", (a) => pctAbs(heroDD(a).v, 1)],
    ["live", "Live (USD)", (a) => { const L = liveFor(a); return L ? "$" + num(L.px) : "—"; }],
    ["chg", "24h", (a) => { const L = liveFor(a); return L ? `<span class="${cls(L.chg)}">${pct(L.chg)}</span>` : "—"; }],
    ["close", "Close", (a) => money(a.close, a.currency, a.group)],
    ["retWeek", "Week", (a) => `<span class="${cls(a.retWeek)}">${pct(a.retWeek)}</span>`],
    ["retMtd", "MTD", (a) => `<span class="${cls(a.retMtd)}">${pct(a.retMtd)}</span>`],
    ["ret6m", "6 mo", (a) => `<span class="${cls(a.ret6m)}">${pct(a.ret6m)}</span>`],
    ["ret1y", "1 yr", (a) => `<span class="${cls(a.ret1y)}">${pct(a.ret1y)}</span>`],
    ["low52", "52-wk low", (a) => money(a.low52, a.currency, a.group)],
    ["ath", "All-time high", (a) => money(a.ath, a.currency, a.group)],
    ["athDate", "ATH week", (a) => dt(a.athDate)],
    ["ma200w", "200-wk MA", (a) => money(a.ma200w, a.currency, a.group)],
    ["marketCapUSD", "Market cap", (a) => cap(a.marketCapUSD)],
    ["pe", "P/E", (a) => isNum(a.pe) ? a.pe.toFixed(1) : "—"],
  ];
  function sortVal(a, k) {
    if (k === "dd") return heroDD(a).v;
    if (k === "live") { const L = liveFor(a); return L ? L.px : null; }
    if (k === "chg") { const L = liveFor(a); return L ? L.chg : null; }
    return a[k];
  }
  function renderOverviewTable() {
    const el = $("#overviewTable");
    let rows = D.overview.assets.filter((a) => !a.missing);
    if (S.sort) {
      const { k, dir } = S.sort;
      rows = rows.slice().sort((x, y) => {
        const a = sortVal(x, k), b = sortVal(y, k);
        if (a == null) return 1; if (b == null) return -1;
        return (a > b ? 1 : a < b ? -1 : 0) * dir;
      });
    }
    el.innerHTML = `<table><thead><tr>${OV_COLS.map(([k, l, , c]) => `<th data-k="${k}" class="${c || ""}">${l}${S.sort && S.sort.k === k ? (S.sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${rows.map((a) => `<tr>${OV_COLS.map(([, , f, c]) => `<td class="${c || ""}">${f(a)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      S.sort = S.sort && S.sort.k === k ? { k, dir: -S.sort.dir } : { k, dir: k === "ticker" ? 1 : -1 };
      renderOverviewTable();
    }));
  }

  // ---------------------------------------------------------------- section 2
  function renderDDBars() {
    const el = $("#ddBars"); el.innerHTML = "";
    const max = Math.max(...D.underwater.assets.map((u) => -u.ddFrom12mPeak), 0.05);
    D.underwater.assets.forEach((u) => {
      const b = h("button", { type: "button", class: "ddb" + (u.symbol === S.uwSel ? " on" : ""), role: "tab", "aria-selected": u.symbol === S.uwSel });
      b.innerHTML = `<span class="n">${esc(u.name)}</span><span class="v">${pctAbs(u.ddFrom12mPeak)}</span><span class="track"><i style="height:${(-u.ddFrom12mPeak / max) * 100}%"></i></span><span class="s">below 12-mo peak of ${num(u.peak12m)} (${dt(u.peak12mDate, false)})</span>`;
      b.addEventListener("click", () => { S.uwSel = u.symbol; renderDDBars(); renderUW(); renderEpisodes(); });
      bindTip(b, () => `<b>${esc(u.name)}</b>${row("Below 12-mo peak", pctAbs(u.ddFrom12mPeak, 1))}${row("Below all-time peak", pctAbs(u.ddFromRunningPeak, 1))}${row("Last close", num(u.close))}<div class="muted">Click to chart</div>`);
      el.appendChild(b);
    });
  }

  function renderUW() {
    const u = D.underwater.assets.find((x) => x.symbol === S.uwSel); if (!u) return;
    $("#uwTitle").textContent = `${u.name}: % below running peak`;
    $("#uwSub").textContent = `Weekly closes since ${dt(u.series[0][0], false)}. ${u.count10} drops of 10%+, ${u.count20} of 20%+, ${u.count30} of 30%+. Now ${pctAbs(u.ddFromRunningPeak, 1)} below the peak.`;
    const el = $("#uwChart"); el.innerHTML = "";
    const w = W(el), H = Math.round(Math.min(380, Math.max(240, w * 0.5)));
    const m = { l: 48, r: 14, t: 12, b: 28 };
    const pts = u.series, x0 = t(pts[0][0]), x1 = t(pts[pts.length - 1][0]);
    const minDD = Math.min(...pts.map((p) => p[2]));
    const yLo = Math.floor(minDD * 10) / 10;
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
    const Y = (v) => m.t + (v / yLo) * (H - m.t - m.b);
    const s = sv("svg", { viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": `${u.name} underwater chart` }, el);
    niceTicks(yLo, 0, 5).forEach((v) => {
      sv("line", { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? "zero" : "ax" }, s);
      sv("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, s).textContent = v === 0 ? "0%" : Math.round(v * 100) + "%";
    });
    const y0 = new Date(x0).getUTCFullYear(), y1 = new Date(x1).getUTCFullYear();
    const every = w < 500 ? 4 : w < 800 ? 2 : 1;
    for (let y = y0 + 1; y <= y1; y++) {
      if ((y - y0) % every) continue;
      const xx = X(Date.UTC(y, 0, 1));
      sv("line", { x1: xx, x2: xx, y1: H - m.b, y2: H - m.b + 4, class: "ax" }, s);
      sv("text", { x: xx, y: H - 8, "text-anchor": "middle" }, s).textContent = every > 1 || w < 900 ? "’" + String(y).slice(2) : y;
    }
    let d = `M${X(x0)},${Y(0)}`;
    pts.forEach((p) => (d += `L${X(t(p[0])).toFixed(1)},${Y(p[2]).toFixed(1)}`));
    sv("path", { d: d + `L${X(x1)},${Y(0)}Z`, fill: DOWN, opacity: 0.14 }, s);
    let ln = ""; pts.forEach((p, i) => (ln += (i ? "L" : "M") + X(t(p[0])).toFixed(1) + "," + Y(p[2]).toFixed(1)));
    sv("path", { d: ln, fill: "none", stroke: DOWN, "stroke-width": 2, "stroke-linejoin": "round" }, s);
    // label deepest trough
    const deep = pts.reduce((a, p) => (p[2] < a[2] ? p : a), pts[0]);
    const dx = X(t(deep[0])), right = dx < w * 0.62;
    sv("text", { x: right ? dx + 10 : dx - 10, y: Y(deep[2]) + 4, "text-anchor": right ? "start" : "end", style: "font-weight:600;fill:#2B2F55" }, s).textContent = `${pctAbs(deep[2])} · ${dt(deep[0], false)}`;
    const last = pts[pts.length - 1];
    sv("circle", { cx: X(x1), cy: Y(last[2]), r: 4.5, fill: DOWN, stroke: "#fff", "stroke-width": 2 }, s);
    // crosshair
    const cross = sv("line", { y1: m.t, y2: H - m.b, stroke: INK, "stroke-width": 1, opacity: 0 }, s);
    const dot = sv("circle", { r: 4.5, fill: DOWN, stroke: "#fff", "stroke-width": 2, opacity: 0 }, s);
    const hit = sv("rect", { x: m.l, y: 0, width: w - m.l - m.r, height: H, fill: "transparent" }, s);
    const pick = (ev) => {
      const r = s.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * w;
      const tv = x0 + ((px - m.l) / (w - m.l - m.r)) * (x1 - x0);
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t(pts[mid][0]) < tv) lo = mid; else hi = mid; }
      return Math.abs(t(pts[lo][0]) - tv) < Math.abs(t(pts[hi][0]) - tv) ? pts[lo] : pts[hi];
    };
    bindTip(hit, (ev) => {
      const p = pick(ev), xx = X(t(p[0]));
      cross.setAttribute("x1", xx); cross.setAttribute("x2", xx); cross.setAttribute("opacity", 0.35);
      dot.setAttribute("cx", xx); dot.setAttribute("cy", Y(p[2])); dot.setAttribute("opacity", 1);
      return `<b>Week of ${dt(p[0])}</b>${row("Close", num(p[1]))}${row("Below peak", pctAbs(p[2], 1))}`;
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); });
  }

  function renderEpisodes() {
    const u = D.underwater.assets.find((x) => x.symbol === S.uwSel); if (!u) return;
    const el = $("#epList");
    const eps = u.episodes.slice().sort((a, b) => a.depth - b.depth);
    const max = Math.max(...eps.map((e) => -e.depth), 0.1);
    el.innerHTML = eps.map((e) => `<div class="ep${e.ongoing ? " now" : ""}">
      <span class="d">${dt(e.peak, false)} → ${dt(e.trough, false)}${e.ongoing ? '<span class="tag">now</span>' : ""}</span><span class="d">${pctAbs(e.depth)}</span>
      <span class="bar"><i style="width:${(-e.depth / max) * 100}%"></i></span>
      <span class="m">${e.weeksDown} wks down · ${e.ongoing ? "not yet recovered" : e.weeksToRecover + " wks to recover"}</span>
    </div>`).join("") || `<p class="muted">No 10%+ drops.</p>`;
    el.querySelectorAll(".ep").forEach((n, i) => bindTip(n, () => {
      const e = eps[i];
      return `<b>${esc(u.name)}</b>${row("Peak", dt(e.peak))}${row("Trough", dt(e.trough))}${row("Depth", pctAbs(e.depth, 1))}${row("Weeks down", e.weeksDown)}${row("Recovered", e.recovered ? dt(e.recovered) : "not yet")}`;
    }));
  }

  function renderInsights() {
    $("#insights").innerHTML = D.underwater.insights.map((i) => `<div class="ins"><h4>${esc(i.title)}</h4><p>${esc(i.text)}</p></div>`).join("");
  }

  // ---------------------------------------------------------------- section 3
  const HEAT = [["w15", "Wk ≥15%"], ["w20", "Wk ≥20%"], ["w25", "Wk ≥25%"], ["m20", "Mo ≥20%"], ["m25", "Mo ≥25%"], ["m30", "Mo ≥30%"]];
  function renderHeat() {
    const A = D.crashes.assets, order = D.overview.assets.filter((a) => !a.missing && A[a.symbol]);
    const max = {}; HEAT.forEach(([k]) => (max[k] = Math.max(1, ...order.map((a) => A[a.symbol][k].count))));
    let html = `<table class="heat"><thead><tr><th class="ns">Asset</th><th class="ns">Since</th>${HEAT.map(([, l]) => `<th class="ns">${l}</th>`).join("")}</tr></thead><tbody>`;
    let g = null;
    order.forEach((a) => {
      if (a.group !== g) { g = a.group; const gm = D.overview.groups.find((x) => x.key === g); html += `<tr class="grp"><td colspan="8"><span class="dot" style="background:${GC[g]}"></span>${esc(gm.name)}</td></tr>`; }
      const c = A[a.symbol];
      html += `<tr><td>${esc(a.ticker)} <span class="muted">${esc(a.name)}</span></td><td class="muted">${c.firstBar.slice(0, 4)}</td>${HEAT.map(([k]) => {
        const n = c[k].count, al = n ? 0.1 + 0.55 * Math.sqrt(n / max[k]) : 0;
        return `<td class="h" data-s="${esc(a.symbol)}" data-k="${k}" style="background:rgba(217,45,69,${al.toFixed(3)})">${n}</td>`;
      }).join("")}</tr>`;
    });
    $("#heatTable").innerHTML = html + "</tbody></table>";
    $("#heatTable").querySelectorAll("td.h").forEach((td) => bindTip(td, () => {
      const c = A[td.dataset.s], k = td.dataset.k, v = c[k], lbl = HEAT.find((x) => x[0] === k)[1];
      return `<b>${esc(c.ticker)} · ${lbl.replace("Wk", "weekly drop").replace("Mo", "monthly drop")}</b>${row("Count", v.count)}${v.recent ? row("Most recent", `${dt(v.recent.date)} (${pctAbs(v.recent.pct, 1)})`) + row("Worst", `${dt(v.worst.date)} (${pctAbs(v.worst.pct, 1)})`) : ""}`;
    }));
  }
  function renderCrashPicker() {
    const sel = $("#crashPick");
    sel.innerHTML = D.overview.groups.map((g) => `<optgroup label="${esc(g.name)}">${D.overview.assets.filter((a) => a.group === g.key && !a.missing).map((a) => `<option value="${esc(a.symbol)}">${esc(a.ticker)} · ${esc(a.name)}</option>`).join("")}</optgroup>`).join("");
    sel.value = "NVDA";
    sel.addEventListener("change", renderTimeline);
    $("#tlLegend").innerHTML = `<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#635BFF"/></svg>Weekly drop ≥15%</span><span><svg width="12" height="12"><rect x="1" y="1" width="10" height="10" rx="2" fill="#E0539A"/></svg>Monthly drop ≥20%</span>`;
  }
  function renderTimeline() {
    const sym = $("#crashPick").value, c = D.crashes.assets[sym]; if (!c) return;
    const el = $("#timeline"); el.innerHTML = "";
    const w = W(el), H = Math.round(Math.min(320, Math.max(220, w * 0.32)));
    const m = { l: 48, r: 16, t: 14, b: 28 };
    const x0 = Date.UTC(1996, 0, 1), x1 = Date.now();
    const ev = [...c.weekEvents.map((e) => ({ ...e, k: "w" })), ...c.monthEvents.map((e) => ({ ...e, k: "m" }))];
    const lo = Math.min(-0.3, ...ev.map((e) => e.pct)) * 1.05;
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
    const Y = (v) => m.t + ((v + 0.1) / (lo + 0.1)) * (H - m.t - m.b);
    const s = sv("svg", { viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": "Timeline of big drops" }, el);
    niceTicks(lo, -0.1, 6).forEach((v) => {
      sv("line", { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: "ax" }, s);
      sv("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, s).textContent = Math.round(v * 100) + "%";
    });
    const step = w < 520 ? 10 : 5;
    for (let y = 2000; y <= new Date().getUTCFullYear(); y += step) {
      const xx = X(Date.UTC(y, 0, 1));
      sv("line", { x1: xx, x2: xx, y1: m.t, y2: H - m.b, class: "ax", "stroke-dasharray": "2 4" }, s);
      sv("text", { x: xx, y: H - 8, "text-anchor": "middle" }, s).textContent = y;
    }
    if (t(c.firstBar) > x0) {
      const fx = X(t(c.firstBar));
      sv("rect", { x: m.l, y: m.t, width: Math.max(0, fx - m.l), height: H - m.t - m.b, fill: "#F3F3F8" }, s);
      if (fx - m.l > 90) sv("text", { x: (m.l + fx) / 2, y: m.t + 18, "text-anchor": "middle" }, s).textContent = "No data yet";
    }
    ev.sort((a, b) => b.pct - a.pct).forEach((e) => {
      const cx = X(t(e.date)), cy = Y(e.pct);
      const mk = e.k === "w"
        ? sv("circle", { cx, cy, r: 5, fill: "#635BFF", stroke: "#fff", "stroke-width": 2 }, s)
        : sv("rect", { x: cx - 5, y: cy - 5, width: 10, height: 10, rx: 2, fill: "#E0539A", stroke: "#fff", "stroke-width": 2 }, s);
      const hitc = sv("circle", { cx, cy, r: 10, fill: "transparent" }, s);
      bindTip(hitc, () => `<b>${esc(c.ticker)}</b>${row(e.k === "w" ? "Week of" : "Month of", e.k === "w" ? dt(e.date) : dt(e.date, false))}${row("Drop", pctAbs(e.pct, 1))}`);
      void mk;
    });
    if (!ev.length) sv("text", { x: w / 2, y: H / 2, "text-anchor": "middle", style: "font-size:15px" }, s).textContent = "No weekly drops ≥15% or monthly drops ≥20% on record";
  }

  // ---------------------------------------------------------------- section 4
  function renderLevelFilters() {
    const el = $("#levelFilters");
    const opts = [["all", "All"], ...D.overview.groups.map((g) => [g.key, g.name])];
    el.innerHTML = opts.map(([k, l]) => `<button type="button" class="seg-btn${k === S.lvFilter ? " on" : ""}" data-k="${k}">${k !== "all" ? `<span class="dot" style="background:${GC[k]};margin-right:6px"></span>` : ""}${esc(l)}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { S.lvFilter = b.dataset.k; renderLevelFilters(); renderLevels(); }));
  }
  function renderLevels() {
    const grid = $("#levelGrid"); grid.innerHTML = "";
    const assets = D.overview.assets.filter((a) => !a.missing && D.levels.assets[a.symbol] && (S.lvFilter === "all" || a.group === S.lvFilter));
    assets.forEach((a) => {
      const L = D.levels.assets[a.symbol];
      const card = h("div", { class: "lv", style: `--gc:${GC[a.group]}` });
      card.innerHTML = `<div class="lv-head"><b>${esc(a.ticker)} <span>${esc(a.name)}</span></b><span>Close ${money(L.close, L.currency, a.group)}</span></div>`;
      const ch = h("div", { class: "chart" }); card.appendChild(ch); grid.appendChild(card);
      drawLevels(ch, a, L);
    });
  }
  function drawLevels(el, a, L) {
    const w = W(el), H = 270, gut = Math.min(160, Math.max(146, w * 0.4));
    const m = { l: 6, r: gut, t: 10, b: 22 };
    const ser = L.series, lv = [...L.resistance, ...L.support];
    const vals = [...ser.map((p) => p[1]), ...lv.map((l) => l.price)];
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.06 || hi * 0.05; lo -= pad; hi += pad;
    const x0 = 0, x1 = Math.max(1, ser.length - 1);
    const X = (i) => m.l + ((i - x0) / (x1 - x0)) * (w - m.l - m.r - 8);
    const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const s = sv("svg", { viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": `${a.ticker} support and resistance` }, el);
    // level lines
    lv.forEach((l) => {
      const col = l.side === "support" ? UP : DOWN;
      sv("line", { x1: m.l, x2: w - m.r + 2, y1: Y(l.price), y2: Y(l.price), stroke: col, "stroke-width": 1.25, "stroke-dasharray": "4 3", opacity: 0.75 }, s);
    });
    // price line
    let d = ""; ser.forEach((p, i) => (d += (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p[1]).toFixed(1)));
    sv("path", { d, fill: "none", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" }, s);
    const lx = X(x1), ly = Y(ser[ser.length - 1][1]);
    sv("circle", { cx: lx, cy: ly, r: 4.5, fill: INK, stroke: "#fff", "stroke-width": 2 }, s);
    // x labels: first + last month
    sv("text", { x: m.l, y: H - 6 }, s).textContent = dt(ser[0][0], false);
    sv("text", { x: X(x1), y: H - 6, "text-anchor": "end" }, s).textContent = dt(ser[ser.length - 1][0], false);
    // labels with collision avoidance
    const labs = lv.map((l) => ({ l, y: Y(l.price) })).sort((p, q) => p.y - q.y);
    const gap = 25, top = m.t + 8, bot = H - m.b;
    for (let i = 0; i < labs.length; i++) { labs[i].ly = Math.max(labs[i].y, i ? labs[i - 1].ly + gap : top); }
    if (labs.length && labs[labs.length - 1].ly > bot) {
      labs[labs.length - 1].ly = bot;
      for (let i = labs.length - 2; i >= 0; i--) labs[i].ly = Math.min(labs[i].ly, labs[i + 1].ly - gap);
    }
    const gx = w - m.r + 10;
    labs.forEach(({ l, y, ly }) => {
      const col = l.side === "support" ? UP : DOWN;
      sv("path", { d: `M${w - m.r + 2},${y}L${gx - 3},${ly}`, stroke: col, "stroke-width": 1, fill: "none", opacity: 0.6 }, s);
      const tx = sv("text", { x: gx, y: ly - 1 }, s);
      const t1 = sv("tspan", { x: gx, style: "font-weight:600;fill:#2B2F55" }, tx); t1.textContent = moneyShort(l.price, L.currency, a.group) + " ";
      const t2 = sv("tspan", { style: `font-weight:600;fill:${col}` }, tx); t2.textContent = pct(l.dist, 0);
      const t3 = sv("tspan", { x: gx, dy: 13, style: "font-size:11.5px" }, tx); t3.textContent = l.label;
      const hit = sv("rect", { x: m.l, y: y - 6, width: w - m.l, height: 12, fill: "transparent" }, s);
      const hitL = sv("rect", { x: gx - 4, y: ly - 13, width: m.r - 8, height: 28, fill: "transparent" }, s);
      const f = () => `<b>${esc(a.ticker)} · ${esc(l.label)}</b>${row(l.side === "support" ? "Support" : "Resistance", money(l.price, L.currency, a.group))}${row("From close", pct(l.dist, 1))}${l.date ? row("Set", "wk of " + dt(l.date)) : ""}`;
      bindTip(hit, f); bindTip(hitL, f);
    });
    // crosshair on price
    const cross = sv("circle", { r: 4, fill: INK, stroke: "#fff", "stroke-width": 2, opacity: 0 }, s);
    const ph = sv("rect", { x: m.l, y: m.t, width: w - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, s);
    s.insertBefore(ph, s.firstChild.nextSibling);
    bindTip(ph, (ev) => {
      const r = s.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * w;
      const i = Math.max(0, Math.min(x1, Math.round(((px - m.l) / (w - m.l - m.r - 8)) * x1)));
      cross.setAttribute("cx", X(i)); cross.setAttribute("cy", Y(ser[i][1])); cross.setAttribute("opacity", 1);
      return `<b>${esc(a.ticker)}</b>${row("Week of", dt(ser[i][0]))}${row("Close", money(ser[i][1], L.currency, a.group))}`;
    });
    ph.addEventListener("mouseleave", () => cross.setAttribute("opacity", 0));
  }

  // ---------------------------------------------------------------- section 5
  function renderETF() {
    const L = D.leaders; const el = $("#etfChart"); el.innerHTML = "";
    $("#winLede").textContent = `Sector and theme ETFs ranked by their 6-month return minus the S&P 500's (the S&P 500 returned ${pct(L.spx6m)} over the same 26 weeks). Next to them, the S&P 500 stocks leading within each theme.`;
    const rows = L.etfs.filter((e) => isNum(e.rel6m));
    const w = W(el), rh = 26, m = { l: w < 480 ? 118 : 190, r: 56, t: 6, b: 24 };
    const H = m.t + m.b + rows.length * rh;
    const ext0 = Math.max(...rows.map((e) => Math.abs(e.rel6m)), 0.05), ext = ext0 * (w < 480 ? 1.5 : 1.16);
    const X = (v) => m.l + ((v + ext) / (2 * ext)) * (w - m.l - m.r);
    const s = sv("svg", { viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": "ETF relative performance" }, el);
    niceTicks(-ext0, ext0, w < 480 ? 3 : 6).forEach((v) => {
      sv("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: v === 0 ? "zero" : "ax" }, s);
      sv("text", { x: X(v), y: H - 6, "text-anchor": "middle" }, s).textContent = (v > 0 ? "+" : "") + Math.round(v * 100);
    });
    rows.forEach((e, i) => {
      const y = m.t + i * rh, cy = y + rh / 2, v = e.rel6m, col = v >= 0 ? UP : DOWN;
      const xa = X(Math.min(0, v)), xb = X(Math.max(0, v));
      sv("rect", { x: xa, y: cy - 7, width: Math.max(2, xb - xa), height: 14, rx: 4, fill: col, opacity: 0.85 }, s);
      const lt = sv("text", { x: m.l - 10, y: cy + 4, "text-anchor": "end" }, s);
      const a1 = sv("tspan", { style: "font-weight:600;fill:#111439" }, lt); a1.textContent = e.symbol;
      if (w >= 480) { const a2 = sv("tspan", {}, lt); a2.textContent = " " + e.name; }
      const vt = (v > 0 ? "+" : "") + (v * 100).toFixed(1), tw = vt.length * 7;
      const inside = (v >= 0 ? xb + 6 + tw > w - 2 : xa - 6 - tw < m.l + 6) && xb - xa > tw + 8;
      const vx = inside ? (v >= 0 ? xb - 6 : xa + 6) : (v >= 0 ? xb + 6 : xa - 6);
      const anchor = (v >= 0) !== inside ? "start" : "end";
      sv("text", { x: vx, y: cy + 4, "text-anchor": anchor, style: `font-weight:600;fill:${inside ? "#fff" : "#2B2F55"}` }, s).textContent = vt;
      const hit = sv("rect", { x: 0, y, width: w, height: rh, fill: "transparent" }, s);
      bindTip(hit, () => `<b>${esc(e.symbol)} · ${esc(e.name)}</b>${row("6-mo return", pct(e.ret6m))}${row("vs S&P 500", (v > 0 ? "+" : "") + (v * 100).toFixed(1) + " pts")}${row("1-mo return", pct(e.ret1m))}${row("From 2-yr high", pctAbs(e.pctFromHigh, 1))}`);
    });
  }
  function renderThemes() {
    const el = $("#themes");
    const ext = Math.max(0.05, ...D.leaders.themes.flatMap((t) => t.stocks.map((s) => Math.abs(s.rel6m || 0))));
    el.innerHTML = D.leaders.themes.map((th) => `<div class="theme"><div class="theme-h"><b>${esc(th.name)}</b><span class="${cls(th.avgRel6m)}" style="font-weight:600">${isNum(th.avgRel6m) ? (th.avgRel6m > 0 ? "+" : "") + (th.avgRel6m * 100).toFixed(1) + " pts avg" : "—"}</span></div>${th.stocks.slice(0, 5).map((s) => {
      const v = s.rel6m || 0, wpc = (Math.abs(v) / ext) * 50;
      return `<div class="srow" data-s="${esc(s.symbol)}"><b>${esc(s.symbol)}</b><span class="sb"><i style="${v >= 0 ? "left:50%" : `left:${50 - wpc}%`};width:${wpc}%;background:${v >= 0 ? UP : DOWN}"></i><i style="left:50%;width:1px;background:#B9BBD0"></i></span><span class="sv ${cls(v)}">${(v > 0 ? "+" : "") + (v * 100).toFixed(0)}</span></div>`;
    }).join("")}</div>`).join("");
    el.querySelectorAll(".srow").forEach((r) => {
      const s = D.leaders.themes.flatMap((t) => t.stocks).find((x) => x.symbol === r.dataset.s);
      bindTip(r, () => `<b>${esc(s.symbol)}</b>${row("6-mo return", pct(s.ret6m))}${row("vs S&P 500", (s.rel6m * 100).toFixed(1) + " pts")}${row("1-mo return", pct(s.ret1m))}${row("From 2-yr high", pctAbs(s.pctFromHigh, 1))}`);
    });
  }

  // ---------------------------------------------------------------- section 6
  function valBuckets() {
    const V = D.valuation.assets;
    const pe = (v) => isNum(v.pe) && v.pe >= 1 ? v.pe : null;
    return {
      faster: V.filter((v) => pe(v) && isNum(v.epsGrowth) && v.epsGrowth * 100 > v.pe).sort((a, b) => b.epsGrowth * 100 / b.pe - a.epsGrowth * 100 / a.pe),
      cyclical: V.filter((v) => pe(v) && v.pe < 15 && (v.group === "memory" || (isNum(v.fwdPe) && v.fwdPe > v.pe))).sort((a, b) => a.pe - b.pe),
      growth: V.filter((v) => { const p = isNum(v.fwdPe) && v.fwdPe > 0 ? v.fwdPe : pe(v); return p && p > 40; }).sort((a, b) => (b.fwdPe || b.pe) - (a.fwdPe || a.pe)),
      none: V.filter((v) => !pe(v) && !(isNum(v.fwdPe) && v.fwdPe > 0)),
    };
  }
  function renderValCards() {
    const B = valBuckets();
    const card = (title, desc, list, f) => `<div class="vc"><h4>${title}</h4><p>${desc}</p><ul>${list.length ? list.slice(0, 7).map((v) => `<li><b><span class="dot" style="background:${GC[v.group]};margin-right:6px"></span>${esc(v.ticker)}</b><span>${f(v)}</span></li>`).join("") : '<li><span>None right now</span></li>'}</ul></div>`;
    $("#valCards").innerHTML =
      card("Earnings growing faster than P/E", "Year-on-year earnings growth (in %) is higher than the trailing P/E, so the PEG ratio is under 1.", B.faster, (v) => `P/E ${v.pe.toFixed(0)} · EPS ${pct(v.epsGrowth, 0)}`) +
      card("Cheap on peak-cycle earnings", "Trailing P/E under 15 in memory or where the forward P/E is higher. A low P/E at a cycle peak can be a trap.", B.cyclical, (v) => `P/E ${v.pe.toFixed(1)} · fwd ${isNum(v.fwdPe) ? v.fwdPe.toFixed(1) : "—"}`) +
      card("Priced for a lot of growth", "Forward P/E (or trailing, where no forward figure exists) above 40. Earnings have to deliver.", B.growth, (v) => `fwd ${isNum(v.fwdPe) ? v.fwdPe.toFixed(0) : "—"} · P/E ${isNum(v.pe) ? v.pe.toFixed(0) : "—"}`) +
      card("No earnings yet", "No positive trailing or forward P/E. These are valued on revenue and on the story.", B.none, (v) => `rev ${pct(v.revGrowth, 0)} · ${pctAbs(v.pctFromAth)} off`);
  }
  function renderValSummary() {
    const V = D.valuation.assets, B = valBuckets();
    const pes = V.filter((v) => isNum(v.pe) && v.pe >= 1).map((v) => v.pe).sort((a, b) => a - b);
    const med = pes.length ? pes[Math.floor(pes.length / 2)] : null;
    const dds = V.filter((v) => isNum(v.pctFromAth)).map((v) => v.pctFromAth).sort((a, b) => a - b);
    const medDD = dds[Math.floor(dds.length / 2)];
    const today = new Date().toISOString().slice(0, 10);
    const up = V.flatMap((v) => (v.earningsDates || []).filter((d) => d >= today).slice(0, 1).map((d) => ({ d, v }))).sort((a, b) => (a.d > b.d ? 1 : -1));
    const deepV = V.filter((v) => isNum(v.pctFromAth) && v.pctFromAth < -0.6), deep = deepV.map((v) => v.ticker);
    const deepNone = deepV.filter((v) => B.none.includes(v)).length;
    $("#valSummary").innerHTML = `<h3>The short version</h3>
      <p>The typical company here is <b>${pctAbs(medDD)}</b> below its high, and the median trailing P/E of those with earnings is <b>${med ? med.toFixed(0) : "—"}</b>. The sell-off has been hardest on stocks with the least earnings behind them. ${deep.length} names (${esc(deep.slice(0, 8).join(", "))}${deep.length > 8 ? "…" : ""}) are more than 60% off their highs, and ${deepNone} of them have no positive trailing or forward earnings at all. The mega-caps fell least because they have the most profit.</p>
      <p>Low P/Es in memory reflect peak-cycle profits. If prices for DRAM and NAND roll over, those earnings shrink and the stocks stop looking cheap. ${B.faster.length ? `The few names where earnings growth outpaces the P/E (${esc(B.faster.slice(0, 4).map((v) => v.ticker).join(", "))}) are the strongest on this screen, if that growth holds.` : ""}</p>
      ${up.length ? `<p><b>Upcoming earnings</b></p><ul>${up.slice(0, 12).map(({ d, v }) => `<li>${dt(d)}: ${esc(v.ticker)} (${esc(v.name)})</li>`).join("")}</ul>` : `<p class="muted">No upcoming earnings dates reported by Yahoo.</p>`}`;
  }
  function renderValTable() {
    const V = D.valuation.assets;
    const cols = [["Company", (v) => `<span class="dot" style="background:${GC[v.group]}"></span>${esc(v.ticker)} <span class="muted">${esc(v.name)}</span>`, "l"],
      ["Market cap", (v) => cap(v.marketCapUSD)], ["From high", (v) => pctAbs(v.pctFromAth, 1)],
      ["P/E", (v) => isNum(v.pe) ? v.pe.toFixed(1) : "—"], ["Fwd P/E", (v) => isNum(v.fwdPe) ? v.fwdPe.toFixed(1) : "—"],
      ["P/B", (v) => isNum(v.pb) ? v.pb.toFixed(1) : "—"], ["Rev growth", (v) => `<span class="${cls(v.revGrowth)}">${pct(v.revGrowth, 0)}</span>`],
      ["EPS growth", (v) => `<span class="${cls(v.epsGrowth)}">${pct(v.epsGrowth, 0)}</span>`],
      ["Next earnings", (v) => { const today = new Date().toISOString().slice(0, 10); const n = (v.earningsDates || []).find((d) => d >= today); return n ? dt(n) : "—"; }]];
    $("#valTable").innerHTML = `<table><thead><tr>${cols.map(([l, , c]) => `<th class="ns ${c || ""}">${l}</th>`).join("")}</tr></thead><tbody>${V.slice().sort((a, b) => (b.marketCapUSD || 0) - (a.marketCapUSD || 0)).map((v) => `<tr>${cols.map(([, f, c]) => `<td class="${c || ""}">${f(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function renderScatter() {
    const el = $("#scatter"); el.innerHTML = "";
    const V = D.valuation.assets.map((v) => {
      const tr = isNum(v.pe) && v.pe >= 1, fw = isNum(v.fwdPe) && v.fwdPe >= 1;
      return { ...v, y: tr ? v.pe : fw ? v.fwdPe : null, fwd: !tr && fw };
    }).filter((v) => v.y && isNum(v.pctFromAth));
    const groups = [...new Set(D.valuation.assets.map((v) => v.group))];
    $("#scLegend").innerHTML = groups.map((g) => `<span><span class="dot" style="background:${GC[g]}"></span>${esc(D.overview.groups.find((x) => x.key === g).name)}</span>`).join("") + `<span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#4A4E6E" stroke-width="2"/></svg>Forward P/E</span>`;
    const w = W(el), H = Math.round(Math.min(520, Math.max(320, w * 0.5)));
    const m = { l: 50, r: 22, t: 16, b: 44 };
    const yMin = Math.min(4, ...V.map((v) => v.y)) * 0.8, yMax = Math.max(200, ...V.map((v) => v.y)) * 1.15;
    const xMin = Math.min(-0.95, ...V.map((v) => v.pctFromAth)) - 0.03;
    const X = (v) => m.l + ((v - xMin) / (0 - xMin)) * (w - m.l - m.r);
    const Y = (v) => m.t + (1 - (Math.log(v) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * (H - m.t - m.b);
    const capMax = Math.max(...V.map((v) => v.marketCapUSD || 0));
    const R = (c) => 5 + Math.sqrt((c || 0) / capMax) * (w < 500 ? 18 : 30);
    const s = sv("svg", { viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": "P/E against distance from high" }, el);
    [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].filter((v) => v <= yMax && v >= yMin).forEach((v) => {
      sv("line", { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: "ax" }, s);
      sv("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, s).textContent = v;
    });
    niceTicks(xMin, 0, w < 500 ? 4 : 8).forEach((v) => {
      sv("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: v === 0 ? "zero" : "ax" }, s);
      sv("text", { x: X(v), y: H - m.b + 18, "text-anchor": "middle" }, s).textContent = v === 0 ? "At high" : Math.round(v * 100) + "%";
    });
    sv("text", { x: (m.l + w - m.r) / 2, y: H - 4, "text-anchor": "middle", style: "font-weight:600" }, s).textContent = "% below all-time high";
    sv("text", { x: 12, y: m.t + (H - m.t - m.b) / 2, transform: `rotate(-90 12 ${m.t + (H - m.t - m.b) / 2})`, "text-anchor": "middle", style: "font-weight:600" }, s).textContent = "P/E (log)";
    V.sort((a, b) => (b.marketCapUSD || 0) - (a.marketCapUSD || 0));
    const placed = [];
    V.forEach((v) => {
      const cx = X(v.pctFromAth), cy = Y(v.y), r = R(v.marketCapUSD), col = GC[v.group];
      sv("circle", v.fwd ? { cx, cy, r, fill: "#fff", "fill-opacity": 0.6, stroke: col, "stroke-width": 2.5 } : { cx, cy, r, fill: col, "fill-opacity": 0.72, stroke: "#fff", "stroke-width": 2 }, s);
      placed.push({ v, cx, cy, r });
    });
    // direct labels, skip if colliding
    const boxes = [];
    placed.forEach(({ v, cx, cy, r }) => {
      const tw = v.ticker.length * 7.4 + 4, th = 14;
      const cands = [[cx + r + 3, cy + 4, "start"], [cx - r - 3, cy + 4, "end"], [cx, cy - r - 4, "middle"], [cx, cy + r + 13, "middle"]];
      for (const [lx, ly, an] of cands) {
        const bx = an === "start" ? lx : an === "end" ? lx - tw : lx - tw / 2, by = ly - 11;
        if (bx < m.l || bx + tw > w - 2 || by < 0 || by + th > H - m.b) continue;
        if (boxes.some((b) => bx < b.x + b.w && bx + tw > b.x && by < b.y + b.h && by + th > b.y)) continue;
        if (placed.some((p) => p.v !== v && Math.hypot(Math.max(bx - p.cx, 0, p.cx - bx - tw), Math.max(by - p.cy, 0, p.cy - by - th)) < p.r - 2)) continue;
        boxes.push({ x: bx, y: by, w: tw, h: th });
        sv("text", { x: lx, y: ly, "text-anchor": an, style: "font-weight:600;fill:#2B2F55" }, s).textContent = v.ticker;
        break;
      }
    });
    placed.slice().reverse().forEach(({ v, cx, cy, r }) => {
      const hit = sv("circle", { cx, cy, r: Math.max(r, 9), fill: "transparent" }, s);
      bindTip(hit, () => `<b>${esc(v.ticker)} · ${esc(v.name)}</b>${row(v.fwd ? "Forward P/E" : "Trailing P/E", v.y.toFixed(1))}${!v.fwd && isNum(v.fwdPe) ? row("Forward P/E", v.fwdPe.toFixed(1)) : ""}${row("From high", pctAbs(v.pctFromAth, 1))}${row("Market cap", cap(v.marketCapUSD))}${row("EPS growth", pct(v.epsGrowth, 0))}`);
    });
  }

  function renderMissing() {
    const M = D.meta.missing || {};
    const keys = Object.keys(M);
    $("#missingNote").textContent = keys.length ? "Gaps in this update: " + keys.map((k) => `${k} (${M[k].join(", ")})`).join("; ") + "." : "";
  }

  // nav highlight
  const links = [...document.querySelectorAll(".nav-pill a")];
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) links.forEach((l) => l.classList.toggle("on", l.getAttribute("href") === "#" + e.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main section").forEach((s) => io.observe(s));

  load().catch((e) => { $("#dataStamp").textContent = "Could not load data: " + e.message; console.error(e); });
})();
