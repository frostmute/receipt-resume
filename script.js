/* JONATHAN J. WAGNER — a résumé that prints itself. Built on the RECEIPT printer. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const D = window.JW || { gh: {}, projects: [], events: [] };
  const stage = $("#stage"), lcdA = $("#lcdA"), lcdB = $("#lcdB"), lcd = $(".lcd"), led = $("#led");
  const feedBtn = $("#feed"), sndBtn = $("#snd"), hint = $("#hint"), hintTxt = $("#hintTxt"), ghost = $(".ghost"), ghostNo = $("#ghostNo");
  const modeBtn = $("#mode");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EMAIL = "jonathanjameswagner@proton.me";

  /* ---------------- the roll ---------------- */
  const ORDER = ["arrival", "experience", "education", "skills"];
  D.projects.forEach((_, i) => ORDER.push("proj:" + i));
  ORDER.push("activity", "terms", "note", "end");
  const LABEL = n => n.startsWith("proj:") ? "Project · " + D.projects[+n.slice(5)].name :
    ({ arrival: "Arrival", experience: "Experience", education: "Education", skills: "Skills", activity: "Today's transactions",
       terms: "Terms", note: "Contact", end: "End of roll" })[n];
  const idx = $("#index");
  ORDER.forEach((n, i) => {
    const li = document.createElement("li"); li.dataset.n = String(i + 1).padStart(2, "0");
    const b = document.createElement("button"); b.type = "button"; b.textContent = LABEL(n); b.dataset.go = i;
    li.appendChild(b); idx.appendChild(li);
  });
  const idxItems = [...idx.querySelectorAll("li")];

  const S = { i: 0, roll: 1, no: 0, cur: null, state: "idle", torn: 0, hes: 0, lines: 0, usedMM: 0,
              t0: Date.now(), pendingNote: null, everTorn: false, target: null, full: false };
  const ROLL_M = 80;

  /* visit counter: one per browser session, kept on this device */
  let visits = 1;
  try {
    visits = +(localStorage.getItem("jw-visits") || 0);
    if (!sessionStorage.getItem("jw-v")) { visits++; localStorage.setItem("jw-visits", visits); sessionStorage.setItem("jw-v", "1"); }
    visits = Math.max(1, visits);
  } catch (_) {}

  /* ---------------- live GitHub (public API, no key) ---------------- */
  const live = { events: null, eventsState: "pending", repos: null };
  function getJSON(url, ms) {
    const ctl = "AbortController" in window ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), ms);
    return fetch(url, { signal: ctl && ctl.signal, headers: { Accept: "application/vnd.github+json" } })
      .then(r => { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  const evP = getJSON("https://api.github.com/users/frostmute/events/public?per_page=30", 7000)
    .then(j => { if (!Array.isArray(j)) throw 0; live.events = j.map(ev => ({ type: ev.type, repo: ev.repo && ev.repo.name, at: ev.created_at,
      ref: ev.payload && ev.payload.ref, ref_type: ev.payload && ev.payload.ref_type, action: ev.payload && ev.payload.action })); live.eventsState = "live"; })
    .catch(() => { live.eventsState = "offline"; });
  getJSON("https://api.github.com/users/frostmute/repos?per_page=100", 7000).then(list => {
    if (!Array.isArray(list)) return;
    const by = {}; list.forEach(r => by[r.name] = r);
    D.projects.forEach(p => { const r = by[p.name]; if (r) { p.stars = r.stargazers_count; p.forks = r.forks_count; p.pushed = (r.pushed_at || p.pushed).slice(0, 10); if (r.description) p.desc = r.description; p.live = true; } });
    const own = list.filter(r => !r.fork), langs = {};
    own.forEach(r => { if (r.language) langs[r.language] = (langs[r.language] || 0) + 1; });
    D.gh.public_repos = list.length; D.gh.original = own.length;
    D.gh.stars = list.reduce((a, r) => a + r.stargazers_count, 0);
    D.gh.langs = Object.entries(langs).sort((a, b) => b[1] - a[1]); D.gh.live = true;
  }).catch(() => {});

  /* ---------------- sound ---------------- */
  const A = { ctx: null, on: false, master: null, noise: null, wanted: (() => { try { return localStorage.getItem("jw-snd") !== "0"; } catch (_) { return true; } })() };
  function audioInit() {
    if (A.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    A.ctx = new C();
    A.master = A.ctx.createGain(); A.master.gain.value = 0.55; A.master.connect(A.ctx.destination);
    const len = A.ctx.sampleRate * 1.5, buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
    A.noise = buf;
  }
  function setSound(on) {
    A.on = on; sndBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { audioInit(); A.ctx && A.ctx.resume && A.ctx.resume(); }
  }
  function nz(t, dur, f, q, vol, type = "bandpass") {
    const s = A.ctx.createBufferSource(); s.buffer = A.noise; s.loop = true;
    const fl = A.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = A.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(A.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
    return { g, fl };
  }
  function tone(t, dur, f, vol, type = "square") {
    const o = A.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const lp = A.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
    const g = A.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.003);
    g.gain.setValueAtTime(vol, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(A.master); o.start(t); o.stop(t + dur + 0.02);
  }
  const ok = () => A.on && A.ctx;
  const sfx = {
    line(dur) { if (!ok()) return; const t = A.ctx.currentTime; const d = Math.max(0.03, dur);
      tone(t, d, 610 + Math.random() * 40, 0.035); tone(t, d, 1220, 0.012); nz(t, d, 3800, 1.2, 0.05); },
    feed(dur) { if (!ok()) return; const t = A.ctx.currentTime; tone(t, dur, 300, 0.025, "sawtooth"); nz(t, dur, 1400, 0.8, 0.025); },
    img(dur) { if (!ok()) return; const t = A.ctx.currentTime; tone(t, dur, 440 + Math.random() * 30, 0.03); nz(t, dur, 5200, 2, 0.04); },
    stress(p) { if (!ok()) return; const t = A.ctx.currentTime; nz(t, 0.025, 2500 + p * 3000, 6, 0.04 + p * 0.05, "bandpass"); },
    rip() { if (!ok()) return; const t = A.ctx.currentTime, dur = 0.34;
      const n = nz(t, dur, 1800, 0.9, 0.0, "bandpass");
      n.fl.frequency.setValueAtTime(1200, t); n.fl.frequency.exponentialRampToValueAtTime(5200, t + dur);
      for (let k = 0; k < dur; k += 0.008) n.g.gain.setValueAtTime(Math.random() < 0.55 ? 0.35 * Math.random() + 0.08 : 0.01, t + k);
      n.g.gain.setValueAtTime(0.0001, t + dur);
      nz(t, 0.06, 900, 0.7, 0.18, "lowpass"); },
    click() { if (!ok()) return; const t = A.ctx.currentTime; tone(t, 0.025, 1800, 0.05, "triangle"); },
    beep() { if (!ok()) return; const t = A.ctx.currentTime; tone(t, 0.07, 2093, 0.03, "sine"); tone(t + 0.09, 0.09, 2637, 0.03, "sine"); }
  };
  sndBtn.addEventListener("click", e => { e.stopPropagation(); A.wanted = !A.on; try { localStorage.setItem("jw-snd", A.wanted ? "1" : "0"); } catch (_) {} setSound(A.wanted); sfx.click(); });
  let firstGesture = true;
  addEventListener("pointerdown", e => {
    if (!firstGesture) return; firstGesture = false;
    if (e.target.closest && e.target.closest("#snd")) return;
    if (A.wanted) setSound(true);
  }, { capture: true });

  /* ---------------- helpers ---------------- */
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const vib = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  const line = (cls, txt) => el("p", "l " + (cls || ""), txt);
  const row = (left, right, cls) => { const p = line("r " + (cls || "")); p.append(el("span", "", left), el("b", "", right)); return p; };
  function setLCD(a, blink) { lcdA.textContent = a; lcd.classList.toggle("blink", !!blink); }
  function updateMeters() {
    const left = Math.max(0, ROLL_M - S.usedMM / 1000);
    lcdB.textContent = "PAPER " + left.toFixed(2) + "M";
    $("#mUsed").textContent = (S.usedMM / 1000).toFixed(2);
    $("#mTorn").textContent = S.torn; $("#mLines").textContent = S.lines;
  }
  function dur() { const s = Math.floor((Date.now() - S.t0) / 1000); return pad(Math.floor(s / 60)) + ":" + pad(s % 60); }
  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const YEAR = new Date().getFullYear();
  const yrs = spec => { const [a, b] = spec.split("-"); return (b === "now" ? YEAR : +b) - +a; };
  function ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "M";
    if (s < 86400) return Math.round(s / 3600) + "H";
    return Math.round(s / 86400) + "D";
  }
  const fmtDate = d => pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + "/" + d.getFullYear();
  const fmtTime = d => pad(d.getHours()) + ":" + pad(d.getMinutes());

  function barcode(bar) {
    const seed = hash(bar.dataset.code + S.roll + S.t0); let x = seed;
    const rnd = () => (x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
    const frag = document.createDocumentFragment(); let w = 0; const max = 230;
    const add = (bw, dark) => { const i = document.createElement("i"); i.style.width = bw + "px"; if (!dark) i.style.background = "transparent"; frag.appendChild(i); w += bw; };
    add(2, 1); add(1, 0); add(2, 1); add(2, 0);
    while (w < max) { add(1 + Math.floor(rnd() * 3.2), 1); add(1 + Math.floor(rnd() * 2.6), 0); }
    add(2, 1); add(1, 0); add(2, 1);
    bar.appendChild(frag);
  }

  /* ---------------- generated receipts ---------------- */
  function projectReceipt(i) {
    const p = D.projects[i], f = document.createDocumentFragment(), n = D.projects.length;
    f.append(line("c dim", "PROJECT " + pad(i + 1) + " OF " + pad(n) + " · NO. " + pad(S.no, 4)));
    const t = line("c big pname", p.name.toUpperCase()); f.append(t);
    f.append(line("c dim", "BY FROSTMUTE · " + (p.lang || "CODE").toUpperCase()));
    f.append(line("dbl"));
    const fig = el("figure", "l fig"); const img = el("img"); img.src = p.img; img.alt = p.alt; img.width = p.w; img.height = p.h; img.decoding = "async";
    if (p.w < 300) fig.classList.add("narrow");
    fig.append(img); f.append(fig);
    f.append(line("c dim tiny", "FIG." + pad(i + 1) + " · REPO ARTWORK, 1-BIT"));
    f.append(line("hr"));
    const st = row("STARS", ""); st.querySelector("b").innerHTML = '<i class="dep">\u2605</i> ' + p.stars; f.append(st);
    f.append(row("FORKS", String(p.forks)));
    f.append(row("LANGUAGE", (p.lang || "—").toUpperCase()));
    f.append(row("FIRST COMMIT", p.created.slice(0, 7).replace("-", "/")));
    f.append(row("LAST PUSH", p.pushed.replace(/-/g, "/")));
    f.append(line("hr"));
    f.append(line("nc para", p.desc || ""));
    if (p.note) f.append(line("nc para dim", p.note));
    if (p.topics && p.topics.length) f.append(line("tiny tags", p.topics.slice(0, 6).map(x => "#" + x).join("  ")));
    f.append(line("dbl"));
    const q = el("a", "l qrbig"); q.href = p.url; q.target = "_blank"; q.rel = "noopener";
    const qi = el("img"); qi.src = p.qr; qi.alt = "QR code that opens " + p.url; qi.width = 33; qi.height = 33;
    q.append(qi, el("span", "", "SCAN TO OPEN THE REPO")); f.append(q);
    const a = el("a", "", p.url.replace("https://", "")); a.href = p.url; a.target = "_blank"; a.rel = "noopener";
    const lk = line("c lk1"); lk.append(a); f.append(lk);
    if (p.home && !/jjwagner\.vercel\.app/.test(p.home)) {
      const h = el("a", "", "DEMO / DOCS \u2197"); h.href = p.home; h.target = "_blank"; h.rel = "noopener"; h.className = "dep";
      const hl = line("c tiny"); hl.append(h); f.append(hl);
    }
    f.append(line("sp"));
    f.append(row("SUBTOTAL", p.stars + (p.stars === 1 ? " STAR" : " STARS")));
    f.append(row("PRICE", "FREE", "big"));
    f.append(line("c dim tiny", p.live ? "STATS LIVE FROM GITHUB" : "STATS FROM GITHUB · " + D.built.slice(0, 10).replace(/-/g, "/")));
    f.append(line("sp"));
    const bar = el("div", "l bar"); bar.dataset.code = "P" + i; f.append(bar);
    f.append(line("sp"));
    return f;
  }

  const EVT = { PushEvent: "PUSH", WatchEvent: "STAR", CreateEvent: "NEW", DeleteEvent: "DELETE", ForkEvent: "FORK", PullRequestEvent: "PR",
    IssuesEvent: "ISSUE", IssueCommentEvent: "COMMENT", ReleaseEvent: "RELEASE", PublicEvent: "PUBLIC", PullRequestReviewEvent: "REVIEW",
    PullRequestReviewCommentEvent: "REVIEW", CommitCommentEvent: "COMMENT", GollumEvent: "WIKI", MemberEvent: "MEMBER" };
  function activityReceipt() {
    const f = document.createDocumentFragment();
    const isLive = live.eventsState === "live" && live.events && live.events.length;
    const evs = isLive ? live.events : (D.events || []);
    const now = new Date();
    f.append(line("c big", "TODAY'S"), line("c big", "TRANSACTIONS"));
    f.append(line("c dim", "GITHUB.COM/FROSTMUTE · " + fmtTime(now) + " · NO. " + pad(S.no, 4)));
    f.append(line("dbl"));
    if (isLive) f.append(line("inv c", "\u25CF LIVE PUBLIC ACTIVITY"));
    else {
      f.append(line("inv c", "OFFLINE COPY"));
      f.append(line("nc para dim", "GitHub's live feed didn't answer just now (it rate-limits busy networks), so this is the last copy printed on " + D.built.slice(0, 10) + "."));
    }
    f.append(line("sp half"));
    const th = line("ev th"); th.append(el("span", "", "AGO"), el("span", "", "TYPE"), el("span", "", "REPO")); f.append(th);
    f.append(line("hr"));
    const counts = {};
    evs.forEach(e => { const k = EVT[e.type] || "OTHER"; counts[k] = (counts[k] || 0) + 1; });
    const SHOW = 14;
    evs.slice(0, SHOW).forEach(e => {
      const k = EVT[e.type] || e.type.replace("Event", "").toUpperCase();
      let repo = (e.repo || "").replace(/^frostmute\//, "");
      let extra = "";
      if (e.type === "PushEvent" && e.ref) extra = " \u2192 " + e.ref.replace("refs/heads/", "");
      else if ((e.type === "CreateEvent" || e.type === "DeleteEvent") && e.ref_type) extra = " (" + e.ref_type + ")";
      else if (e.action && e.type !== "WatchEvent") extra = " (" + e.action + ")";
      const p = line("ev"); p.append(el("span", "", ago(e.at)), el("b", "", k), el("span", "rp nc", repo + extra)); f.append(p);
    });
    if (!evs.length) f.append(line("c dim", "NO PUBLIC ACTIVITY ON FILE."));
    if (evs.length > SHOW) f.append(line("c dim tiny", "+ " + (evs.length - SHOW) + " MORE IN THIS BATCH"));
    f.append(line("hr"));
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => f.append(row(k === "STAR" ? "STARS GIVEN" : k === "PUSH" ? "PUSHES" : k, String(v))));
    f.append(row("TRANSACTIONS", String(evs.length), "big"));
    f.append(line("c dim tiny", "OWN REPOS SHOW WITHOUT THE FROSTMUTE/ PREFIX"));
    f.append(line("sp"));
    const a = el("a", "", "SEE THE FULL FEED ON GITHUB \u2197"); a.href = "https://github.com/frostmute"; a.target = "_blank"; a.rel = "noopener"; a.className = "dep";
    const al = line("c"); al.append(a); f.append(al);
    f.append(line("sp"));
    const bar = el("div", "l bar"); bar.dataset.code = "0005"; f.append(bar);
    f.append(line("sp"));
    return f;
  }

  function langBars(box) {
    const langs = D.gh.langs || []; const max = Math.max(1, ...langs.map(x => x[1]));
    langs.forEach(([name, n]) => {
      const p = el("p", "lg"); const bar = el("span", "lgbar dep", "\u25A0".repeat(Math.max(1, Math.round(n / max * 8))));
      p.append(el("span", "lgname", name.toUpperCase()), bar, el("b", "", String(n))); box.append(p);
    });
  }

  /* ---------------- build a receipt ---------------- */
  function fill(root) {
    const now = new Date();
    const map = {
      date: fmtDate(now), time: fmtTime(now),
      no: pad(S.no, 4), order: pad(visits, 4),
      visit: visits === 1 ? "FIRST, WELCOME" : "NO. " + visits + ", WELCOME BACK",
      code: "* " + String(hash(String(S.t0 + S.no))).padStart(10, "0").slice(0, 10).replace(/(\d{3})(\d{4})(\d{3})/, "$1 $2 $3") + " *",
      dur: dur(), paper: (S.usedMM / 10).toFixed(1) + " CM", count: String(ORDER.length),
      yrsum: String([...root.querySelectorAll("[data-yrs]")].reduce((a, x) => a + yrs(x.dataset.yrs), 0)),
      ghsrc: D.gh.live ? "LIVE FROM GITHUB" : "GITHUB, " + (D.built || "").slice(0, 10).replace(/-/g, "/"),
      msg: S.pendingNote || ""
    };
    root.querySelectorAll("[data-yrs]").forEach(x => x.textContent = yrs(x.dataset.yrs));
    root.querySelectorAll("[data-f]").forEach(x => {
      const k = x.dataset.f;
      if (k === "langs") { x.textContent = ""; langBars(x); return; }
      if (k === "mailto") { x.href = mailto(S.pendingNote || ""); return; }
      const v = map[k]; if (v != null) x.textContent = v;
    });
  }
  function mailto(msg) {
    return "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Hello from your receipt résumé") + "&body=" + encodeURIComponent(msg + "\n\n— sent from frostmute.sites.tab.bot");
  }

  function content(name) {
    if (name.startsWith("proj:")) return projectReceipt(+name.slice(5));
    if (name === "activity") return activityReceipt();
    return document.getElementById("r-" + name).content.cloneNode(true);
  }

  function shell(name, cls) {
    const rc = el("div", "rc" + (cls ? " " + cls : "")); rc.setAttribute("role", "article");
    const mover = el("div", "mover"), shade = el("div", "shade"), paper = el("div", "paper"), streaks = el("div", "streaks");
    [0.23 + Math.random() * 0.1, 0.61 + Math.random() * 0.1].forEach(p => { const i = el("i"); i.style.left = (p * 100).toFixed(1) + "%"; streaks.appendChild(i); });
    paper.appendChild(streaks);
    mover.append(shade, paper);
    const slotshade = el("div", "slotshade"), crack = el("div", "crack");
    rc.append(mover, slotshade, crack);
    return { name, rc, mover, paper, shade, crack, H: 0, fed: 0, angle: 0 };
  }
  function finishPaper(r) {
    fill(r.paper);
    r.paper.querySelectorAll(".bar").forEach(barcode);
    let k = 0;
    r.paper.querySelectorAll(".l").forEach(x => {
      k++; const fade = 0.82 + 0.18 * Math.abs(Math.sin(k * 1.7 + S.no)) - (Math.random() < 0.06 ? 0.1 : 0);
      x.style.setProperty("--k", fade.toFixed(2));
    });
  }
  function build(name) {
    S.no++;
    const r = shell(name, name === "end" ? "endroll" : "");
    r.rc.setAttribute("aria-label", "Receipt " + (ORDER.indexOf(name) + 1 || "") + ": " + (name === "yours" ? "your note" : LABEL(name)));
    r.paper.appendChild(content(name));
    if (S.roll > 1 && name === "arrival") r.paper.insertBefore(line("c inv", "** REPRINT · ROLL " + S.roll + " **"), r.paper.querySelector(".streaks").nextSibling);
    finishPaper(r);
    return r;
  }
  function buildAll() {
    const r = shell("all", "allroll");
    r.rc.setAttribute("aria-label", "The whole résumé, one long receipt");
    ORDER.forEach((n, i) => {
      S.no++;
      const sec = el("section", "sec"); sec.id = "sec-" + i; sec.setAttribute("aria-label", LABEL(n));
      if (i > 0) { const perf = line("perf c", "- - - - - - " + LABEL(n).toUpperCase() + " - - - - - -"); perf.setAttribute("aria-hidden", "true"); r.paper.appendChild(perf); }
      sec.appendChild(content(n)); r.paper.appendChild(sec);
    });
    // the end-of-roll copy talks about tearing; in full mode the buttons do the job
    finishPaper(r);
    return r;
  }

  /* ---------------- printing ---------------- */
  function segmentsOf(r) {
    const segs = []; const H = r.H; let prevTop = H;
    const els = [...r.paper.querySelectorAll(":scope > .l")];
    const items = els.map(x => ({ el: x, top: x.offsetTop, h: x.offsetHeight, type: x.matches(".fig,.bar,.sig,.qrs,.qrbig") ? "img" : (x.matches(".sp") ? "blank" : "text") }));
    for (let n = items.length - 1; n >= 0; n--) {
      const it = items[n], bottom = it.top + it.h;
      if (prevTop - bottom > 0.5) segs.push({ y0: prevTop, y1: bottom, type: "blank" });
      segs.push({ y0: bottom, y1: it.top, type: it.type, el: it.el });
      prevTop = it.top;
    }
    if (prevTop > 0) segs.push({ y0: prevTop, y1: 0, type: "blank" });
    return { segs, items };
  }

  let raf = 0, fast = false, instant = false, skipHintT = 0;
  function markIndex() {
    idxItems.forEach((li, i) => { li.classList.toggle("now", !S.full && i === S.i); });
  }
  function print(r) {
    S.cur = r; S.state = "printing"; fast = reduce; instant = false;
    stage.appendChild(r.rc);
    r.H = r.paper.offsetHeight;
    stage.style.minHeight = (r.H + parseFloat(getComputedStyle(r.rc).top) + 160) + "px";
    r.mover.style.transform = `translate3d(0,${-r.H}px,0)`;
    const { segs, items } = segmentsOf(r);
    const LH = parseFloat(getComputedStyle(r.paper).lineHeight) || 21;
    led.className = "led busy"; setLCD("PRINTING");
    feedBtn.querySelector("span").textContent = "SKIP";
    markIndex();
    ghost.classList.remove("out"); ghostNo.textContent = pad(S.i + 1);
    hint.classList.remove("show");
    clearTimeout(skipHintT);
    if (!S.everTorn && S.no <= 1) skipHintT = setTimeout(() => { if (S.state === "printing") { hintTxt.textContent = "tap the paper to print faster"; hint.classList.add("show", "nohand"); } }, 1600);
    let si = 0, segT = 0, last = performance.now(), lastStep = -1, pendingReveal = items.slice();
    const pxPerMM = r.paper.offsetWidth / 80;
    const tick = now => {
      let dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (instant) dt = 1e4; else if (fast) dt *= 7;
      let head = r.H - r.fed;
      while (dt > 0 && si < segs.length) {
        const s = segs[si], len = s.y0 - s.y1;
        if (s.type === "text") {
          const steps = Math.max(1, Math.round(len / LH)), stepDur = 0.05, total = steps * stepDur;
          segT += dt; dt = 0;
          const stepIdx = Math.min(steps - 1, Math.floor(segT / stepDur));
          const within = Math.min(1, ((segT - stepIdx * stepDur) / stepDur) / 0.62);
          const e = 1 - Math.pow(1 - within, 3);
          const p = Math.min(1, (stepIdx + e) / steps);
          head = s.y0 - len * p;
          if (stepIdx !== lastStep && segT < total) { lastStep = stepIdx; if (!fast) sfx.line(stepDur * 0.62); }
          if (segT >= total) { dt = segT - total; segT = 0; si++; lastStep = -1; head = s.y1; }
        } else {
          const speed = s.type === "img" ? 320 : 900;
          const need = (len - (s.y0 - head)) / speed;
          if (segT === 0 && !fast) (s.type === "img" ? sfx.img : sfx.feed)(Math.min(0.6, len / speed));
          segT += dt;
          if (dt >= need) { dt -= need; head = s.y1; si++; segT = 0; }
          else { head -= dt * speed; dt = 0; }
        }
      }
      const prevFed = r.fed;
      r.fed = r.H - head;
      S.usedMM += (r.fed - prevFed) / pxPerMM;
      r.mover.style.transform = `translate3d(0,${(r.fed - r.H).toFixed(2)}px,0)`;
      while (pendingReveal.length && pendingReveal[pendingReveal.length - 1].top + pendingReveal[pendingReveal.length - 1].h >= head - 1) {
        const it = pendingReveal.pop(); it.el.classList.add("on");
        if (it.type === "text") S.lines += Math.max(1, Math.round(it.h / LH));
      }
      updateMeters();
      if (si >= segs.length) { r.fed = r.H; r.mover.style.transform = "translate3d(0,0,0)"; items.forEach(it => it.el.classList.add("on")); donePrinting(r); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(t => { last = t; tick(t); });
  }

  function donePrinting(r) {
    S.state = "ready"; r.rc.classList.add("ready");
    led.className = "led on"; setLCD("TEAR \u2194", true); sfx.beep();
    feedBtn.querySelector("span").textContent = "TEAR";
    clearTimeout(skipHintT); hint.classList.remove("show", "nohand");
    if (!S.everTorn) {
      setTimeout(() => { if (S.cur === r && S.state === "ready") { nudge(r); hintTxt.textContent = "pull the paper sideways to tear"; hint.classList.add("show"); } }, 700);
    }
    if (r.rc.querySelector("#noteform")) bindNote(r);
  }

  /* ---------------- full roll: everything at once ---------------- */
  function printAll() {
    const r = buildAll();
    S.full = true; S.cur = r; S.state = "printing"; document.body.classList.add("full");
    modeBtn.setAttribute("aria-pressed", "true");
    stage.appendChild(r.rc);
    r.H = r.paper.offsetHeight;
    stage.style.minHeight = (r.H + parseFloat(getComputedStyle(r.rc).top) + 160) + "px";
    r.paper.querySelectorAll(".l").forEach(x => x.classList.add("on"));
    S.lines += r.paper.querySelectorAll(".l").length;
    led.className = "led busy"; setLCD("FULL ROLL"); markIndex();
    ghost.classList.add("out");
    const from = Math.min(r.H, innerHeight * 0.9), t0 = performance.now(), D_ = reduce ? 1 : 700;
    sfx.feed(0.7);
    const pxPerMM = r.paper.offsetWidth / 80; S.usedMM += r.H / pxPerMM;
    const step = now => {
      const p = Math.min(1, (now - t0) / D_), e = 1 - Math.pow(1 - p, 3);
      r.mover.style.transform = `translate3d(0,${(-from * (1 - e)).toFixed(1)}px,0)`;
      if (p < 1) requestAnimationFrame(step);
      else { r.mover.style.transform = "translate3d(0,0,0)"; S.state = "ready"; r.rc.classList.add("ready"); led.className = "led on"; setLCD("TEAR \u2194", true); feedBtn.querySelector("span").textContent = "TEAR"; updateMeters(); }
    };
    requestAnimationFrame(step);
    if (r.rc.querySelector("#noteform")) bindNote(r);
  }

  /* ---------------- swing & tear ---------------- */
  function setAngle(r, deg, tx = 0) { r.angle = deg; r.rc.style.transform = `translate3d(${tx}px,0,0) rotate(${deg.toFixed(3)}deg)`; }
  function spring(r, from, v0 = 0, onDone) {
    let a = from, v = v0, last = performance.now();
    const k = r === S.cur && S.full ? 40 : 70, c = 4.2;
    const step = now => {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const acc = -k * a - c * v; v += acc * dt; a += v * dt;
      setAngle(r, a);
      if (Math.abs(a) < 0.02 && Math.abs(v) < 0.05) { setAngle(r, 0); r.rc.style.transform = ""; onDone && onDone(); return; }
      if (S.cur !== r || r.dragging) return;
      r.springRaf = requestAnimationFrame(step);
    };
    r.springRaf = requestAnimationFrame(step);
  }
  function nudge(r) { if (reduce) return; spring(r, 0, 26); }

  let drag = null;
  function slotY() { return $("#printer").getBoundingClientRect().top + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--slot")); }
  stage.addEventListener("pointerdown", e => {
    const r = S.cur; if (!r || S.state !== "ready" || !r.rc.contains(e.target)) return;
    if (e.target.closest("input,textarea,button,form,a")) return;
    if (e.button !== undefined && e.button > 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lock: null, dx: 0, hist: [{ x: e.clientX, t: performance.now() }],
             rr: Math.max(160, Math.min(1200, e.clientY - slotY())), maxP: 0, lastStressP: 0 };
  });
  addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = S.cur; const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.lock) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      drag.lock = Math.abs(dx) > Math.abs(dy) * 1.1 ? "x" : "y";
      if (drag.lock === "y") { drag = null; return; }
      r.dragging = true; cancelAnimationFrame(r.springRaf); r.rc.classList.add("drag");
      try { r.rc.setPointerCapture(e.pointerId); } catch (_) {}
    }
    e.preventDefault();
    drag.dx = dx; drag.hist.push({ x: e.clientX, t: performance.now() }); if (drag.hist.length > 6) drag.hist.shift();
    const thr = tearThreshold();
    const p = Math.min(1.2, Math.abs(dx) / thr);
    const raw = Math.atan2(dx, drag.rr) * 180 / Math.PI;
    const lim = S.full ? 6 : 14; const ang = lim * Math.tanh(raw / lim);
    setAngle(r, ang * (1 - 0.15 * p));
    const cp = Math.max(0, (p - 0.35) / 0.65);
    r.crack.className = "crack " + (dx > 0 ? "l" : "r");
    r.crack.style.width = (Math.pow(cp, 1.6) * 46).toFixed(1) + "%";
    if (cp > 0 && cp - drag.lastStressP > 0.12) { drag.lastStressP = cp; sfx.stress(cp); vib(4); }
    if (cp < drag.lastStressP - 0.2) drag.lastStressP = cp;
    drag.maxP = Math.max(drag.maxP, p);
    if (p >= 1) { const d = drag; drag = null; release(d, true); }
  }, { passive: false });
  const endDrag = e => { if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; if (d.lock === "x") release(d, false); };
  addEventListener("pointerup", endDrag); addEventListener("pointercancel", endDrag);

  function tearThreshold() { return Math.min(150, Math.max(90, innerWidth * 0.3)); }
  function release(d, forced) {
    const r = S.cur; r.dragging = false; r.rc.classList.remove("drag");
    const h = d.hist, a = h[0], b = h[h.length - 1];
    const vx = (b.x - a.x) / Math.max(1, b.t - a.t);
    const flick = Math.abs(vx) > 0.9 && Math.abs(d.dx) > 45 && Math.sign(vx) === Math.sign(d.dx);
    if (forced || flick) { tear(r, Math.sign(d.dx) || 1, vx); return; }
    r.crack.style.width = "0";
    S.hes++; spring(r, r.angle, -vx * 40);
  }

  function savePDF() {
    try { const a = el("a"); a.href = "resume.pdf"; a.download = "Jonathan-Wagner-Resume.pdf"; document.body.appendChild(a); a.click(); a.remove(); } catch (_) {}
  }

  /* drop whatever hangs from the printer: a clean tear when ready, a cut mid-print otherwise */
  function drop(r, dir, vx) {
    cancelAnimationFrame(raf); cancelAnimationFrame(r.springRaf);
    r.crack.className = "crack " + (dir > 0 ? "l" : "r");
    r.crack.style.transition = "width .12s linear"; r.crack.style.width = "100%";
    const startAngle = r.angle;
    setTimeout(() => {
      r.rc.classList.add("free"); r.rc.classList.remove("ready");
      r.crack.style.opacity = "0";
      const sy = scrollY;
      let x = 0, y = 0, ang = startAngle, last = performance.now();
      let vX = dir * Math.max(520, Math.abs(vx) * 900), vY = -160, w = dir * (55 + Math.random() * 45);
      const g = 2600, t0 = performance.now();
      const fall = now => {
        const dt = Math.min(0.033, (now - last) / 1000); last = now;
        vY += g * dt; x += vX * dt; y += vY * dt; ang += w * dt; vX *= 0.995;
        r.rc.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${ang.toFixed(2)}deg)`;
        r.rc.style.opacity = Math.max(0, Math.min(1, (1500 - (now - t0)) / 500)).toFixed(3);
        if (now - t0 < 1500 && y < innerHeight + 400 + sy) requestAnimationFrame(fall); else r.rc.remove();
      };
      if (reduce) { r.rc.style.transition = "opacity .3s"; r.rc.style.opacity = "0"; setTimeout(() => r.rc.remove(), 320); }
      else requestAnimationFrame(fall);
    }, 120);
  }

  function tear(r, dir, vx = 0, then) {
    if (!r || S.cur !== r || (S.state !== "ready" && S.state !== "printing")) return;
    const wasEnd = r.name === "end" && !S.full;
    S.state = "tearing";
    S.torn++; S.everTorn = true; hint.classList.remove("show", "nohand"); clearTimeout(skipHintT);
    sfx.rip(); vib([10, 30, 16]);
    feedBtn.querySelector("span").textContent = "FEED";
    led.className = "led"; setLCD("CUT");
    if (!S.full && idxItems[S.i]) idxItems[S.i].classList.add("done");
    ghost.classList.add("out");
    drop(r, dir, vx);
    if (wasEnd) savePDF();
    const far = scrollY > 300;
    if (scrollY > 2) scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    setTimeout(then || next, far ? 650 : 400);
    updateMeters();
  }

  function next() {
    if (S.full) { leaveFull(S.target != null ? S.target : 0); return; }
    if (S.target != null) { const t = S.target; S.target = null; S.i = t; print(build(ORDER[t])); return; }
    if (S.pendingNote != null && S.lastWasNote) {
      S.lastWasNote = false;
      const r = build("yours"); S.pendingNote = null; S.i = ORDER.indexOf("note"); print(r); return;
    }
    if (ORDER[S.i] === "end") { reload(); return; }
    S.i = Math.min(ORDER.length - 1, S.i + 1);
    const n = ORDER[S.i];
    if (n === "activity" && live.eventsState === "pending") {
      setLCD("DIALING GITHUB", true); led.className = "led busy";
      Promise.race([evP, new Promise(res => setTimeout(res, 2500))]).then(() => print(build(n)));
      return;
    }
    print(build(n));
  }
  function leaveFull(t) {
    S.full = false; S.target = null; document.body.classList.remove("full"); modeBtn.setAttribute("aria-pressed", "false");
    idxItems.forEach(li => li.classList.remove("done"));
    S.i = t; print(build(ORDER[t]));
  }

  function reload() {
    S.state = "loading"; led.className = "led busy"; setLCD("NO PAPER", true);
    idxItems.forEach(li => li.classList.remove("done", "now"));
    setTimeout(() => {
      setLCD("LOADING ROLL"); sfx.feed(0.9);
      setTimeout(() => { S.roll++; S.i = 0; S.usedMM = 0; updateMeters(); print(build("arrival")); }, 1100);
    }, 1200);
  }

  function bindNote(r) {
    const form = r.rc.querySelector("#noteform"), inp = form.querySelector("textarea");
    inp.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const v = inp.value.trim().replace(/[ \t]+/g, " ").slice(0, 600);
      if (!v) { inp.focus(); return; }
      inp.blur();
      if (S.full) { location.href = mailto(v); return; }
      S.pendingNote = v; S.lastWasNote = true;
      setAngle(r, 0); tear(r, 1, 1.2);
    });
  }

  /* ---------------- controls ---------------- */
  function goTo(i) {
    if (S.state === "loading" || S.state === "tearing") return;
    if (S.full) { S.target = i; tear(S.cur, 1, 1); return; }
    if (i === S.i && S.cur && S.state === "ready") { scrollTo({ top: 0, behavior: "smooth" }); return; }
    S.target = i; tear(S.cur, i > S.i ? 1 : -1, 1);
  }
  function toggleFull() {
    if (S.state === "loading" || S.state === "tearing") return;
    sfx.click();
    if (S.full) { S.target = 0; tear(S.cur, -1, 1); return; }
    if (!S.cur) { printAll(); return; }
    tear(S.cur, 1, 1, printAll);
  }
  modeBtn.addEventListener("click", toggleFull);
  idx.addEventListener("click", e => { const b = e.target.closest("button[data-go]"); if (b) goTo(+b.dataset.go); });
  stage.addEventListener("click", e => {
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "all") { e.preventDefault(); if (!S.full) toggleFull(); return; }
    if (S.state === "printing" && !S.full && !e.target.closest("input,textarea,button,a")) fast = true;
  });
  feedBtn.addEventListener("click", () => {
    feedBtn.classList.add("press"); setTimeout(() => feedBtn.classList.remove("press"), 120);
    sfx.click();
    if (S.state === "printing" && !S.full) { instant = true; return; }
    if (S.state === "ready") tear(S.cur, Math.random() < 0.5 ? -1 : 1, 1);
  });
  addEventListener("keydown", e => {
    if (e.target.closest && e.target.closest("input,textarea")) return;
    if (S.state === "printing" && (e.key === " " || e.key === "Enter") && !e.target.closest("button,a")) { e.preventDefault(); instant = true; return; }
    if (S.state === "ready" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); tear(S.cur, e.key === "ArrowRight" ? 1 : -1, 1); }
  });
  let lastSY = scrollY, sway = 0, pillAcc = 0;
  addEventListener("scroll", () => {
    const r = S.cur; const v = scrollY - lastSY; lastSY = scrollY;
    pillAcc = Math.sign(v) === Math.sign(pillAcc) ? pillAcc + v : v;
    const atEnd = innerHeight + scrollY > document.documentElement.scrollHeight - 80;
    if (scrollY < 120 || atEnd || pillAcc < -40) modeBtn.classList.remove("away");
    else if (pillAcc > 40) modeBtn.classList.add("away");
    if (!r || S.state !== "ready" || r.dragging || reduce || S.full) return;
    sway += v * 0.004;
    if (Math.abs(sway) > 0.25) { cancelAnimationFrame(r.springRaf); spring(r, r.angle, Math.max(-6, Math.min(6, sway * 10))); sway = 0; }
  }, { passive: true });

  /* ---------------- boot ---------------- */
  setSound(false); updateMeters();
  const startFull = /[?&#](all|full)\b/.test(location.search + location.hash);
  const boot = () => {
    setLCD("WARMING UP"); led.className = "led";
    setTimeout(() => { startFull ? printAll() : print(build(ORDER[0])); }, reduce ? 50 : 700);
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(boot);
  window.__receipt = { state: () => S.state, tear: dir => S.cur && tear(S.cur, dir || 1, 1), fast: () => { instant = true; }, idx: () => S.i,
    order: () => ORDER.slice(), full: () => S.full, all: () => toggleFull(), go: i => goTo(i), live: () => live.eventsState };
})();
