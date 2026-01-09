/* ================================
   REMOVE LEGACY "OLD UI" PANEL
   (keeps all sim mechanics intact)
================================== */
(function removeOldInspectorUI() {
  const SELECTORS = [
    "#selectedPanel",
    "#inspector",
    "#colonyInspector",
    "#traitsPanel",
    ".selected-panel",
    ".inspector",
    ".colony-inspector",
    ".traits-panel",
    "[data-ui='legacy']",
    "[data-panel='legacy']",
  ];

  function nuke() {
    // 1) Remove by known selectors
    for (const sel of SELECTORS) {
      document.querySelectorAll(sel).forEach(el => el.remove());
    }

    // 2) Remove any panel that looks like the old inspector (text fingerprint)
    document.querySelectorAll("div, section, aside").forEach(el => {
      const t = (el.innerText || "").trim();
      if (!t) return;

      const looksLikeOld =
        t.includes("Selected") &&
        t.includes("Colony") &&
        t.includes("DNA") &&
        t.includes("Temperament") &&
        t.includes("Biome") &&
        t.includes("Style") &&
        t.includes("Mutations");

      if (looksLikeOld) el.remove();
    });
  }

  // run now + after DOM settles
  nuke();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", nuke, { once: true });
  } else {
    setTimeout(nuke, 0);
  }

  // Keep removing it if anything recreates it
  const obs = new MutationObserver(() => nuke());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
(() => {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================= */
  const LOGO_URL =
    "https://i.postimg.cc/hGj8JD0V/1614F03F-52AD-453C-8DB1-09A3B29F3469.png";

  const MAX_COLONIES = 8;
  const MC_STEP = 50000;          // new colony each +50k MC
  const BOSS_AT = 50000;          // boss worm appears at 50k MC

  const WORLD_HALF = 3200;        // "space feel" world size
  const GRID_STEP = 220;          // grid spacing in world units

  const RENDER_FPS = 40;          // cap render for iPhone smoothness
  const DPR_CAP = 2;              // cap DPR to prevent massive canvas on iOS

  /* =========================================================
     HELPERS
  ========================================================= */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;
  const safeNum = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);
  const fmt = (n) => "$" + Math.max(0, Math.round(safeNum(n, 0))).toLocaleString();
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  // angle helpers
  const TAU = Math.PI * 2;
  const angNorm = (a) => {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  };

  /* =========================================================
     DOM + DEBUG
  ========================================================= */
  const canvas = $("simCanvas") || $("c");
  if (!canvas) {
    console.error("Canvas not found (#simCanvas).");
    return;
  }
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) {
    console.error("Canvas 2D context failed.");
    return;
  }

  // optional debug chip (if you have #dbg in HTML it will use it)
  let dbg = $("dbg");
  if (!dbg) {
    dbg = document.createElement("div");
    dbg.style.cssText = `
      position:fixed; left:12px; top:12px; z-index:999999;
      padding:8px 10px; border-radius:12px;
      background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.18);
      color:rgba(235,240,248,.92); font:800 12px/1.1 system-ui, -apple-system, Inter, sans-serif;
      backdrop-filter: blur(10px);
    `;
    dbg.textContent = "Loading…";
    document.body.appendChild(dbg);
  }
  const setDbg = (t, bad = false) => {
    dbg.textContent = t;
    dbg.style.background = bad ? "rgba(120,0,20,.55)" : "rgba(0,0,0,.55)";
  };

  function showErr(e) {
    console.error(e);
    setDbg("JS ERROR ✕ " + (e?.message || e), true);
  }
  window.addEventListener("error", (ev) => showErr(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => showErr(ev.reason));

  /* =========================================================
     STATS ELEMENTS (optional)
  ========================================================= */
  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const logEl = $("log");

  /* =========================================================
     LOG (cap + spam merge)
  ========================================================= */
  const LOG_CAP = 55;
  let lastLog = { msg: "", t: 0, count: 0 };

  function log(msg, kind = "INFO") {
    if (!logEl) return;
    const now = Date.now();

    if (msg === lastLog.msg && now - lastLog.t < 1200) {
      lastLog.count++;
      const top = logEl.firstChild;
      if (top) top.textContent = `${kind}: ${msg} (x${lastLog.count})`;
      lastLog.t = now;
      return;
    }

    lastLog = { msg, t: now, count: 1 };
    const d = document.createElement("div");
    d.textContent = `${kind}: ${msg}`;
    logEl.prepend(d);
    while (logEl.children.length > LOG_CAP) logEl.removeChild(logEl.lastChild);
  }

  /* =========================================================
     CANVAS SIZE (iOS safe)
  ========================================================= */
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(DPR_CAP, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));
  setTimeout(resizeCanvas, 0);

  /* =========================================================
     ECONOMY (demo values until dex sync later)
  ========================================================= */
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  function growthScore() {
    return (mcap / 20000) + (volume / 6000) + (buyers / 10);
  }

  /* =========================================================
     CAMERA + INTERACTION
  ========================================================= */
  let camX = 0, camY = 0, zoom = 0.72; // start zoomed out
  let focusOn = false;
  let selected = 0;

  let dragging = false;
  let moved = false;
  let lastX = 0, lastY = 0;

  // “lite mode” while interacting for performance
  let isInteracting = false;

  function toWorld(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const d = dist2(wx, wy, c.x, c.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 360 * 360) ? best : -1;
  }

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    if (!smooth) {
      camX = -c.x; camY = -c.y;
      return;
    }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    moved = false;
    isInteracting = true;
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    camX += dx / zoom;
    camY += dy / zoom;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    // tap select (only if not dragged)
    if (!moved) {
      const w = toWorld(e.clientX, e.clientY);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        log(`Selected Colony #${idx + 1}`, "INFO");
        refreshInspectorOverlay(true);
        if (focusOn) centerOnSelected(false);
      }
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  }, { passive: true });

  // wheel zoom (desktop)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.8);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 140);
  }, { passive: false });

  // pinch zoom (touch)
  let pinchStartDist = 0, pinchStartZoom = 1;
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.hypot(dx, dy);
      pinchStartZoom = zoom;
      isInteracting = true;
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      if (pinchStartDist > 0) {
        zoom = clamp(pinchStartZoom * (d / pinchStartDist), 0.55, 2.8);
      }
    }
  }, { passive: true });

  canvas.addEventListener("touchend", () => {
    // end interaction shortly after touch ends
    clearTimeout(canvas.__touchTO);
    canvas.__touchTO = setTimeout(() => (isInteracting = false), 180);
  }, { passive: true });

  // double tap center (mobile)
  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

  /* =========================================================
     INSPECTOR OVERLAY (shows over sim when selecting colony)
  ========================================================= */
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: absolute;
    z-index: 50;
    min-width: 220px;
    max-width: min(320px, 70vw);
    pointer-events: none;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid rgba(120,255,210,.28);
    background: rgba(0,0,0,.55);
    backdrop-filter: blur(14px);
    color: rgba(235,240,248,.95);
    font: 800 12px/1.2 system-ui,-apple-system,Inter,sans-serif;
    box-shadow: 0 16px 50px rgba(0,0,0,.55);
    display: none;
  `;
  // place overlay inside the sim container (parent of canvas)
  (canvas.parentElement || document.body).appendChild(overlay);

  function dnaString(dna) {
    const a = Math.floor(dna.chaos * 100);
    const b = Math.floor(dna.drift * 100);
    const c = Math.floor(dna.aura * 100);
    const d = Math.floor(dna.limbiness * 100);
    return `H${Math.floor(dna.hue)}-C${a}-D${b}-A${c}-L${d}`;
  }

  function refreshInspectorOverlay(show = false) {
    const c = colonies[selected];
    if (!c) return;
    const rect = canvas.getBoundingClientRect();

    // anchor overlay near selected colony position on screen
    const sx = (W / 2) + (c.x + camX) * zoom;
    const sy = (H / 2) + (c.y + camY) * zoom;

    overlay.style.left = `${Math.round(sx + 12)}px`;
    overlay.style.top = `${Math.round(sy + 12)}px`;

    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:10px;height:10px;border-radius:50%;
          background:hsla(${c.dna.hue},95%,65%,.95);
          box-shadow:0 0 18px hsla(${c.dna.hue},95%,65%,.55);"></div>
        <div style="letter-spacing:.12em;text-transform:uppercase;font-size:11px;color:rgba(120,255,210,.85);">
          Colony #${selected + 1} • ${c.id}
        </div>
      </div>
      <div style="margin-top:8px;display:grid;gap:6px;">
        <div><span style="color:rgba(235,240,248,.65);letter-spacing:.12em;text-transform:uppercase;font-size:10px;">DNA</span>
          <div style="margin-top:2px;font-weight:900;">${dnaString(c.dna)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;">
          <div><span style="color:rgba(235,240,248,.65);letter-spacing:.12em;text-transform:uppercase;font-size:10px;">Biome</span>
            <div style="margin-top:2px;">${c.dna.biome}</div>
          </div>
          <div style="text-align:right;"><span style="color:rgba(235,240,248,.65);letter-spacing:.12em;text-transform:uppercase;font-size:10px;">Style</span>
            <div style="margin-top:2px;">${c.dna.style}</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;">
          <div><span style="color:rgba(235,240,248,.65);letter-spacing:.12em;text-transform:uppercase;font-size:10px;">Temp</span>
            <div style="margin-top:2px;">${c.dna.temperament}</div>
          </div>
          <div style="text-align:right;"><span style="color:rgba(235,240,248,.65);letter-spacing:.12em;text-transform:uppercase;font-size:10px;">Worms</span>
            <div style="margin-top:2px;">${c.worms.length}</div>
          </div>
        </div>
      </div>
    `;

    if (show) overlay.style.display = "block";
  }

  /* =========================================================
     LOGO (watermark inside canvas)
  ========================================================= */
  const logoImg = new Image();
  logoImg.crossOrigin = "anonymous";
  logoImg.src = LOGO_URL;
  let logoReady = false;
  logoImg.onload = () => { logoReady = true; };
  logoImg.onerror = () => { logoReady = false; log("Logo failed to load", "WARN"); };

  function drawWatermark() {
    if (!logoReady) return;

    // small top-left mark (screen space)
    ctx.save();
    ctx.globalAlpha = 0.85;
    const pad = 14;
    ctx.drawImage(logoImg, pad, pad, 38, 38);
    ctx.restore();

    // faint large centered mark (harder to crop out)
    ctx.save();
    ctx.globalAlpha = 0.06;
    const s = Math.min(W, H) * 0.62;
    ctx.drawImage(logoImg, (W - s) / 2, (H - s) / 2, s, s);
    ctx.restore();
  }

  /* =========================================================
     SPACE BACKGROUND (stars + galaxies) in WORLD SPACE
  ========================================================= */
  const stars = [];
  const galaxies = [];

  function seedSpace() {
    stars.length = 0;
    galaxies.length = 0;

    const R = WORLD_HALF * 1.05;
    const N = 680;

    for (let i = 0; i < N; i++) {
      stars.push({
        x: rand(-R, R),
        y: rand(-R, R),
        r: rand(0.4, 1.7),
        a: rand(0.12, 0.9),
        tw: rand(0.6, 1.8),
      });
    }

    for (let i = 0; i < 6; i++) {
      galaxies.push({
        x: rand(-R * 0.85, R * 0.85),
        y: rand(-R * 0.85, R * 0.85),
        r: rand(320, 640),
        hue: [190, 280, 140, 210, 310, 165][i % 6],
        a: rand(0.10, 0.18),
      });
    }
  }

  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function drawSpace(time) {
    // galaxies
    for (const g of galaxies) {
      const pulse = 1 + Math.sin(time * 0.00025 + g.x * 0.00012) * 0.06;
      aura(g.x, g.y, g.r * pulse, g.hue, g.a);
      aura(g.x + 70, g.y - 30, g.r * 0.55, (g.hue + 40) % 360, g.a * 0.55);
    }

    // stars
    ctx.fillStyle = "rgba(255,255,255,.92)";
    for (const s of stars) {
      const tw = 0.6 + Math.sin(time * 0.001 * s.tw + s.x * 0.01) * 0.4;
      ctx.globalAlpha = clamp(s.a * tw, 0.05, 0.95);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* =========================================================
     GRID (world-locked + smooth)
     - snap to world coords
     - do NOT draw in screen space
  ========================================================= */
  function drawGrid() {
    // Only draw grid lines that intersect view (faster + stable)
    const viewW = W / zoom;
    const viewH = H / zoom;

    const left = (-camX) - viewW / 2;
    const right = (-camX) + viewW / 2;
    const top = (-camY) - viewH / 2;
    const bottom = (-camY) + viewH / 2;

    const startX = Math.floor(left / GRID_STEP) * GRID_STEP;
    const endX = Math.floor(right / GRID_STEP) * GRID_STEP;
    const startY = Math.floor(top / GRID_STEP) * GRID_STEP;
    const endY = Math.floor(bottom / GRID_STEP) * GRID_STEP;

    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 1;

    for (let x = startX; x <= endX; x += GRID_STEP) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    for (let y = startY; y <= endY; y += GRID_STEP) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }

    // faint axes crosshair near origin
    ctx.strokeStyle = "rgba(120,255,210,.06)";
    ctx.beginPath();
    ctx.moveTo(-WORLD_HALF, 0);
    ctx.lineTo(WORLD_HALF, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -WORLD_HALF);
    ctx.lineTo(0, WORLD_HALF);
    ctx.stroke();
  }

  /* =========================================================
     COLONIES + WORMS (full feature set)
  ========================================================= */
  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.55, 1.35),
      drift: rand(0.55, 1.35),
      aura: rand(0.9, 1.6),
      limbiness: rand(0.25, 1.1),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM"][randi(0, 4)],
      style: ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT"][randi(0, 4)]
    };

    // metaball-ish nodes for irregular colony shapes
    const nodes = Array.from({ length: randi(5, 8) }, () => ({
      ox: rand(-90, 90),
      oy: rand(-90, 90),
      r: rand(65, 140),
      ph: rand(0, TAU),
      sp: rand(0.35, 1.15)
    }));

    return {
      id: Math.random().toString(16).slice(2, 6).toUpperCase(),
      x, y,
      vx: rand(-0.12, 0.12),
      vy: rand(-0.12, 0.12),
      dna,
      nodes,
      worms: [],
      shock: [],
      badgePulse: 0
    };
  }

  function newWorm(col, big = false) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(18, 28) : randi(10, 18);
    const baseLen = big ? rand(10, 16) : rand(7, 12);

    // diverse colors
    const hue = (col.dna.hue + rand(-160, 160) + 360) % 360;

    // IMPORTANT: random initial heading to avoid “rush right”
    const startAng = rand(0, TAU);

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.78) : rand(0.55, 1.10),
      turn: rand(0.010, 0.020) * col.dna.chaos,
      phase: rand(0, TAU),
      segs: [],
      limbs: [],
      isBoss: false,

      // NEW: angular velocity removes directional bias
      angVel: rand(-0.06, 0.06) * col.dna.chaos,
      wanderSeed: rand(0, 9999)
    };

    let px = col.x + rand(-65, 65);
    let py = col.y + rand(-65, 65);
    let ang = startAng;

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.30, 0.30) * col.dna.chaos;
    }
    return w;
  }

  function addLimb(w, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, Math.max(3, w.segs.length - 3));
    w.limbs.push({
      at,
      len: big ? rand(38, 100) : rand(22, 76),
      ang: rand(-1.35, 1.35),
      wob: rand(0.7, 1.8)
    });
  }

  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
    col.badgePulse = 1;
  }

  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  let nextSplitAt = MC_STEP;
  let bossSpawned = false;

  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= BOSS_AT) {
      const c = colonies[0];
      const boss = newWorm(c, true);
      boss.isBoss = true;
      boss.width *= 1.6;
      boss.speed *= 0.75;
      boss.hue = 120;
      boss.angVel *= 0.6;
      for (let i = 0; i < 4; i++) addLimb(boss, true);
      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.5);
      log("Boss worm emerged", "EVENT");
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, TAU);
      const d = rand(380, 620); // more spacing
      const nc = newColony(
        base.x + Math.cos(ang) * d,
        base.y + Math.sin(ang) * d,
        (base.dna.hue + rand(-100, 100) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 6);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.1);
      colonies.push(nc);

      log(`New colony spawned at ${fmt(nextSplitAt)} MC`, "EVENT");
      nextSplitAt += MC_STEP;

      // if user is zoomed out initially, keep fit feeling by re-centering slightly
      // (but don’t steal control during interaction)
      if (!isInteracting) zoomOutToFitAll();
    }
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    if (r < 0.28) {
      w.hue = (w.hue + rand(30, 160)) % 360;
      log(`Color shift • Worm ${w.id} (Colony #${colonies.indexOf(c) + 1})`, "MUTATION");
    } else if (r < 0.54) {
      w.speed *= rand(1.05, 1.25);
      log(`Aggression spike • Worm ${w.id}`, "MUTATION");
    } else if (r < 0.76) {
      w.width = clamp(w.width * rand(1.05, 1.25), 3.5, 16);
      log(`Body growth • Worm ${w.id}`, "MUTATION");
    } else {
      addLimb(w, Math.random() < 0.35);
      log(`Limb growth • Worm ${w.id}`, "MUTATION");
    }

    if (Math.random() < 0.24) shockwave(c, 0.95);
    refreshInspectorOverlay(false);
  }

  /* =========================================================
     WORM POPULATION SCALE
  ========================================================= */
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.2), 3, 85);

    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.2 - g * 0.04, 0.15, 1.2);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.35) shockwave(c, 0.6);
      log("New worm hatched", "INFO");
    }
  }

  /* =========================================================
     BUTTONS (data-action)
  ========================================================= */
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      fn();
      updateStats();
      refreshInspectorOverlay(false);
    });
  }

  bind("feed", () => {
    volume += rand(20, 90);
    mcap += rand(120, 460);
    log("Feed + nutrients", "INFO");
  });

  bind("smallBuy", () => {
    buyers += 1;
    const dv = rand(180, 900);
    const dm = rand(900, 3200);
    volume += dv;
    mcap += dm;
    log(`Buy • +1 buyers • +${fmt(dv)} vol • +${fmt(dm)} MC`, "INFO");
    if (Math.random() < 0.3) shockwave(colonies[0], 0.55);
  });

  bind("whaleBuy", () => {
    const b = randi(2, 5);
    const dv = rand(2500, 8500);
    const dm = rand(9000, 22000);
    buyers += b;
    volume += dv;
    mcap += dm;
    shockwave(colonies[0], 1.2);
    log(`Whale Buy • +${b} buyers • +${fmt(dv)} vol • +${fmt(dm)} MC`, "EVENT");
  });

  bind("sell", () => {
    const dv = rand(600, 2600);
    const dm = rand(2200, 9000);
    volume = Math.max(0, volume - dv);
    mcap = Math.max(0, mcap - dm);
    log(`Sell-off • -${fmt(dv)} vol • -${fmt(dm)} MC`, "WARN");
  });

  bind("storm", () => {
    const dv = rand(5000, 18000);
    const dm = rand(2000, 8000);
    volume += dv;
    mcap += dm;
    shockwave(colonies[0], 1.0);
    log(`Volume Storm • +${fmt(dv)} vol • +${fmt(dm)} MC`, "EVENT");
  });

  bind("mutate", () => mutateRandom());

  bind("focus", () => {
    focusOn = !focusOn;
    const btn = document.querySelector(`button[data-action="focus"]`);
    if (btn) btn.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(false);
  });

  bind("zoomIn", () => (zoom = clamp(zoom * 1.12, 0.55, 2.8)));
  bind("zoomOut", () => (zoom = clamp(zoom * 0.88, 0.55, 2.8)));

  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
      log("Capture saved", "INFO");
    } catch {
      log("Capture blocked by iOS — use screenshot/share", "WARN");
    }
  });

  bind("reset", () => location.reload());

  /* =========================================================
     STATS UI UPDATE
  ========================================================= */
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) elWorms.textContent = String(colonies.reduce((a, c) => a + c.worms.length, 0));
  }

  /* =========================================================
     IRREGULAR COLONY RENDER + BADGE
  ========================================================= */
  function drawColony(col, time, isSelected) {
    const baseHue = col.dna.hue;

    // Better auras
    if (!isInteracting) {
      aura(col.x, col.y, 240 * col.dna.aura, baseHue, 0.14);
      aura(col.x, col.y, 170 * col.dna.aura, (baseHue + 40) % 360, 0.09);
    } else {
      aura(col.x, col.y, 160 * col.dna.aura, baseHue, 0.10);
    }

    // metaball nodes
    for (let i = 0; i < col.nodes.length; i++) {
      const n = col.nodes[i];
      const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 10;
      const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 10;
      if (!isInteracting) {
        aura(x, y, n.r * 1.05, (baseHue + i * 18) % 360, 0.11);
        aura(x, y, n.r * 0.65, (baseHue + i * 22 + 40) % 360, 0.075);
      } else {
        aura(x, y, n.r * 0.7, baseHue, 0.08);
      }
    }

    // wobbly outline (irregular shape)
    const R = 150;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .30)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let a = 0; a <= TAU + 0.001; a += Math.PI / 20) {
      const wob =
        Math.sin(a * 3 + time * 0.0015) * 12 +
        Math.sin(a * 7 - time * 0.0011) * 8 +
        Math.sin(a * 11 + time * 0.0009) * 5;
      const rr = R + wob * col.dna.chaos;
      const px = col.x + Math.cos(a) * rr;
      const py = col.y + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // selected ring
    if (isSelected) {
      ctx.strokeStyle = `hsla(${baseHue}, 95%, 65%, .58)`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(col.x, col.y, 135 * col.dna.aura, 0, TAU);
      ctx.stroke();
    }

    // DNA badge (tiny label)
    const pulse = col.badgePulse = Math.max(0, col.badgePulse * 0.94 - 0.01);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = "800 11px system-ui, -apple-system, Inter, sans-serif";
    ctx.fillStyle = `hsla(${baseHue}, 95%, 65%, ${0.9})`;
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.lineWidth = 3;

    const label = `${col.id} • ${col.dna.biome}`;
    const mx = col.x + 10;
    const my = col.y - 150;

    // subtle glow behind label when events happen
    if (pulse > 0) {
      aura(mx + 55, my - 8, 70 + pulse * 60, baseHue, 0.16 + pulse * 0.10);
    }

    ctx.strokeText(label, mx, my);
    ctx.fillText(label, mx, my);
    ctx.restore();

    // shockwaves
    for (const s of col.shock) {
      ctx.strokeStyle = `hsla(${baseHue}, 92%, 62%, ${s.a})`;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.arc(col.x, col.y, s.r, 0, TAU);
      ctx.stroke();
    }
  }

  /* =========================================================
     WORM DRAW (body + beads + limbs)
  ========================================================= */
  function drawWorm(w, time) {
    const pts = w.segs;

    // glow (skip in lite mode)
    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.26 : 0.13})`;
      ctx.lineWidth = w.width + (w.isBoss ? 8 : 6);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // core
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.98 : 0.9})`;
    ctx.lineWidth = w.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // bead detail (skip in lite mode)
    if (!isInteracting) {
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i];
        const r = Math.max(2.2, w.width * 0.35);
        ctx.fillStyle = `hsla(${(w.hue + 18) % 360}, 95%, 66%, .82)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }
    }

    // limbs
    if (w.limbs?.length) {
      ctx.globalCompositeOperation = isInteracting ? "source-over" : "lighter";
      for (const L of w.limbs) {
        const at = clamp(L.at, 0, pts.length - 1);
        const base = pts[at];
        const baseAng =
          (pts[at]?.a || 0) +
          L.ang +
          Math.sin(time * 0.002 * L.wob + w.phase) * 0.35;

        const lx = base.x + Math.cos(baseAng) * L.len;
        const ly = base.y + Math.sin(baseAng) * L.len;

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, ${isInteracting ? 0.34 : 0.55})`;
        ctx.lineWidth = Math.max(2, w.width * 0.35);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(
          base.x + Math.cos(baseAng) * (L.len * 0.55),
          base.y + Math.sin(baseAng) * (L.len * 0.55),
          lx,
          ly
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  /* =========================================================
     WORM BEHAVIOR (NO “RUSH RIGHT”)
     - Uses radial attraction + unbiased wander + angular velocity
  ========================================================= */
  function wormBehavior(col, w, time) {
    const head = w.segs[0];

    // radial vector to colony center
    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    // unbiased wander (sine/cos mix) — no x-bias
    const t = time * 0.001;
    const wander =
      Math.sin(t * 1.6 + w.wanderSeed) * 0.22 +
      Math.cos(t * 1.1 + w.wanderSeed * 0.7) * 0.18 +
      (Math.random() - 0.5) * 0.08;

    // orbit/hunter flavor
    let desired = toward + wander;

    if (w.type === "ORBITER") {
      const side = Math.sin(t * 0.8 + w.phase) > 0 ? 1 : -1;
      desired = toward + side * 0.95 + wander * 0.25;
    } else if (w.type === "HUNTER") {
      desired = toward + wander * 0.6;
    }

    // smooth angle blending + angular velocity (no bias)
    const delta = angNorm(desired - head.a);
    head.a += delta * 0.10;
    head.a += w.angVel * 0.15 + (Math.random() - 0.5) * w.turn * 0.35;

    // move forward
    const boost = w.isBoss ? 1.45 : 1.0;
    head.x += Math.cos(head.a) * w.speed * 2.0 * boost;
    head.y += Math.sin(head.a) * w.speed * 2.0 * boost;

    // leash to colony (pull back smoothly)
    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const leash = 340;
    if (d > leash) {
      const pull = (d - leash) / 240;
      head.x = lerp(head.x, col.x, clamp(pull, 0.03, 0.20));
      head.y = lerp(head.y, col.y, clamp(pull, 0.03, 0.20));
      head.a = head.a * 0.85 + toward * 0.15;
    }

    // segment follow
    for (let i = 1; i < w.segs.length; i++) {
      const prev = w.segs[i - 1];
      const seg = w.segs[i];

      const vx = seg.x - prev.x;
      const vy = seg.y - prev.y;
      const ang = Math.atan2(vy, vx);

      const targetX = prev.x + Math.cos(ang) * seg.len;
      const targetY = prev.y + Math.sin(ang) * seg.len;

      seg.x = seg.x * 0.2 + targetX * 0.8;
      seg.y = seg.y * 0.2 + targetY * 0.8;
      seg.a = ang;
    }
  }

  /* =========================================================
     FIT VIEW (zoomed out start)
  ========================================================= */
  function zoomOutToFitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 700;

    for (const c of colonies) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }

    const bw = Math.max(240, maxX - minX);
    const bh = Math.max(240, maxY - minY);

    const fit = Math.min(W / bw, H / bh);
    zoom = clamp(fit * 0.92, 0.55, 1.6);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  /* =========================================================
     SIM STEP
  ========================================================= */
  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();

    // colony drift
    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;

      for (const s of c.shock) {
        s.r += s.v;
        s.a *= 0.96;
      }
      c.shock = c.shock.filter((s) => s.a > 0.06);
    }

    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time);
    }

    if (focusOn) centerOnSelected(true);

    // auto mutations based on activity
    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.08, 0.4, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.65) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();

    // keep overlay in sync while visible
    if (overlay.style.display !== "none") refreshInspectorOverlay(false);
  }

  /* =========================================================
     RENDER
  ========================================================= */
  function render(time) {
    // guard
    zoom = safeNum(zoom, 1);
    camX = safeNum(camX, 0);
    camY = safeNum(camY, 0);

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // camera transform
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    // background in world
    drawSpace(time);
    drawGrid();

    // colonies
    for (let i = 0; i < colonies.length; i++) {
      drawColony(colonies[i], time, i === selected);
    }

    // worms
    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    ctx.restore();

    // watermark in screen space
    drawWatermark();

    setDbg("JS LOADED ✓ (rendering)");
  }

  /* =========================================================
     MAIN LOOP (FPS CAP)
  ========================================================= */
  let last = performance.now();
  let renderAccum = 0;
  const RENDER_DT = 1 / RENDER_FPS;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    step(dt, now);

    renderAccum += dt;
    if (renderAccum >= RENDER_DT) {
      renderAccum = 0;
      render(now);
    }

    requestAnimationFrame(tick);
  }

  /* =========================================================
     BOOT
  ========================================================= */
  function boot() {
    resizeCanvas();
    seedSpace();
    zoomOutToFitAll();
    updateStats();
    log("Simulation ready", "INFO");
    requestAnimationFrame(tick);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 0);
  } else {
    window.addEventListener("load", boot);
  }
})();
