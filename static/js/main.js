// Follow-the-Expert project page: polite video autoplay, the hero overview (muted preview, then sound on request),
// reading progress, the section rail, task tabs, synced comparisons, the interactive idea schematic, and the SVG
// result and ablation charts.
// Every number here is copied from RESULTS_FACTS.md (40 real rollouts per point).

(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SVGNS = "http://www.w3.org/2000/svg";

  // ---------- videos: play only while visible, never when the reader asked for less motion ----------
  const videos = Array.from(document.querySelectorAll("video.autoplay"));
  const watch = (els, onChange, threshold) => {
    if (!("IntersectionObserver" in window)) { onChange(true); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => onChange(e.isIntersecting, e.target)),
      { threshold: threshold || 0.25 });
    els.forEach((n) => io.observe(n));
  };
  if (reduceMotion) {
    videos.forEach((v) => { v.controls = true; v.removeAttribute("autoplay"); });
  } else {
    watch(videos, (on, v) => {
      if (on && !v.dataset.userPaused) v.play().catch(() => { v.controls = true; });
      else if (!on) v.pause();
    });
    // a click pauses or resumes a looping clip; the observer then leaves it alone
    videos.forEach((v) => v.addEventListener("click", () => {
      if (v.paused) { delete v.dataset.userPaused; v.play().catch(() => {}); }
      else { v.dataset.userPaused = "1"; v.pause(); }
    }));
  }

  // ---------- hero: the overview plays as a muted preview; the button restarts it with sound ----------
  const ov = document.getElementById("ov-video");
  const ovBtn = document.getElementById("ov-sound");
  if (ov && ovBtn) {
    const fig = ov.closest(".hero-video");
    let withSound = false;
    if (!reduceMotion) {
      watch([ov], (on) => {
        if (withSound) return;                    // never pause someone who is listening
        if (on) ov.play().catch(() => {}); else ov.pause();
      }, 0.2);
    }
    ovBtn.addEventListener("click", () => {
      withSound = true;
      fig.classList.add("is-playing");
      ov.loop = false;
      ov.muted = false;
      ov.controls = true;
      ov.currentTime = 0;
      ov.play().catch(() => {});
    });
  }

  // ---------- reading progress under the nav ----------
  const progress = document.getElementById("progress");
  if (progress) {
    let queued = false;
    const update = () => {
      const h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      progress.style.transform = `scaleX(${max > 0 ? Math.min(1, h.scrollTop / max) : 0})`;
      queued = false;
    };
    window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---------- section rail and nav: mark the section being read ----------
  const rail = document.getElementById("rail");
  const railLinks = rail ? Array.from(rail.querySelectorAll("a")) : [];
  const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
  const sections = railLinks.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const heroEl = document.querySelector(".hero");
  const darkEls = Array.from(document.querySelectorAll("main .dark, .site-footer"));
  if (rail && sections.length) {
    let queued = false;
    const update = () => {
      queued = false;
      const probe = window.innerHeight * 0.4;
      let idx = -1;
      sections.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= probe) idx = i; });
      railLinks.forEach((a, i) => {
        a.classList.toggle("is-active", i === idx);
        a.classList.toggle("is-past", i < idx);
      });
      const id = idx >= 0 ? sections[idx].id : "";
      navLinks.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`
        || (id === "obstacles" && a.getAttribute("href") === "#results")
        || (id === "range" && a.getAttribute("href") === "#ablations")));
      // the filled part of the rail's path runs to the active node
      const nodes = railLinks.map((a) => a.querySelector("i"));
      if (idx >= 0) {
        const top = nodes[0].getBoundingClientRect().top, cur = nodes[idx].getBoundingClientRect().top;
        rail.style.setProperty("--rail-fill", `${cur - top}px`);
      } else rail.style.setProperty("--rail-fill", "0px");
      rail.classList.toggle("is-visible", heroEl ? heroEl.getBoundingClientRect().bottom < window.innerHeight * 0.5 : true);
      const r = rail.getBoundingClientRect(), mid = (r.top + r.bottom) / 2;
      rail.classList.toggle("on-dark", darkEls.some((d) => { const b = d.getBoundingClientRect(); return b.top <= mid && b.bottom >= mid; }));
    };
    window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  // ---------- tab lists (arrow keys move between tabs) ----------
  function makeTabs(list, onSelect) {
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      onSelect(tab);
    };
    tabs.forEach((t, i) => {
      t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1;
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus();
        select(next);
      });
    });
  }
  function swap(video, name) {
    video.poster = `static/videos/${name}.jpg`;
    video.querySelector("source").src = `static/videos/${name}.mp4`;
    video.load();
  }

  // ---------- real robot: three synced clips, rates and bars per task ----------
  const compare = document.getElementById("compare");
  if (compare) {
    const cols = Array.from(compare.querySelectorAll(".cmp-col"));
    const vids = cols.map((c) => c.querySelector("video"));
    const note = document.getElementById("cmp-note");
    let visible = false, userPaused = false;
    const ready = () => Promise.all(vids.map((v) => (v.readyState >= 3 ? Promise.resolve()
      : new Promise((res) => v.addEventListener("canplay", res, { once: true })))));
    const playAll = () => {
      if (reduceMotion || userPaused) return;
      vids.forEach((v) => { v.currentTime = 0; });
      vids.forEach((v) => v.play().catch(() => {}));
    };
    const start = () => { vids.forEach((v) => { if (v.preload === "none") { v.preload = "auto"; v.load(); } }); ready().then(playAll); };
    if (reduceMotion) vids.forEach((v) => { v.controls = true; });
    // all three clips are padded to one length; when one ends, restart the set together
    vids.forEach((v) => v.addEventListener("ended", () => { if (visible) playAll(); }));
    vids.forEach((v) => v.addEventListener("click", () => {
      userPaused = !vids[0].paused;
      if (userPaused) vids.forEach((x) => x.pause()); else vids.forEach((x) => x.play().catch(() => {}));
    }));
    watch([compare], (on) => {
      visible = on;
      if (on) start(); else vids.forEach((v) => v.pause());
    }, 0.3);
    makeTabs(document.getElementById("real-tabs"), (tab) => {
      const task = tab.dataset.task;
      const rates = tab.dataset.rates.split(",");
      cols.forEach((col, i) => {
        swap(vids[i], `real_${task}_${col.dataset.method}`);
        col.querySelector(".js-rate").textContent = `${rates[i]}%`;
        col.querySelector(".bar i").style.width = `${rates[i]}%`;
      });
      note.innerHTML = "";
      const sp = document.createElement("span");
      sp.textContent = `One real rollout per policy, ${tab.dataset.speed} speed; the three clips start together. Bars: success over 40 rollouts.`;
      note.append(`${tab.dataset.note} `, sp);
      userPaused = false;
      if (visible) ready().then(playAll);
    });
  }

  // ---------- the idea: a 2-D schematic with real DMP rollouts ----------
  // Two phases (an approach arc, then a wipe) are each fitted as a DMP (Pastor et al. 2009 form, so a moved goal
  // causes no initial jump) whose forcing term is read straight off the expert curve. Moving the object moves both
  // phase boundaries; each phase replays the expert's forcing term toward its new boundary. The obstacle adds a
  // repulsive acceleration along the gradient of a Gaussian density.
  function explainer() {
    const host = document.getElementById("idea-demo");
    if (!host) return;
    const W = 640, H = 300;
    const S = [70, 250], C = [96, 40], B1 = [300, 128], B2 = [520, 150];
    const BOUND = [50, 34];                                  // object offset limits (px), drawn as the dashed box
    const OBS = { c: [140.5, 114.5], s: 22, k: 1e6 };        // sits on the expert's approach arc
    const N = 240, dt = 1 / N, AZ = 25, KS = AZ * AZ / 4, AS = 8, SETTLE = 90;   // alpha_z = 25, alpha_s = 8 as in the paper
    const phase = (i) => Math.exp(-AS * i * dt);
    const mj = (u) => u * u * u * (10 - 15 * u + 6 * u * u);
    const demo1 = [], demo2 = [];
    for (let i = 0; i <= N; i++) {
      const u = mj(i / N), w = 1 - u;
      demo1.push([w * w * S[0] + 2 * w * u * C[0] + u * u * B1[0], w * w * S[1] + 2 * w * u * C[1] + u * u * B1[1]]);
      demo2.push([B1[0] + (B2[0] - B1[0]) * u, B1[1] + (B2[1] - B1[1]) * u + 34 * Math.sin(6 * Math.PI * u)]);
    }
    // the forcing term that reproduces the demo exactly under the same Euler steps
    const fit = (demo) => {
      const g = demo[demo.length - 1], y0 = demo[0];
      return demo.map((y, i) => {
        const yp = demo[Math.max(0, i - 1)], yn = demo[Math.min(demo.length - 1, i + 1)];
        return [0, 1].map((k) => {
          const v = (y[k] - yp[k]) / dt, vn = (yn[k] - y[k]) / dt;
          return ((vn - v) / dt - KS * (g[k] - y[k]) + AZ * v + KS * (g[k] - y0[k]) * phase(i)) / KS;
        });
      });
    };
    const f1 = fit(demo1), f2 = fit(demo2);
    const rollout = (f, y0, v0, g, obs) => {
      const y = y0.slice(), v = v0.slice(), out = [y.slice()];
      for (let i = 0; i < f.length + SETTLE; i++) {
        const fi = f[i] || [0, 0];
        let r = [0, 0];
        if (obs) {
          const dx = y[0] - obs.c[0], dy = y[1] - obs.c[1], s2 = obs.s * obs.s;
          const rho = Math.exp(-(dx * dx + dy * dy) / (2 * s2));
          r = [obs.k * rho * dx / s2, obs.k * rho * dy / s2];
        }
        for (let k = 0; k < 2; k++) {
          v[k] += (KS * (g[k] - y[k]) - AZ * v[k] - KS * (g[k] - y0[k]) * phase(i) + KS * fi[k] + r[k]) * dt;
          y[k] += v[k] * dt;
        }
        out.push(y.slice());
      }
      return { path: out, v };
    };
    const d = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");

    // ---- static layer ----
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" }, host);
    const defs = el("defs", {}, svg);
    const pat = el("pattern", { id: "ex-grid", width: 20, height: 20, patternUnits: "userSpaceOnUse" }, defs);
    el("path", { d: "M20 0 L0 0 0 20", class: "ex-grid" }, pat);
    const grad = el("radialGradient", { id: "ex-halo" }, defs);
    el("stop", { offset: "0", class: "ex-halo-stop", "stop-opacity": "0.34" }, grad);
    el("stop", { offset: "1", class: "ex-halo-stop", "stop-opacity": "0" }, grad);
    el("rect", { x: 0, y: 0, width: W, height: H, rx: 10, class: "ex-bg" }, svg);
    el("rect", { x: 0, y: 0, width: W, height: H, rx: 10, fill: "url(#ex-grid)" }, svg);

    const OBJ = { x: B1[0] - 18, y: 80, w: B2[0] - B1[0] + 36, h: 120 };
    el("rect", { x: OBJ.x - BOUND[0], y: OBJ.y - BOUND[1], width: OBJ.w + 2 * BOUND[0], height: OBJ.h + 2 * BOUND[1], rx: 14, class: "ex-bounds" }, svg);
    text(svg, OBJ.x + OBJ.w + BOUND[0], OBJ.y + OBJ.h + BOUND[1] + 20, "sampling bounds", { class: "ex-label-muted ex-minor", "text-anchor": "end" });

    const obsG = el("g", { class: "ex-obs" }, svg);
    el("circle", { cx: OBS.c[0], cy: OBS.c[1], r: OBS.s * 2.6, fill: "url(#ex-halo)" }, obsG);
    el("circle", { cx: OBS.c[0], cy: OBS.c[1], r: 11, class: "ex-cup" }, obsG);
    text(obsG, OBS.c[0] - 30, OBS.c[1] - 22, "obstacle", { class: "ex-label", "text-anchor": "end" });

    const obj = el("g", { class: "obj", tabindex: 0, role: "button", "aria-label": "Object. Drag it, or use the arrow keys, to move the phase boundaries." }, svg);
    el("rect", { x: OBJ.x, y: OBJ.y, width: OBJ.w, height: OBJ.h, rx: 12, class: "ex-obj" }, obj);
    text(obj, OBJ.x + 12, OBJ.y + 22, "object \u00b7 drag me", { class: "ex-label" });

    el("path", { d: d(demo1.concat(demo2)), class: "ex-expert" }, svg);
    const plan = el("path", { class: "ex-plan" }, svg);
    const fte = el("path", { class: "ex-fte" }, svg);
    const n1 = el("circle", { r: 5.5, class: "ex-node" }, svg);
    const n2 = el("circle", { r: 5.5, class: "ex-node" }, svg);
    el("circle", { cx: S[0], cy: S[1], r: 6, class: "ex-start" }, svg);
    text(svg, S[0] + 14, S[1] + 5, "start", { class: "ex-label" });
    const dot = el("circle", { r: 6.5, class: "ex-dot" }, svg);

    // ---- state ----
    let off = [0, 0], showObs = false, showPlan = true, auto = !reduceMotion, visible = false;
    let path = [], tween = null, lastSample = 0, t0 = performance.now(), running = false;
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    function render() {
      const g1 = [B1[0] + off[0], B1[1] + off[1]], g2 = [B2[0] + off[0], B2[1] + off[1]];
      const a = rollout(f1, S, [0, 0], g1, showObs ? OBS : null);
      const b = rollout(f2, a.path[a.path.length - 1], a.v, g2, null);
      path = a.path.concat(b.path);
      fte.setAttribute("d", d(path));
      plan.setAttribute("d", d([S, g1, g2]));
      plan.style.display = showPlan ? "" : "none";
      obsG.style.display = showObs ? "" : "none";
      obj.setAttribute("transform", `translate(${off[0].toFixed(1)},${off[1].toFixed(1)})`);
      n1.setAttribute("cx", g1[0]); n1.setAttribute("cy", g1[1]);
      n2.setAttribute("cx", g2[0]); n2.setAttribute("cy", g2[1]);
    }
    const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
    function sample(now) {
      const to = [(Math.random() * 2 - 1) * BOUND[0], (Math.random() * 2 - 1) * BOUND[1]];
      if (reduceMotion) { off = to; render(); return; }
      tween = { from: off.slice(), to, start: now || performance.now() };
    }
    function frame(now) {
      if (tween) {
        const u = Math.min(1, (now - tween.start) / 900), e = ease(u);
        off = [tween.from[0] + (tween.to[0] - tween.from[0]) * e, tween.from[1] + (tween.to[1] - tween.from[1]) * e];
        render();
        if (u >= 1) { tween = null; lastSample = now; }
      } else if (auto && visible && now - lastSample > 2600) {
        sample(now);
      }
      // a gripper dot runs along the FTE path, about 3 s per pass
      if (!reduceMotion && path.length) {
        const i = Math.floor((((now - t0) / 3200) % 1) * path.length);
        dot.setAttribute("cx", path[i][0]); dot.setAttribute("cy", path[i][1]);
      }
      if (visible) requestAnimationFrame(frame); else running = false;
    }
    if (reduceMotion) dot.style.display = "none";
    render();
    watch([host], (on) => {
      const was = visible;
      visible = on;
      if (on && !was && !running) { running = true; lastSample = performance.now(); requestAnimationFrame(frame); }
    }, 0.2);

    // ---- drag and keys ----
    const toSvg = (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };
    let grab = null;
    obj.addEventListener("pointerdown", (e) => {
      auto = false; tween = null;
      const p = toSvg(e);
      grab = { x: p.x - off[0], y: p.y - off[1] };
      obj.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    obj.addEventListener("pointermove", (e) => {
      if (!grab) return;
      const p = toSvg(e);
      off = [clamp(p.x - grab.x, BOUND[0]), clamp(p.y - grab.y, BOUND[1])];
      render();
    });
    const release = () => { grab = null; };
    obj.addEventListener("pointerup", release);
    obj.addEventListener("pointercancel", release);
    obj.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key];
      if (!step) return;
      e.preventDefault();
      auto = false; tween = null;
      off = [clamp(off[0] + step[0], BOUND[0]), clamp(off[1] + step[1], BOUND[1])];
      render();
    });

    // ---- buttons ----
    const toggle = (id, fn) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", on ? "true" : "false");
        fn(on);
        render();
      });
    };
    toggle("idea-obs", (on) => { showObs = on; });
    toggle("idea-plan", (on) => { showPlan = on; });
    const nb = document.getElementById("idea-sample");
    if (nb) nb.addEventListener("click", () => { auto = false; sample(); });
  }

  // ---------- tiny SVG helpers ----------
  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, attrs) {
    const t = el("text", Object.assign({ x, y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }
  function tooltip(host) {
    const tip = document.createElement("div");
    tip.className = "tip";
    host.appendChild(tip);
    return {
      show(evt, msg) {
        const r = host.getBoundingClientRect();
        tip.textContent = msg;
        tip.style.left = `${evt.clientX - r.left}px`;
        tip.style.top = `${evt.clientY - r.top}px`;
        tip.style.opacity = 1;
      },
      hide() { tip.style.opacity = 0; },
    };
  }
  const METHODS = [
    { key: "fte", label: "FTE (ours)", color: () => css("--fte"), marker: "circle" },
    { key: "trajopt", label: "TrajOpt", color: () => css("--trajopt"), marker: "square" },
    { key: "mplib", label: "MPLib", color: () => css("--mplib"), marker: "triangle" },
  ];
  function marker(g, kind, x, y, r, color, hollow) {
    const common = { fill: hollow ? css("--card") : color, stroke: hollow ? color : css("--card"), "stroke-width": hollow ? 2 : 1.2 };
    if (kind === "circle") return el("circle", Object.assign({ cx: x, cy: y, r }, common), g);
    if (kind === "square") return el("rect", Object.assign({ x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8 }, common), g);
    const h = r * 1.15;
    return el("path", Object.assign({ d: `M${x},${y - h} L${x + h},${y + h * 0.8} L${x - h},${y + h * 0.8} Z` }, common), g);
  }

  // ---------- pooled success bars ----------
  function drawPooled() {
    const host = document.getElementById("pooled-chart");
    if (!host) return;
    host.querySelectorAll("svg, .tip").forEach((n) => n.remove());
    const groups = [
      { title: "Four shape-sensitive tasks", rows: [["fte", 75.6, "121/160"], ["trajopt", 40.0, "64/160"], ["mplib", 3.8, "6/160"]] },
      { title: "Two endpoint-dominated controls", rows: [["fte", 91.3, "73/80"], ["trajopt", 91.3, "73/80"], ["mplib", 91.3, "73/80"]] },
    ];
    const W = 420, labelW = 78, barMax = W - labelW - 48, rowH = 22, gap = 3;
    const H = groups.length * (26 + 3 * (rowH + gap)) + 8;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" }, host);
    const tip = tooltip(host);
    let y = 0;
    groups.forEach((g) => {
      text(svg, 0, y + 14, g.title, { "font-size": 13, "font-weight": 600, fill: css("--ink") });
      y += 24;
      g.rows.forEach(([key, val, frac]) => {
        const m = METHODS.find((mm) => mm.key === key);
        text(svg, 0, y + rowH * 0.7, m.label, { "font-size": 12.5, fill: css("--ink-2") });
        el("rect", { x: labelW, y: y + 3, width: barMax, height: rowH - 6, fill: css("--paper-2"), rx: 2 }, svg);
        const bar = el("rect", { x: labelW, y: y + 3, width: Math.max(2, barMax * val / 100), height: rowH - 6, fill: m.color(), rx: 2 }, svg);
        text(svg, labelW + barMax * val / 100 + 6, y + rowH * 0.7, `${val.toFixed(1)}%`,
          { "font-size": 12.5, "font-weight": key === "fte" ? 600 : 400, fill: css("--ink"), "font-variant-numeric": "tabular-nums" });
        const hit = el("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, svg);
        const msg = `${m.label}: ${frac} real rollouts succeeded`;
        hit.addEventListener("mousemove", (e) => tip.show(e, msg));
        hit.addEventListener("mouseleave", () => tip.hide());
        bar.setAttribute("aria-label", msg);
        y += rowH + gap;
      });
      y += 10;
    });
  }

  // ---------- coverage chart (two panels) ----------
  function drawCoverage() {
    const host = document.getElementById("coverage-chart");
    if (!host) return;
    host.querySelectorAll("svg, .tip").forEach((n) => n.remove());
    const data = {
      fixed: { xs: [1, 1.2, 1.4, 1.6], fte: [92.5, 82.5, 35.0, 7.5], trajopt: [75.0, 62.5, 27.5, 0.0], mplib: [12.5, 2.5, 0.0, 0.0] },
      window: { xs: [1, 1.5, 2], fte: [92.5, 87.5, 65.0], trajopt: [75.0, 70.0, 57.5], mplib: [12.5, 10.0, 2.5] },
      budget1000: { fte: 95.0, trajopt: 77.5, mplib: 15.0 },
    };
    const W = 480, H = 270, top = 46, bottom = 46, left = 34, gapX = 26;
    const pw = (W - left - gapX - 6) / 2, ph = H - top - bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" }, host);
    const tip = tooltip(host);
    const ink = css("--ink"), ink2 = css("--ink-2"), rule = css("--rule"), muted = css("--muted");

    // legend
    let lx = left;
    METHODS.forEach((m) => {
      el("line", { x1: lx, y1: 12, x2: lx + 18, y2: 12, stroke: m.color(), "stroke-width": 2.4 }, svg);
      marker(svg, m.marker, lx + 9, 12, 3.6, m.color(), false);
      text(svg, lx + 24, 16, m.label, { "font-size": 12.5, fill: ink2 });
      lx += m.label.length * 7.2 + 44;
    });

    const y = (v) => top + ph * (1 - v / 100);
    function panel(x0, title, xTicks, xLabel) {
      const g = el("g", {}, svg);
      text(g, x0, top - 10, title, { "font-size": 13, "font-weight": 600, fill: ink });
      [0, 25, 50, 75, 100].forEach((v) => {
        el("line", { x1: x0, x2: x0 + pw, y1: y(v), y2: y(v), stroke: rule, "stroke-width": 1 }, g);
        if (x0 === left) text(g, x0 - 6, y(v) + 4, `${v}`, { "font-size": 11, fill: muted, "text-anchor": "end" });
      });
      xTicks.forEach(([px, lab]) => text(g, px, top + ph + 16, lab, { "font-size": 11.5, fill: ink2, "text-anchor": "middle" }));
      text(g, x0 + pw / 2, top + ph + 34, xLabel, { "font-size": 11.5, fill: muted, "text-anchor": "middle" });
      return g;
    }
    function series(g, xsPx, vals, m, labels) {
      const d = vals.map((v, i) => `${i ? "L" : "M"}${xsPx[i]},${y(v)}`).join(" ");
      el("path", { d, fill: "none", stroke: m.color(), "stroke-width": 2.2, "stroke-linejoin": "round" }, g);
      vals.forEach((v, i) => {
        marker(g, m.marker, xsPx[i], y(v), 4, m.color(), false);
        const hit = el("circle", { cx: xsPx[i], cy: y(v), r: 11, fill: "transparent" }, g);
        hit.addEventListener("mousemove", (e) => tip.show(e, `${m.label}, ${labels[i]}: ${v.toFixed(1)}%`));
        hit.addEventListener("mouseleave", () => tip.hide());
      });
    }

    // (a) fixed 1x policy, objects moved out
    const ax0 = left;
    const ax = (v) => ax0 + 12 + (pw - 24) * (v - 1) / 0.6;
    const ga = panel(ax0, "(a) Fixed 1× policy", data.fixed.xs.map((v) => [ax(v), `${v}×`]), "object offset (× bounds)");
    METHODS.forEach((m) => series(ga, data.fixed.xs.map(ax), data.fixed[m.key], m, data.fixed.xs.map((v) => `offset ${v}×`)));

    // (b) retrained on wider windows (256 demos), then 1,000 demos at 2x
    const bx0 = left + pw + gapX;
    const bx = (v) => bx0 + 12 + (pw - 66) * (v - 1) / 1.0;
    const bx1000 = bx0 + pw - 12;
    const gb = panel(bx0, "(b) Retrained wider",
      [[bx(1), "1×"], [bx(1.5), "1.5×"], [bx(2), "2×"], [bx1000, "1,000"]], "window (× bounds), 256 demos");
    // the 1,000-demo points change the budget, not the window: unconnected, behind a divider
    const div = (bx(2) + bx1000) / 2;
    el("line", { x1: div, x2: div, y1: top, y2: top + ph, stroke: muted, "stroke-width": 1, "stroke-dasharray": "2 3" }, gb);
    METHODS.forEach((m) => {
      series(gb, data.window.xs.map(bx), data.window[m.key], m, data.window.xs.map((v) => `${v}× window, 256 demos`));
      const v1 = data.budget1000[m.key];
      marker(gb, m.marker, bx1000, y(v1), 4.6, m.color(), true);
      const hit = el("circle", { cx: bx1000, cy: y(v1), r: 11, fill: "transparent" }, gb);
      hit.addEventListener("mousemove", (e) => tip.show(e, `${m.label}, 2× window, 1,000 demos: ${v1.toFixed(1)}%`));
      hit.addEventListener("mouseleave", () => tip.hide());
    });
  }

  // ---------- ablations (section 08): labeled bar panels, one line chart ----------
  // Every bar row carries a text label, so identity never rests on color alone.
  const ablN = { oa: 500, proxy: 500 };
  function ablSpec(name) {
    const fte = css("--fte"), tro = css("--trajopt"), mpl = css("--mplib"), muted = css("--muted");
    if (name === "oa") {  // FTE with and without its density term; obstacle absent from the demo
      const d = {
        256: [["Sweep Clean", [2.5, 87.5], [80.0, 10.0]], ["Push–Pick–Place", [0.0, 97.5], [50.0, 20.0]],
              ["Sponge Pick–Place", [5.0, 92.5], [85.0, 7.5]], ["Stove", [15.0, 82.5], [80.0, 7.5]]],
        500: [["Sweep Clean", [7.5, 82.5], [95.0, 7.5]], ["Push–Pick–Place", [2.5, 95.0], [82.5, 12.5]],
              ["Sponge Pick–Place", [12.5, 87.5], [95.0, 2.5]], ["Stove", [17.5, 77.5], [97.5, 2.5]]],
      }[ablN.oa];
      return { panels: ["Success ↑", "Collisions ↓"],
        groups: d.map(([t, off, on]) => ({ title: t, rows: [
          { label: "No density term", color: muted, vals: off }, { label: "FTE (full)", color: fte, vals: on, strong: true }] })) };
    }
    if (name === "warp") {  // shape-preserving retargeting ablation, obstacle-free, 256 demos
      const rows = (v) => [
        { label: "MPLib", color: mpl, vals: [v[0]] }, { label: "TrajOpt", color: tro, vals: [v[1]] },
        { label: "Affine warp", color: fte, opacity: 0.4, vals: [v[2]] }, { label: "Spline warp", color: fte, opacity: 0.62, vals: [v[3]] },
        { label: "FTE (DMP)", color: fte, vals: [v[4]], strong: true }];
      return { panels: ["Success ↑"], note: "256 demos, no obstacle",
        groups: [{ title: "Sweep Clean", rows: rows([12.5, 75.0, 87.5, 92.5, 92.5]) },
                 { title: "Push–Pick–Place", rows: rows([2.5, 30.0, 65.0, 72.5, 75.0]) }] };
    }
    // MPLib given a 3DGS obstacle proxy, with an obstacle absent from the demo
    const d = {
      256: { sweep: [[0.0, 87.5], [5.0, 12.5], [67.5, 30.0], [80.0, 10.0]], ppp: [[0.0, 100.0], [0.0, 32.5], [30.0, 67.5], [50.0, 20.0]] },
      500: { sweep: [[0.0, 82.5], [17.5, 2.5], [82.5, 22.5], [95.0, 7.5]], ppp: [[0.0, 97.5], [10.0, 5.0], [35.0, 60.0], [82.5, 12.5]] },
    }[ablN.proxy];
    const rows = (v) => [
      { label: "MPLib", color: mpl, vals: v[0] }, { label: "MPLib + 3DGS proxy", color: mpl, opacity: 0.5, vals: v[1] },
      { label: "TrajOpt", color: tro, vals: v[2] }, { label: "FTE", color: fte, vals: v[3], strong: true }];
    return { panels: ["Success ↑", "Collisions ↓"],
      groups: [{ title: "Sweep Clean", rows: rows(d.sweep) }, { title: "Push–Pick–Place", rows: rows(d.ppp) }] };
  }

  // phones get a narrower drawing, and two-panel charts stack their panels, so the text stays readable
  const narrowHost = (host) => host.clientWidth < 440;
  function drawBars(id, spec) {
    const host = document.getElementById(id);
    if (!host) return;
    host.querySelectorAll("svg, .tip").forEach((n) => n.remove());
    const tip = tooltip(host);
    if (!narrowHost(host)) { barPanels(host, tip, spec, 440); return; }
    spec.panels.forEach((t, p) => barPanels(host, tip, Object.assign({}, spec, {
      note: p ? "" : spec.note, panels: [t],
      groups: spec.groups.map((g) => ({ title: g.title, rows: g.rows.map((r) => Object.assign({}, r, { vals: [r.vals[p]] })) })),
    }), 330));
  }
  function barPanels(host, tip, spec, W) {
    const labelW = 128, gap = 20, rowH = 19, groupGap = 9, head = 24;
    const pw = (W - labelW - gap * (spec.panels.length - 1)) / spec.panels.length, barW = pw - 34;
    const nRows = spec.groups.reduce((a, g) => a + g.rows.length, 0);
    const H = head + spec.groups.length * (18 + groupGap) + nRows * rowH - groupGap;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" }, host);
    const ink = css("--ink"), ink2 = css("--ink-2"), muted = css("--muted"), rule = css("--rule");
    if (spec.note) text(svg, 0, 13, spec.note, { "font-size": 12, fill: muted });
    spec.panels.forEach((t, p) => {
      const x0 = labelW + p * (pw + gap);
      text(svg, x0, 13, t, { "font-size": 12.5, "font-weight": 600, fill: ink });
      [0, 50, 100].forEach((v) => el("line", { x1: x0 + barW * v / 100, x2: x0 + barW * v / 100, y1: head - 4, y2: H,
        stroke: rule, "stroke-width": 1, "stroke-dasharray": v ? "2 3" : "" }, svg));
    });
    let y = head;
    spec.groups.forEach((g) => {
      text(svg, 0, y + 13, g.title, { "font-size": 12.5, "font-weight": 600, fill: ink });
      y += 18;
      g.rows.forEach((r) => {
        text(svg, 10, y + rowH * 0.7, r.label, { "font-size": 12.5, fill: ink2, "font-weight": r.strong ? 600 : 400 });
        r.vals.forEach((v, p) => {
          const x0 = labelW + p * (pw + gap);
          el("rect", { x: x0, y: y + 3, width: Math.max(1.5, barW * v / 100), height: rowH - 7, rx: 2, fill: r.color,
            "fill-opacity": r.opacity || 1 }, svg);
          text(svg, x0 + barW * v / 100 + 5, y + rowH * 0.7, v.toFixed(1),
            { "font-size": 11.5, "font-weight": r.strong ? 600 : 400, fill: ink, "font-variant-numeric": "tabular-nums" });
        });
        const msg = `${g.title}, ${r.label}: ` +
          r.vals.map((v, p) => `${spec.panels[p].replace(/ [↑↓]/, "").toLowerCase()} ${v.toFixed(1)}%`).join(", ");
        const hit = el("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, svg);
        hit.addEventListener("mousemove", (e) => tip.show(e, msg));
        hit.addEventListener("mouseleave", () => tip.hide());
        y += rowH;
      });
      y += groupGap;
    });
  }

  // segmentation sensitivity: worst |change in mean position DTW| over the +/- shift, 100 synthesized trajectories per task
  function drawSeg() {
    const host = document.getElementById("abl-seg");
    if (!host) return;
    host.querySelectorAll("svg, .tip").forEach((n) => n.remove());
    const xs = [0.2, 0.4, 0.6, 0.8, 1.0];
    const ink = css("--ink"), ink2 = css("--ink-2"), muted = css("--muted"), rule = css("--rule");
    const series = [
      { label: "Sweep Clean", vals: [1.5, 1.3, 0.9, 0.3, 0.7], color: ink2, dash: "" },
      { label: "Push–Pick–Place", vals: [0.5, 0.3, 1.3, 1.2, 1.2], color: ink2, dash: "5 4" },
      { label: "Writing “A”", vals: [1.4, 2.4, 5.2, 21.1, 14.2], color: css("--accent"), dash: "" },
    ];
    const narrow = narrowHost(host);
    const W = narrow ? 330 : 440, legendRows = narrow ? 2 : 1, top = 26 + 18 * legendRows, bottom = 40, left = 30, right = 12;
    const H = top + 148 + bottom, pw = W - left - right, ph = H - top - bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" }, host);
    const tip = tooltip(host);
    const x = (v) => left + 10 + (pw - 20) * (v - 0.2) / 0.8, y = (v) => top + ph * (1 - v / 22);
    let lx = left, ly = 12;
    series.forEach((s) => {
      const w = s.label.length * 6.4 + 40;
      if (lx + w > W) { lx = left; ly += 18; }
      el("line", { x1: lx, y1: ly, x2: lx + 20, y2: ly, stroke: s.color, "stroke-width": 2.2, "stroke-dasharray": s.dash }, svg);
      text(svg, lx + 26, ly + 4, s.label, { "font-size": 12.5, fill: ink2 });
      lx += w;
    });
    text(svg, left, top - 10, "Largest change in position DTW to the expert (mm)", { "font-size": 12, fill: muted });
    [0, 5, 10, 15, 20].forEach((v) => {
      el("line", { x1: left, x2: left + pw, y1: y(v), y2: y(v), stroke: rule, "stroke-width": 1 }, svg);
      text(svg, left - 6, y(v) + 4, `${v}`, { "font-size": 11, fill: muted, "text-anchor": "end" });
    });
    xs.forEach((v) => text(svg, x(v), top + ph + 16, `${v.toFixed(1)} s`, { "font-size": 11.5, fill: ink2, "text-anchor": "middle" }));
    text(svg, left + pw / 2, top + ph + 33, "every phase boundary shifted by (worse of ±)", { "font-size": 11.5, fill: muted, "text-anchor": "middle" });
    series.forEach((s) => {
      el("path", { d: s.vals.map((v, i) => `${i ? "L" : "M"}${x(xs[i])},${y(v)}`).join(" "), fill: "none", stroke: s.color,
        "stroke-width": 2.2, "stroke-dasharray": s.dash, "stroke-linejoin": "round" }, svg);
      s.vals.forEach((v, i) => {
        el("circle", { cx: x(xs[i]), cy: y(v), r: 3.4, fill: s.color, stroke: css("--card"), "stroke-width": 1.2 }, svg);
        const hit = el("circle", { cx: x(xs[i]), cy: y(v), r: 10, fill: "transparent" }, svg);
        hit.addEventListener("mousemove", (e) => tip.show(e, `${s.label}, ${xs[i].toFixed(1)} s shift: ${v.toFixed(1)} mm`));
        hit.addEventListener("mouseleave", () => tip.hide());
      });
    });
    text(svg, x(0.8) - 8, y(21.1) + 4, "Writing “A”", { "font-size": 12, "font-weight": 600, fill: ink, "text-anchor": "end" });
  }

  function drawAblations() {
    drawBars("abl-oa", ablSpec("oa"));
    drawBars("abl-warp", ablSpec("warp"));
    drawBars("abl-proxy", ablSpec("proxy"));
    drawSeg();
  }
  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(drawAblations, 150); });
  document.querySelectorAll(".abl-ctrl .chip").forEach((b) => b.addEventListener("click", () => {
    const name = b.dataset.chart;
    ablN[name] = Number(b.dataset.n);
    b.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b ? "true" : "false"));
    drawBars(`abl-${name}`, ablSpec(name));
  }));

  function drawAll() { drawPooled(); drawCoverage(); drawAblations(); }
  drawAll();
  explainer();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAll);
})();
