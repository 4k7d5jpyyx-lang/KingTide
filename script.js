(() => {
  "use strict";

  // ==========================
  // CONFIG
  // ==========================
  const DEBUG_TOAST = true;

  const LOGO_URL = "https://i.postimg.cc/hGj8JD0V/1614F03F-52AD-453C-8DB1-09A3B29F3469.png";

  // Visual tuning
  const GRID_SIZE_WORLD = 140;       // bigger = more "space"
  const GRID_ALPHA = 0.10;
  const STAR_COUNT_FAR = 260;
  const STAR_COUNT_NEAR = 160;
  const GALAXY_COUNT = 3;

  // Performance
  const MAX_DPR = 2;                 // avoid insane retina cost
  const RENDER_FPS = 45;             // smooth but not too heavy
  const INTERACT_FPS = 30;           // during drag/pinch
  const STEP_DT_MAX = 0.05;

  // World
  const ARENA_RADIUS = 520;          // bigger world feel
  const COLONY_TETHER = 0.0055;      // spring toward "home" (prevents drift bias)
  const COLONY_DRIFT = 0.020;

  // Worm behavior (fix "rushing right")
  const WANDER = 0.55;
  const HOME_PULL = 0.85;
  const ORBIT_PULL = 0.65;

  // ==========================
  // DOM
  // ==========================
  const $ = (id) => document.getElementById(id);

  const canvas = $("simCanvas");
  const toast = $("toast");
  const simStatus = $("simStatus");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");

  const inspector = $("inspector");
  const inspectorBody = $("inspectorBody");
  const toggleInspector = $("toggleInspector");
  const selName = $("selName");
  const dnaVal = $("dnaVal");
  const tempVal = $("tempVal");
  const biomeVal = $("biomeVal");
  const styleVal = $("styleVal");
  const mutList = $("mutList");

  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  // Ensure logo loads (also used as watermark inside sim)
  const logoImg = new Image();
  logoImg.crossOrigin = "anonymous";
  logoImg.src = LOGO_URL;

  // ==========================
  // Helpers
  // ==========================
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;

  const fmtMoney = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  // Stable pseudo-noise (NO Math.random each frame -> removes bias drift)
  function hash01(n) {
    // deterministic-ish 0..1
    const x = Math.sin(n) * 43758.5453123;
    return x - Math.floor(x);
  }
  function noise1(t, seed) {
    // smooth-ish
    const a = Math.floor(t);
    const b = a + 1;
    const fa = hash01(a * 12.9898 + seed * 78.233);
    const fb = hash01(b * 12.9898 + seed * 78.233);
    const u = t - a;
    const s = u * u * (3 - 2 * u);
    return fa + (fb - fa) * s; // 0..1
  }

  function setToast(text, isErr = false) {
    if (!toast) return;
    if (!DEBUG_TOAST) { toast.style.display = "none"; return; }
    toast.style.display = "block";
    toast.textContent = text;
    toast.style.background = isErr ? "rgba(120,0,20,.55)" : "rgba(0,0,0,.55)";
  }

  function addMutationLine(msg) {
    if (!mutList) return;
    const d = document.createElement("div");
    d.textContent = msg;
    mutList.prepend(d);
    while (mutList.children.length > 8) mutList.removeChild(mutList.lastChild);
  }

  // ==========================
  // Canvas sizing
  // ==========================
  let W = 1, H = 1, DPR = 1;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);

    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);

    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));

  // ==========================
  // Economy / triggers
  // ==========================
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

  // ==========================
  // Camera + Interaction (pan + pinch)
  // ==========================
  let camX = 0, camY = 0, zoom = 0.85;   // start more zoomed out
  let selected = 0;
  let focusOn = false;

  let isInteracting = false;

  const pointers = new Map(); // pointerId -> {x,y}
  let lastTap = 0;

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
    return (best !== -1 && bestD < 280 * 280) ? best : -1;
  }

  // Tap vs drag threshold
  let downX = 0, downY = 0;
  let downTime = 0;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downX = e.clientX; downY = e.clientY;
    downTime = performance.now();
    isInteracting = true;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      // Pan
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      camX += dx / zoom;
      camY += dy / zoom;
    } else if (pointers.size === 2) {
      // Pinch zoom
      const ids = [...pointers.keys()];
      const p0 = pointers.get(ids[0]);
      const p1 = pointers.get(ids[1]);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);

      // store last pinch distance on canvas
      if (canvas.__pinchLast == null) canvas.__pinchLast = dist;
      const ratio = dist / canvas.__pinchLast;
      canvas.__pinchLast = dist;

      zoom = clamp(zoom * ratio, 0.55, 2.6);
    }
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) canvas.__pinchLast = null;

    const upTime = performance.now();
    const move = Math.hypot(e.clientX - downX, e.clientY - downY);
    const held = upTime - downTime;

    // Consider it a "tap" if minimal movement
    if (move < 10 && held < 450) {
      const w = toWorld(e.clientX, e.clientY);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        syncInspector();
        if (focusOn) centerOnSelected(false);
      }

      // double-tap to center
      const now = Date.now();
      if (now - lastTap < 280) centerOnSelected(false);
      lastTap = now;
    }

    // if no pointers left, stop interacting shortly after
    if (pointers.size === 0) {
      setTimeout(() => { isInteracting = false; }, 90);
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    pointers.clear();
    canvas.__pinchLast = null;
    isInteracting = false;
  }, { passive: true });

  // Wheel zoom (desktop)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    const tx = -c.x;
    const ty = -c.y;
    if (!smooth) { camX = tx; camY = ty; return; }
    camX = lerp(camX, tx, 0.16);
    camY = lerp(camY, ty, 0.16);
  }

  // ==========================
  // Inspector UI
  // ==========================
  let inspectorOpen = true;
  if (toggleInspector && inspectorBody) {
    toggleInspector.addEventListener("click", () => {
      inspectorOpen = !inspectorOpen;
      inspectorBody.style.display = inspectorOpen ? "block" : "none";
      toggleInspector.textContent = inspectorOpen ? "▾" : "▸";
    });
  }

  function dnaString(dna) {
    // "DNA fix" -> make it readable & stable
    const h = Math.round(dna.hue);
    const c = dna.chaos.toFixed(2);
    const d = dna.drift.toFixed(2);
    const a = dna.aura.toFixed(2);
    const l = dna.limbiness.toFixed(2);
    return `H${h} • C${c} • D${d} • A${a} • L${l}`;
  }

  function syncInspector() {
    const c = colonies[selected];
    if (!c) return;

    if (selName) selName.textContent = `Colony #${selected + 1}`;
    if (dnaVal) dnaVal.textContent = dnaString(c.dna);
    if (tempVal) tempVal.textContent = c.dna.temperament;
    if (biomeVal) biomeVal.textContent = c.dna.biome;
    if (styleVal) styleVal.textContent = c.dna.style;
  }

  // ==========================
  // Colony / worm models
  // ==========================
  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.60, 1.25),
      drift: rand(0.70, 1.15),
      aura: rand(1.05, 1.55),
      limbiness: rand(0.25, 1.10),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM"][randi(0, 4)],
      style: ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT"][randi(0, 4)]
    };

    const nodes = Array.from({ length: randi(5, 8) }, () => ({
      ox: rand(-80, 80),
      oy: rand(-80, 80),
      r: rand(60, 130),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.45, 1.15)
    }));

    const idSeed = rand(10, 9999);

    return {
      homeX: x,
      homeY: y,
      x, y,
      vx: rand(-0.12, 0.12),
      vy: rand(-0.12, 0.12),
      dna,
      nodes,
      worms: [],
      shock: [],
      seed: idSeed
    };
  }

  function newWorm(col, big = false) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(18, 28) : randi(10, 18);
    const baseLen = big ? rand(10, 16) : rand(7, 12);

    const hue = (col.dna.hue + rand(-150, 150) + 360) % 360;
    const seed = rand(100, 10000);

    const w = {
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.48, 1.00),
      turn: rand(0.010, 0.022) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      limbs: [],
      segs: [],
      isBoss: false,
      seed
    };

    let px = col.x + rand(-55, 55);
    let py = col.y + rand(-55, 55);
    let ang = rand(0, Math.PI * 2);

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.25, 0.25) * col.dna.chaos;
    }

    return w;
  }

  function addLimb(w, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(40, 95) : rand(22, 75),
      ang: rand(-1.2, 1.2),
      wob: rand(0.7, 1.6)
    });
  }

  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
  }

  // Initial colony
  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  // ==========================
  // Space layers (stars + galaxies)
  // ==========================
  const starsFar = Array.from({ length: STAR_COUNT_FAR }, (_, i) => ({
    x: rand(-1600, 1600),
    y: rand(-1600, 1600),
    r: rand(0.6, 1.4),
    a: rand(0.12, 0.55),
    tw: rand(0.5, 1.6),
    seed: i + 10
  }));

  const starsNear = Array.from({ length: STAR_COUNT_NEAR }, (_, i) => ({
    x: rand(-1200, 1200),
    y: rand(-1200, 1200),
    r: rand(0.8, 2.1),
    a: rand(0.10, 0.45),
    tw: rand(0.8, 2.2),
    seed: i + 200
  }));

  const galaxies = Array.from({ length: GALAXY_COUNT }, (_, i) => ({
    x: rand(-900, 900),
    y: rand(-900, 900),
    r: rand(360, 520),
    hue: [200, 285, 145][i % 3],
    a: rand(0.10, 0.16)
  }));

  // ==========================
  // Events / mechanics
  // ==========================
  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= 50000) {
      const c = colonies[0];
      const boss = newWorm(c, true);
      boss.isBoss = true;
      boss.width *= 1.6;
      boss.speed *= 0.7;
      boss.hue = 120;
      for (let i = 0; i < 4; i++) addLimb(boss, true);
      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.4);
      addMutationLine("EVENT: Boss worm emerged");
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const d = rand(320, 520);

      const nx = base.homeX + Math.cos(ang) * d;
      const ny = base.homeY + Math.sin(ang) * d;

      const nc = newColony(
        nx,
        ny,
        (base.dna.hue + rand(-90, 90) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 6);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.1);
      colonies.push(nc);

      addMutationLine(`EVENT: New colony spawned @ ${fmtMoney(nextSplitAt)} MC`);
      nextSplitAt += MC_STEP;

      // zoom out to fit
      zoomOutToFitAll();
    }
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    if (r < 0.30) {
      w.hue = (w.hue + rand(30, 140)) % 360;
      addMutationLine(`MUTATION: Color shift (worm)`);
    } else if (r < 0.56) {
      w.speed *= rand(1.05, 1.22);
      addMutationLine(`MUTATION: Aggression spike`);
    } else if (r < 0.78) {
      w.width = clamp(w.width * rand(1.05, 1.22), 3.5, 16);
      addMutationLine(`MUTATION: Body growth`);
    } else {
      addLimb(w, Math.random() < 0.35);
      addMutationLine(`MUTATION: Limb growth`);
    }

    if (Math.random() < 0.22) shockwave(c, 0.9);
    syncInspector();
  }

  // Worm population scaling
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.1), 3, 80);

    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.1 - g * 0.04, 0.18, 1.1);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.25) shockwave(c, 0.6);
      syncInspector();
    }
  }

  // ==========================
  // Controls (ROBUST binding)
  // ==========================
  function bind(action, fn) {
    const btns = document.querySelectorAll(`[data-action="${action}"]`);
    btns.forEach((b) => b.addEventListener("click", fn));
  }

  bind("feed", () => {
    volume += rand(20, 90);
    mcap += rand(120, 460);
    addMutationLine("INFO: Feed + nutrients");
  });

  bind("smallBuy", () => {
    buyers += 1;
    const dv = rand(180, 900);
    const dm = rand(900, 3200);
    volume += dv;
    mcap += dm;
    addMutationLine(`INFO: Buy +1 ( +${fmtMoney(dv)} vol, +${fmtMoney(dm)} MC )`);
    if (Math.random() < 0.28) shockwave(colonies[0], 0.55);
  });

  bind("whaleBuy", () => {
    const b = randi(2, 5);
    const dv = rand(2500, 8500);
    const dm = rand(9000, 22000);
    buyers += b;
    volume += dv;
    mcap += dm;
    shockwave(colonies[0], 1.2);
    addMutationLine(`EVENT: Whale buy +${b} ( +${fmtMoney(dv)} vol, +${fmtMoney(dm)} MC )`);
  });

  bind("sell", () => {
    const dv = rand(600, 2600);
    const dm = rand(2200, 9000);
    volume = Math.max(0, volume - dv);
    mcap = Math.max(0, mcap - dm);
    addMutationLine(`WARN: Sell-off ( -${fmtMoney(dv)} vol, -${fmtMoney(dm)} MC )`);
  });

  bind("storm", () => {
    const dv = rand(5000, 18000);
    const dm = rand(2000, 8000);
    volume += dv;
    mcap += dm;
    shockwave(colonies[0], 1.0);
    addMutationLine(`EVENT: Volume Storm +${fmtMoney(dv)} vol`);
  });

  bind("mutate", () => mutateRandom());

  bind("focus", () => {
    focusOn = !focusOn;
    const fb = $("focusBtn");
    if (fb) fb.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(false);
  });

  bind("zoomIn", () => (zoom = clamp(zoom * 1.12, 0.55, 2.6)));
  bind("zoomOut", () => (zoom = clamp(zoom * 0.88, 0.55, 2.6)));

  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
      addMutationLine("INFO: Capture saved");
    } catch {
      addMutationLine("WARN: Capture blocked (use screenshot/share)");
    }
  });

  bind("reset", () => location.reload());

  // ==========================
  // Stats update
  // ==========================
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmtMoney(volume);
    if (elMcap) elMcap.textContent = fmtMoney(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) {
      const total = colonies.reduce((a, c) => a + c.worms.length, 0);
      elWorms.textContent = String(total);
    }
  }

  // ==========================
  // View fitting (start zoomed out)
  // ==========================
  function zoomOutToFitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 520;

    for (const c of colonies) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }

    const bw = Math.max(240, maxX - minX);
    const bh = Math.max(240, maxY - minY);

    const fit = Math.min(W / bw, H / bh);
    zoom = clamp(fit * 0.92, 0.55, 1.55);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  // ==========================
  // Rendering helpers
  // ==========================
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,66%,${a})`);
    g.addColorStop(0.55, `hsla(${hue},95%,60%,${a * 0.25})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGalaxies(time) {
    // draw behind grid, in world space
    for (const g of galaxies) {
      const tw = 0.5 + 0.5 * Math.sin(time * 0.00035 + g.x * 0.001);
      const rr = g.r * (0.95 + tw * 0.08);

      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rr);
      grad.addColorStop(0, `hsla(${g.hue}, 95%, 62%, ${g.a})`);
      grad.addColorStop(0.45, `hsla(${(g.hue + 35) % 360}, 95%, 60%, ${g.a * 0.26})`);
      grad.addColorStop(1, `hsla(${g.hue}, 95%, 55%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.x, g.y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // IMPORTANT: draw grid in screen space with camera offset + pixel snapping -> no shimmering glitch
  function drawGridScreen() {
    const step = GRID_SIZE_WORLD * zoom;
    if (step < 18) return; // too dense

    const ox = (W / 2 + camX * zoom) % step;
    const oy = (H / 2 + camY * zoom) % step;

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // keep consistent
    ctx.lineWidth = 1; // screen pixel

    ctx.strokeStyle = `rgba(255,255,255,${GRID_ALPHA})`;

    // verticals
    for (let x = ox; x <= W + step; x += step) {
      const xx = Math.round(x) + 0.5; // snap
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, H);
      ctx.stroke();
    }
    // horizontals
    for (let y = oy; y <= H + step; y += step) {
      const yy = Math.round(y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawStarsScreen(time) {
    // parallax screen stars (smooth, no shimmer)
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // far stars (tiny)
    for (const s of starsFar) {
      const tw = 0.75 + 0.25 * Math.sin(time * 0.0012 * s.tw + s.seed);
      const px = (W * 0.5 + (s.x + camX * 0.12) * zoom * 0.35);
      const py = (H * 0.5 + (s.y + camY * 0.12) * zoom * 0.35);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;

      ctx.fillStyle = `rgba(255,255,255,${s.a * tw})`;
      ctx.beginPath();
      ctx.arc(px, py, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // near stars
    for (const s of starsNear) {
      const tw = 0.7 + 0.3 * Math.sin(time * 0.0016 * s.tw + s.seed);
      const px = (W * 0.5 + (s.x + camX * 0.22) * zoom * 0.45);
      const py = (H * 0.5 + (s.y + camY * 0.22) * zoom * 0.45);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;

      ctx.fillStyle = `rgba(255,255,255,${s.a * tw})`;
      ctx.beginPath();
      ctx.arc(px, py, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    // stronger, cleaner auras
    aura(col.x, col.y, 190 * col.dna.aura, baseHue, isInteracting ? 0.12 : 0.18);
    aura(col.x, col.y, 120 * col.dna.aura, (baseHue + 40) % 360, isInteracting ? 0.06 : 0.10);

    // metaball-ish nodes (reduced during interaction)
    if (!isInteracting) {
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 12;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 12;
        aura(x, y, n.r * 1.05, (baseHue + i * 18) % 360, 0.13);
      }
    }

    // outline ring
    const R = 130;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .34)`;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.001; a += Math.PI / 20) {
      const wob =
        Math.sin(a * 3 + time * 0.0015) * 10 +
        Math.sin(a * 7 - time * 0.0011) * 6;
      const rr = R + wob * col.dna.chaos;
      const px = col.x + Math.cos(a) * rr;
      const py = col.y + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawWorm(w, time) {
    const pts = w.segs;

    if (!pts.length) return;

    // glow layer (skip while interacting for perf)
    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.26 : 0.15})`;
      ctx.lineWidth = w.width + (w.isBoss ? 9 : 6);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // core
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.98 : 0.92})`;
    ctx.lineWidth = w.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

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

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, ${isInteracting ? 0.32 : 0.55})`;
        ctx.lineWidth = Math.max(2, w.width * 0.35);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(
          base.x + Math.cos(baseAng) * (L.len * 0.55),
          base.y + Math.sin(baseAng) * (L.len * 0.55),
          lx, ly
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawWatermark() {
    if (!logoImg.complete) return;
    // watermark in world space (subtle)
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.globalCompositeOperation = "lighter";
    const size = 240;
    const x = camX * 0 + 260;  // place near top-left of world-ish
    const y = camY * 0 - 260;
    ctx.drawImage(logoImg, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  }

  // ==========================
  // Simulation step (fix bias + arena)
  // ==========================
  function wormBehavior(col, w, timeSec) {
    const head = w.segs[0];

    // stable wander noise (no Math.random)
    const n = noise1(timeSec * 0.9, w.seed) * 2 - 1; // -1..1
    const wanderTurn = n * w.turn * WANDER;

    // desired direction depends on type
    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    let desired = toward;

    if (w.type === "ORBITER") {
      const side = (noise1(timeSec * 0.25, w.seed + 33) > 0.5) ? 1 : -1;
      desired = toward + side * 1.05; // orbit
      desired = lerpAngle(head.a, desired, 0.10 * ORBIT_PULL);
    } else if (w.type === "HUNTER") {
      desired = toward + Math.sin(timeSec * 1.6 + w.phase) * 0.35;
      desired = lerpAngle(head.a, desired, 0.14);
    } else {
      desired = lerpAngle(head.a, toward, 0.09 * HOME_PULL);
    }

    // apply steering
    head.a = desired + wanderTurn;

    // move
    const boost = w.isBoss ? 2.0 : 1.0;
    const sp = w.speed * 2.15 * boost;
    head.x += Math.cos(head.a) * sp;
    head.y += Math.sin(head.a) * sp;

    // keep within colony orbit-ish + arena bounds
    const d = Math.hypot(head.x - col.x, head.y - col.y);
    if (d > 300) {
      // steer back in, not flip hard (prevents "all rush one direction")
      const back = Math.atan2(col.y - head.y, col.x - head.x);
      head.a = lerpAngle(head.a, back, 0.22);
      head.x = lerp(head.x, col.x, 0.05);
      head.y = lerp(head.y, col.y, 0.05);
    }

    // rope segments
    for (let i = 1; i < w.segs.length; i++) {
      const prev = w.segs[i - 1];
      const seg = w.segs[i];

      const vx = seg.x - prev.x;
      const vy = seg.y - prev.y;
      const ang = Math.atan2(vy, vx);

      const tx = prev.x + Math.cos(ang) * seg.len;
      const ty = prev.y + Math.sin(ang) * seg.len;

      seg.x = seg.x * 0.22 + tx * 0.78;
      seg.y = seg.y * 0.22 + ty * 0.78;
      seg.a = ang;
    }
  }

  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function step(dt, nowMs) {
    const t = nowMs / 1000;

    ensureBoss();
    trySplitByMcap();

    // colony motion: gentle drift + strong tether to home (prevents drifting right forever)
    for (const c of colonies) {
      const driftX = (noise1(t * 0.35, c.seed) * 2 - 1) * COLONY_DRIFT;
      const driftY = (noise1(t * 0.35, c.seed + 77) * 2 - 1) * COLONY_DRIFT;

      c.vx += driftX;
      c.vy += driftY;

      // tether
      c.vx += (c.homeX - c.x) * COLONY_TETHER;
      c.vy += (c.homeY - c.y) * COLONY_TETHER;

      c.vx *= 0.985;
      c.vy *= 0.985;

      c.x += c.vx;
      c.y += c.vy;

      // soft arena keep
      const r = Math.hypot(c.x, c.y);
      if (r > ARENA_RADIUS) {
        const nx = c.x / r, ny = c.y / r;
        c.x = nx * ARENA_RADIUS;
        c.y = ny * ARENA_RADIUS;
        c.vx *= 0.8; c.vy *= 0.8;
      }

      // shock rings
      for (const s of c.shock) { s.r += s.v; s.a *= 0.96; }
      c.shock = c.shock.filter((s) => s.a > 0.06);
    }

    // worms
    for (const c of colonies) for (const w of c.worms) wormBehavior(c, w, t);

    if (focusOn) centerOnSelected(true);

    // auto mutations
    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.08, 0.45, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.55) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();
  }

  function render(nowMs) {
    const t = nowMs;

    // clear
    ctx.clearRect(0, 0, W, H);

    // background layers
    drawStarsScreen(t);
    drawGridScreen();

    // world
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    drawGalaxies(t);

    // colonies
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      irregularBlob(c, t);

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 115 * c.dna.aura, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const s of c.shock) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 92%, 62%, ${s.a})`;
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // worms
    for (const c of colonies) for (const w of c.worms) drawWorm(w, t);

    // watermark
    drawWatermark();

    ctx.restore();

    setToast("JS LOADED ✓ (rendering)");
    if (simStatus) simStatus.textContent = "Simulation Active";
  }

  // ==========================
  // Boot + main loop
  // ==========================
  let last = performance.now();
  let renderAccum = 0;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, STEP_DT_MAX);
    last = now;

    step(dt, now);

    const targetFps = isInteracting ? INTERACT_FPS : RENDER_FPS;
    const renderDT = 1 / targetFps;
    renderAccum += dt;

    if (renderAccum >= renderDT) {
      renderAccum = 0;
      render(now);
    }

    requestAnimationFrame(tick);
  }

  function boot() {
    try {
      resizeCanvas();
      zoomOutToFitAll();
      updateStats();
      syncInspector();
      addMutationLine("INFO: Simulation ready");
      setToast("JS LOADED ✓");
      requestAnimationFrame(tick);
    } catch (e) {
      console.error(e);
      setToast("JS ERROR ✕ " + (e?.message || e), true);
      if (simStatus) simStatus.textContent = "Simulation Error";
    }
  }

  // run
  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
