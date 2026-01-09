(() => {
  "use strict";

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const canvas = $("simCanvas");
  const toast = $("toast");
  const simStatus = $("simStatus");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const logEl = $("eventLog");

  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  // ===== Helpers =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;

  const fmt = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();

  // ===== Remove any legacy inspector UI if it exists anywhere (hard kill) =====
  (function killLegacyUI(){
    const removeIt = () => {
      const selectors = [
        "#inspector", ".inspector", "#toggleInspector", "#inspectorBody",
        "#colonyInspector", "#traitsPanel", "#dnaPanel",
        ".colonyInspector", ".traitsPanel", ".dnaPanel"
      ];
      document.querySelectorAll(selectors.join(",")).forEach(el => el.remove());

      // also kill any overlay that looks like the old panel
      document.querySelectorAll("div,section,aside").forEach(el => {
        const t = (el.textContent || "").trim();
        if (t.startsWith("Selected") && t.includes("Colony #") && t.includes("DNA")) el.remove();
      });
    };
    removeIt();
    window.addEventListener("load", removeIt);
    new MutationObserver(removeIt).observe(document.documentElement, { childList:true, subtree:true });
  })();

  // ===== Event Log (SIM ONLY; no buy/sell spam) =====
  const LOG_CAP = 14;
  let lastLog = { msg: "", t: 0, count: 0 };

  function logSim(msg, tag = "EVENT") {
    if (!logEl) return;

    const now = Date.now();
    if (msg === lastLog.msg && now - lastLog.t < 1200) {
      lastLog.count++;
      const top = logEl.firstChild;
      if (top) top.innerHTML = `<span class="tag">${tag}:</span> ${msg} <span style="opacity:.7">(x${lastLog.count})</span>`;
      lastLog.t = now;
      return;
    }

    lastLog = { msg, t: now, count: 1 };

    const row = document.createElement("div");
    row.className = "eventRow";
    row.innerHTML = `<span class="tag">${tag}:</span> ${msg}`;
    logEl.prepend(row);

    while (logEl.children.length > LOG_CAP) logEl.removeChild(logEl.lastChild);
  }

  // ===== iOS Audio (unlocks after first user gesture) =====
  let audioCtx = null;
  let audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioUnlocked = true;
      if (toast) toast.textContent = "Audio ✓";
      // tiny silent tick to unlock
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.value = 0.0001;
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.02);
    } catch {
      // ignore
    }
  }

  function sfx(type = "event") {
    if (!audioUnlocked || !audioCtx) return;

    const t = audioCtx.currentTime;
    const o1 = audioCtx.createOscillator();
    const o2 = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const lp = audioCtx.createBiquadFilter();

    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);

    const base = (type === "mutation") ? 420 : (type === "colony") ? 260 : 320;
    const up = (type === "boss") ? 1.8 : 1.35;

    o1.type = "sine";
    o2.type = "triangle";

    o1.frequency.setValueAtTime(base, t);
    o1.frequency.exponentialRampToValueAtTime(base * up, t + 0.08);

    o2.frequency.setValueAtTime(base * 0.5, t);
    o2.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.10);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);

    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(audioCtx.destination);

    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.22);
    o2.stop(t + 0.22);
  }

  // Unlock audio on first interaction
  window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
  window.addEventListener("touchstart", unlockAudio, { once: true, passive: true });

  // ===== Canvas sizing =====
  let W = 1, H = 1, DPR = 1;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // rebuild space bg
    buildSpaceBG();
  }

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));

  // ===== Space Background (stars + nebula) =====
  let spaceBG = null;

  function buildSpaceBG() {
    const w = Math.ceil(W);
    const h = Math.ceil(H);
    spaceBG = document.createElement("canvas");
    spaceBG.width = w;
    spaceBG.height = h;
    const b = spaceBG.getContext("2d");

    // base
    b.clearRect(0, 0, w, h);
    b.fillStyle = "rgba(0,0,0,1)";
    b.fillRect(0, 0, w, h);

    // nebulas (soft radial blobs)
    for (let i = 0; i < 6; i++) {
      const cx = rand(0, w);
      const cy = rand(0, h);
      const r = rand(Math.min(w, h) * 0.22, Math.min(w, h) * 0.55);
      const hue = [200, 155, 280, 120][randi(0, 3)];
      const g = b.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `hsla(${hue}, 90%, 55%, ${rand(0.09, 0.16)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = g;
      b.beginPath();
      b.arc(cx, cy, r, 0, Math.PI * 2);
      b.fill();
    }

    // stars (tiny + bright)
    const starCount = Math.floor((w * h) / 1400);
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const s = Math.random() < 0.08 ? rand(1.2, 2.0) : rand(0.6, 1.2);
      const a = Math.random() < 0.08 ? rand(0.55, 0.9) : rand(0.12, 0.45);
      b.fillStyle = `rgba(255,255,255,${a})`;
      b.beginPath();
      b.arc(x, y, s, 0, Math.PI * 2);
      b.fill();
    }

    // subtle vignette
    const vg = b.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    b.fillStyle = vg;
    b.fillRect(0, 0, w, h);
  }

  // ===== Economy / triggers =====
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  const MAX_COLONIES = 8;
  const MC_STEP = 50000;
  let nextSplitAt = MC_STEP;
  let bossSpawned = false;

  function growthScore() {
    return (mcap / 20000) + (volume / 6000) + (buyers / 10);
  }

  // ===== Camera + interaction =====
  let camX = 0, camY = 0, zoom = 0.78;
  let selected = 0;
  let focusOn = false;

  // pointer state for smooth drag + pinch
  const pointers = new Map();
  let lastPan = null;
  let lastPinchDist = null;
  let isInteracting = false;

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function toWorld(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const d = dist2(wx, wy, c.x, c.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 260 * 260) ? best : -1;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, canvasPoint(e));
    isInteracting = true;

    if (pointers.size === 1) {
      lastPan = canvasPoint(e);
      lastPinchDist = null;
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      lastPan = null;
    }
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, canvasPoint(e));

    if (pointers.size === 1 && lastPan) {
      const p = canvasPoint(e);
      const dx = p.x - lastPan.x;
      const dy = p.y - lastPan.y;
      lastPan = p;

      camX += dx / zoom;
      camY += dy / zoom;

    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);

      if (lastPinchDist) {
        const k = d / lastPinchDist;
        const newZoom = clamp(zoom * k, 0.6, 2.6);
        zoom = newZoom;
      }
      lastPinchDist = d;
      lastPan = null;
    }
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      isInteracting = false;

      // tap select colony (use final pointer position)
      const p = canvasPoint(e);
      const w = toWorld(p.x, p.y);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        logSim(`Selected Colony #${idx + 1}`, "EVENT");
        if (focusOn) centerOnSelected(false);
      }

      lastPan = null;
      lastPinchDist = null;
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    pointers.clear();
    isInteracting = false;
    lastPan = null;
    lastPinchDist = null;
  }, { passive: true });

  // double tap center
  let lastTap = 0;
  canvas.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

  // wheel zoom (desktop)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.6, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    if (!smooth) {
      camX = -c.x;
      camY = -c.y;
      return;
    }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

  // ===== Colony / worm models =====
  function makeDNA(col) {
    // stable DNA string (fixes “DNA —” issues)
    const parts = [
      Math.floor(((col.dna.hue + 1) * 997) % 10000).toString(16).toUpperCase().padStart(3, "0"),
      Math.floor(col.dna.chaos * 999).toString(16).toUpperCase().padStart(3, "0"),
      Math.floor(col.dna.drift * 999).toString(16).toUpperCase().padStart(3, "0"),
      Math.floor(col.dna.aura * 999).toString(16).toUpperCase().padStart(3, "0"),
      Math.floor(col.dna.limbiness * 999).toString(16).toUpperCase().padStart(3, "0")
    ];
    return parts.join("-").slice(0, 18).toUpperCase();
  }

  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.55, 1.35),
      drift: rand(0.55, 1.35),
      aura: rand(0.95, 1.8),
      limbiness: rand(0.25, 1.1),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON
