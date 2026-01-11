(() => {
  "use strict";

  // =========================
  // DOM
  // =========================
  const $ = (id) => document.getElementById(id);

  const canvas = $("simCanvas");
  const toast = $("toast");
  const elStatus = $("simStatus");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const eventLogEl = $("eventLog");

  // Inspector overlay (matches your current HTML ids)
  const inspector = $("inspector");
  const inspectorBody = $("inspectorBody");
  const btnToggleInspector = $("toggleInspector");
  const elSelName = $("selName");
  const elDnaVal = $("dnaVal");
  const elTempVal = $("tempVal");
  const elBiomeVal = $("biomeVal");
  const elStyleVal = $("styleVal");
  const mutListEl = $("mutList");

  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  const fmt = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;

  // =========================
  // Canvas sizing
  // =========================
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));
  setTimeout(resizeCanvas, 0);

  // =========================
  // Event log
  // =========================
  const LOG_CAP = 40;
  let lastLog = { msg: "", t: 0, count: 0, badge: "" };

  function pushLog(badge, msg, meta = "") {
    if (!eventLogEl) return;
    const now = Date.now();

    if (msg === lastLog.msg && badge === lastLog.badge && now - lastLog.t < 1200) {
      lastLog.count++;
      const first = eventLogEl.firstChild;
      if (first) {
        const txt = first.querySelector(".eventText");
        if (txt) txt.textContent = `${msg} (x${lastLog.count})`;
      }
      lastLog.t = now;
      return;
    }
    lastLog = { msg, t: now, count: 1, badge };

    const row = document.createElement("div");
    row.className = "eventRow";

    const b = document.createElement("div");
    b.className = `badge ${badge}`;
    b.textContent =
      badge === "mut" ? "MUTATION" :
      badge === "mile" ? "MILESTONE" :
      badge === "boss" ? "BOSS" : "EVENT";

    const wrap = document.createElement("div");

    const t = document.createElement("div");
    t.className = "eventText";
    t.textContent = msg;

    const m = document.createElement("div");
    m.className = "eventMeta";
    m.textContent = meta || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    wrap.appendChild(t);
    wrap.appendChild(m);

    row.appendChild(b);
    row.appendChild(wrap);

    eventLogEl.prepend(row);

    while (eventLogEl.children.length > LOG_CAP) {
      eventLogEl.removeChild(eventLogEl.lastChild);
    }
  }

  // =========================
  // Toast (big notifications)
  // =========================
  let toastMsg = "Loading…";
  let toastT = 0;
  let toastHold = 0;

  function setToast(msg, holdMs = 1100) {
    toastMsg = msg;
    toastT = performance.now();
    toastHold = holdMs;
    if (toast) toast.textContent = msg;
  }

  function pulseBigToast(msg) {
    setToast(msg, 2400);
    // toned down: less screen shake spam
    worldShake(7, 520);
  }

  // =========================
  // iOS-friendly audio
  // =========================
  let audioCtx = null;
  let audioUnlocked = false;

  function ensureAudio() {
    if (audioUnlocked) return true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      audioUnlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  function playSfx(type = "ping", intensity = 1) {
    if (!ensureAudio() || !audioCtx) return;

    const now = audioCtx.currentTime;
    const out = audioCtx.createGain();
    out.gain.value = 0.0001;
    out.connect(audioCtx.destination);

    const g = audioCtx.createGain();
    g.connect(out);

    const o = audioCtx.createOscillator();
    o.type = "sine";

    const n = audioCtx.createOscillator();
    n.type = "triangle";

    const A = 0.005;

    if (type === "mut") {
      o.frequency.setValueAtTime(320 + 80 * intensity, now);
      o.frequency.exponentialRampToValueAtTime(120, now + 0.18);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.12, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    } else if (type === "shock") {
      o.frequency.setValueAtTime(90, now);
      o.frequency.exponentialRampToValueAtTime(45, now + 0.35);
      n.frequency.setValueAtTime(140, now);
      n.frequency.exponentialRampToValueAtTime(60, now + 0.35);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.22, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      n.connect(g);
      n.start(now);
      n.stop(now + 0.4);
    } else if (type === "fire") {
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(520, now + 0.12);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.26, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
    } else if (type === "ice") {
      o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(260, now + 0.18);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.18, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    } else if (type === "storm") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(120, now);
      o.frequency.exponentialRampToValueAtTime(520, now + 0.10);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.28, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    } else if (type === "boss") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(60, now + 0.26);
      n.frequency.setValueAtTime(260, now);
      n.frequency.exponentialRampToValueAtTime(90, now + 0.26);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.30, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      n.connect(g);
      n.start(now);
      n.stop(now + 0.34);
    } else {
      o.frequency.setValueAtTime(420, now);
      o.frequency.exponentialRampToValueAtTime(220, now + 0.22);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.10, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    }

    o.connect(g);
    o.start(now);
    o.stop(now + 0.6);

    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(1.0, now + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
  }

  window.addEventListener("pointerdown", () => ensureAudio(), { passive: true, once: true });

  // =========================
  // Economy / triggers
  // =========================
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  // REQUESTED LIMITS
  const MAX_COLONIES = 500;
  const MAX_WORMS = 9999;

  const MC_STEP = 25000;
  let nextSplitAt = MC_STEP;

  function growthScore() {
    return (mcap / 24000) + (volume / 7000) + (buyers / 12);
  }

  // =========================
  // Camera + interaction
  // =========================
  
let camX = 0, camY = 0, zoom = 0.82;

// =========================
// Boss camera pull (SAFE)
// =========================
let bossCam = {
  active: false,
  t: 0,
  dur: 1.2,
  x: 0,
  y: 0
};

function startBossCameraPull(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!Number.isFinite(camX) || !Number.isFinite(camY)) return;
  bossCam.active = true;
  bossCam.t = 0;
  bossCam.x = -x;
  bossCam.y = -y;
}

function updateBossCamera(dt) {
  if (!bossCam.active) return;
  bossCam.t += dt;
  const k = Math.min(bossCam.t / bossCam.dur, 1);
  const ease = 1 - Math.pow(1 - k, 3);
  camX = camX + (bossCam.x - camX) * ease * 0.18;
  camY = camY + (bossCam.y - camY) * ease * 0.18;
  if (k >= 1) bossCam.active = false;
}

  let dragging = false, lastX = 0, lastY = 0;
  let selected = 0;
  let focusOn = false;
  let isInteracting = false;

  // =========================
  // World shake (TONED DOWN)
  // =========================
  let shakeMag = 0;
  let shakeEnd = 0;
  let shakeSeed = rand(0, 9999);
  const SHAKE_SCALE = 0.42;        // global reduction
  const SHAKE_COOLDOWN_MS = 180;   // prevent constant shaking
  let lastShakeAt = 0;

  function worldShake(mag = 10, ms = 520) {
    const now = performance.now();
    let m = mag * SHAKE_SCALE;

    // if shakes are happening constantly, damp them hard
    if (now - lastShakeAt < SHAKE_COOLDOWN_MS) m *= 0.32;
    lastShakeAt = now;

    shakeMag = Math.max(shakeMag, m);
    shakeEnd = now + ms;
    shakeSeed = rand(0, 9999);
  }

  function applyShake(timeMs) {
    if (timeMs > shakeEnd) return { sx: 0, sy: 0 };
    const t = timeMs * 0.024;
    const s = shakeMag * (0.55 + 0.45 * Math.sin(timeMs * 0.014));
    const sx = Math.sin(t + shakeSeed) * s;
    const sy = Math.cos(t * 1.13 - shakeSeed) * s;
    return { sx, sy };
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
    return (best !== -1 && bestD < 280 * 280) ? best : -1;
  }

  // Drag pan
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    isInteracting = true;
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    camX += dx / zoom;
    camY += dy / zoom;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    // tap select
    const w = toWorld(e.clientX, e.clientY);
    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      updateInspector();
      pushLog("event", `Selected Colony #${idx + 1}`);
      if (focusOn) centerOnSelected(true);
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  }, { passive: true });

  // wheel zoom desktop
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.8);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  // double tap center mobile
  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    if (!smooth) { camX = -c.x; camY = -c.y; return; }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

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
    zoom = clamp(fit * 0.92, 0.55, 1.7);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx; camY = -cy;
  }

  // =========================
  // Background
  // =========================
  const bg = {
    canvas: document.createElement("canvas"),
    ctx: null,
    w: 0, h: 0,
  };
  bg.ctx = bg.canvas.getContext("2d");

  function makeStarfield() {
    bg.w = 900;
    bg.h = 900;
    bg.canvas.width = bg.w;
    bg.canvas.height = bg.h;

    const b = bg.ctx;
    b.clearRect(0, 0, bg.w, bg.h);

    // nebula blobs
    for (let i = 0; i < 10; i++) {
      const x = rand(0, bg.w), y = rand(0, bg.h);
      const r = rand(160, 360);
      const hue = rand(180, 320);
      const g = b.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${hue}, 95%, 60%, ${rand(0.08, 0.16)})`);
      g.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
      b.fillStyle = g;
      b.beginPath();
      b.arc(x, y, r, 0, Math.PI * 2);
      b.fill();
    }

    // galaxy swirls
    b.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const cx = rand(0, bg.w), cy = rand(0, bg.h);
      const baseR = rand(120, 260);
      const hue = rand(170, 310);
      b.strokeStyle = `hsla(${hue}, 95%, 70%, ${rand(0.06, 0.12)})`;
      b.lineWidth = rand(1.2, 2.4);
      for (let k = 0; k < 6; k++) {
        b.beginPath();
        const start = rand(0, Math.PI * 2);
        const span = rand(Math.PI * 0.6, Math.PI * 1.2);
        for (let t = 0; t <= 1.001; t += 0.06) {
          const a = start + span * t;
          const rr = baseR * (0.55 + t * 0.75) + Math.sin(t * 6 + i) * 10;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (t === 0) b.moveTo(x, y);
          else b.lineTo(x, y);
        }
        b.stroke();
      }
    }
    b.globalCompositeOperation = "source-over";

    // stars
    for (let i = 0; i < 1400; i++) {
      const x = rand(0, bg.w), y = rand(0, bg.h);
      const r = Math.random() < 0.90 ? rand(0.3, 1.2) : rand(1.2, 2.2);
      const a = Math.random() < 0.92 ? rand(0.35, 0.75) : rand(0.75, 0.95);
      const hue = Math.random() < 0.85 ? 210 : rand(180, 320);
      b.fillStyle = `hsla(${hue}, 95%, 85%, ${a})`;
      b.beginPath();
      b.arc(x, y, r, 0, Math.PI * 2);
      b.fill();

      if (r > 1.5 && Math.random() < 0.25) {
        b.strokeStyle = `hsla(${hue}, 95%, 90%, ${a * 0.55})`;
        b.lineWidth = 1;
        b.beginPath();
        b.moveTo(x - 4, y); b.lineTo(x + 4, y);
        b.moveTo(x, y - 4); b.lineTo(x, y + 4);
        b.stroke();
      }
    }
  }
  makeStarfield();

  function drawBackground() {
    const px = (-camX * zoom * 0.10) % bg.w;
    const py = (-camY * zoom * 0.10) % bg.h;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        ctx.drawImage(bg.canvas, px + ix * bg.w, py + iy * bg.h);
      }
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,255,255,.015)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  // =========================
  // Colony / worm models
  // =========================
  const DNA_TEMPS = ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC", "HYPER", "ZEN", "FERAL", "ROYAL"];
  const DNA_BIOMES = ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM", "EMBER WASTE", "ICE TEMPLE", "STARFIELD"];
  const DNA_STYLES = ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT", "RIBBON", "FRACTAL", "ORBIT"];

  function makeDnaCode(c) {
    const a = Math.floor((c.dna.hue % 360));
    const b = Math.floor(c.dna.chaos * 99);
    const d = Math.floor(c.dna.drift * 99);
    const e = Math.floor(c.dna.aura * 99);
    const f = Math.floor(c.dna.limbiness * 99);
    return `H${a}-C${b}-D${d}-A${e}-L${f}`;
  }

  function makeColonyOutline(dna) {
    const pts = [];
    const baseR = 120 * dna.aura;
    const spikes = randi(9, 16);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const wob =
        Math.sin(a * (2.0 + dna.chaos) + dna.seed) * (18 + 18 * dna.chaos) +
        Math.sin(a * (5.0 + dna.drift) - dna.seed * 0.7) * (10 + 12 * dna.drift);
      const r = baseR + wob;
      pts.push({ a, r });
    }
    return pts;
  }

  function newColony(x, y, hue = rand(0, 360)) {
    const id = Math.random().toString(16).slice(2, 6).toUpperCase();
    const dna = {
      hue,
      chaos: rand(0.55, 1.45),
      drift: rand(0.55, 1.45),
      aura: rand(1.0, 1.8),
      limbiness: rand(0.20, 1.25),
      temperament: DNA_TEMPS[randi(0, DNA_TEMPS.length - 1)],
      biome: DNA_BIOMES[randi(0, DNA_BIOMES.length - 1)],
      style: DNA_STYLES[randi(0, DNA_STYLES.length - 1)],
      seed: rand(0, 9999)
    };

    return {
      id,
      x, y,
      vx: rand(-0.18, 0.18),
      vy: rand(-0.18, 0.18),
      dna,
      outline: makeColonyOutline(dna),
      worms: [],
      shock: [],
      freezeT: 0,
      mutHistory: [],
      foundingT: 0,
    };
  }

  function addLimb(w, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(40, 120) : rand(24, 82),
      ang: rand(-1.6, 1.6),
      wob: rand(0.7, 2.0)
    });
  }

  function bossLabel(special) {
    return (
      special === "SOL_STORM" ? "⚡ SOLANA STORM" :
      special === "FIRE_DOGE" ? "🔥 FIRE DOGE" :
      special === "ICE_QUEEN" ? "❄️ ICE QUEEN" :
      special === "HYDRAWORM" ? "🐉 HYDRAWORM" :
      special === "MOONJUDGE" ? "🌙 MOONJUDGE WYRM" :
      special === "WHALE_SUMMONER" ? "🐋 WHALE SUMMONER" :
      special === "BREAKER_OF_BOOKS" ? "📚 BREAKER OF BOOKS" :
      special === "VIRAL_VIPER" ? "🧬 VIRAL VIPER" :
      special === "PHARAOHWORM" ? "👑 PARABOLIC PHARAOH" :
      special === "MEMELORD" ? "😈 MEMELORD MEGAWORM" :
      special === "VALIDATOR_VORTEX" ? "🌀 VALIDATOR VORTEX" :
      special === "EVENT_HORIZON" ? "🕳️ EVENT HORIZON EEL" :
      special === "WYRM_EMPEROR" ? "🏁 WYRM EMPEROR" :
      "👑 BOSS"
    );
  }

  function newWorm(col, big = false, special = null) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(20, 34) : randi(12, 22);
    const baseLen = big ? rand(10, 16) : rand(7, 12);

    const spawnAng = rand(0, Math.PI * 2);
    const spawnRad = rand(40, 140);
    let px = col.x + Math.cos(spawnAng) * spawnRad;
    let py = col.y + Math.sin(spawnAng) * spawnRad;

    let ang = rand(0, Math.PI * 2);

    const paletteShift = rand(-160, 160);
    const hueBase = (col.dna.hue + paletteShift + 360) % 360;

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue: hueBase,
      width: big ? rand(7, 12) : rand(4.4, 7.2),
      speed: big ? rand(0.38, 0.84) : rand(0.52, 1.16),
      turn: rand(0.012, 0.028) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),

      orbitDir: Math.random() < 0.5 ? -1 : 1,
      roamBias: rand(0.12, 0.34),

      pat: {
        stripe: Math.random() < 0.75,
        dots: Math.random() < 0.45,
        dual: Math.random() < 0.45,
        hue2: (hueBase + rand(40, 150)) % 360,
        sparkle: Math.random() < 0.35,
      },

      limbs: [],
      segs: [],
      isBoss: false,
      special: special || null,

      bossPulse: rand(0, 9999),
      sparks: [],
      breath: [],

      wanderA: rand(0, Math.PI * 2),
      wanderT: rand(0, 9999),
      roamR: rand(120, 320),
      roamR2: rand(0, Math.PI * 2),
      huntT: 0,

      mission: null,
      trail: [],
    };

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.35, 0.35) * col.dna.chaos;
    }

    const limbChance = clamp(0.10 + col.dna.limbiness * 0.22, 0.12, 0.60);
    if (Math.random() < limbChance) addLimb(w, big);

    // -------------------------
    // BOSS PROFILES (different behavior + different visuals)
    // -------------------------
    if (special) {
      w.isBoss = true;

      // defaults for bosses
      w.width *= 2.05;
      w.speed *= 1.00;
      w.turn *= 0.90;
      w.pat.sparkle = true;

      // personal spacing so bosses don't stack on top of each other
      w.bossPersonalSpace = rand(240, 420);
      w.roamR = rand(260, 520);
      w.roamR2 = rand(0, Math.PI * 2);
      w.roamBias = rand(0.18, 0.42);

      // make each boss feel distinct
      switch (special) {
        case "SOL_STORM":
          w.hue = 175; w.pat.hue2 = 285;
          w.speed *= 1.06; w.turn *= 1.20;
          w.roamR = rand(360, 720);
          for (let i = 0; i < 7; i++) addLimb(w, true);
          break;

        case "FIRE_DOGE":
          w.hue = 22; w.pat.hue2 = 55;
          w.speed *= 1.12; w.turn *= 1.05;
          w.roamR = rand(220, 520);
          w.__chargeEvery = rand(900, 1500);
          for (let i = 0; i < 7; i++) addLimb(w, true);
          break;

        case "ICE_QUEEN":
          w.hue = 200; w.pat.hue2 = 265;
          w.speed *= 0.92; w.turn *= 0.82;
          w.roamR = rand(420, 820);
          for (let i = 0; i < 8; i++) addLimb(w, true);
          break;

        case "HYDRAWORM":
          w.hue = 140; w.pat.hue2 = 320;
          w.width *= 1.12; w.speed *= 0.98; w.turn *= 1.08;
          w.roamR = rand(320, 720);
          for (let i = 0; i < 9; i++) addLimb(w, true);
          break;

        case "MOONJUDGE":
          w.hue = 265; w.pat.hue2 = 55;
          w.speed *= 0.96; w.turn *= 0.95;
          w.roamR = rand(520, 920);
          for (let i = 0; i < 8; i++) addLimb(w, true);
          break;

        case "WHALE_SUMMONER":
          w.hue = 195; w.pat.hue2 = 170;
          w.speed *= 0.90; w.width *= 1.18;
          w.roamR = rand(420, 900);
          for (let i = 0; i < 10; i++) addLimb(w, true);
          break;

        case "BREAKER_OF_BOOKS":
          w.hue = 32; w.pat.hue2 = 300;
          w.speed *= 1.00; w.turn *= 1.18;
          w.roamR = rand(300, 760);
          for (let i = 0; i < 9; i++) addLimb(w, true);
          break;

        case "VIRAL_VIPER":
          w.hue = 105; w.pat.hue2 = 205;
          w.speed *= 1.18; w.turn *= 1.10;
          w.roamR = rand(240, 620);
          for (let i = 0; i < 8; i++) addLimb(w, true);
          break;

        case "PHARAOHWORM":
          w.hue = 48; w.pat.hue2 = 55;
          w.width *= 1.20; w.speed *= 0.92;
          w.roamR = rand(520, 980);
          for (let i = 0; i < 11; i++) addLimb(w, true);
          break;

        case "MEMELORD":
          w.hue = 305; w.pat.hue2 = 175;
          w.width *= 1.25; w.speed *= 0.96;
          w.roamR = rand(480, 980);
          for (let i = 0; i < 12; i++) addLimb(w, true);
          break;

        case "VALIDATOR_VORTEX":
          w.hue = 185; w.pat.hue2 = 290;
          w.speed *= 1.02; w.turn *= 1.30;
          w.roamR = rand(420, 980);
          for (let i = 0; i < 10; i++) addLimb(w, true);
          break;

        case "EVENT_HORIZON":
          w.hue = 230; w.pat.hue2 = 340;
          w.speed *= 0.88; w.width *= 1.35;
          w.roamR = rand(620, 1120);
          for (let i = 0; i < 10; i++) addLimb(w, true);
          break;

        case "WYRM_EMPEROR":
          w.hue = 20; w.pat.hue2 = 175;
          w.width *= 1.45; w.speed *= 0.94; w.turn *= 1.10;
          w.roamR = rand(720, 1400);
          for (let i = 0; i < 14; i++) addLimb(w, true);
          break;
      }

      // boss cadence: do something every 15–20s (first sooner)
      w.__nextBossUlt = performance.now() + rand(5500, 9000);
    }

    return w;
  }

  // World state
  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  // =========================
  // Inspector
  // =========================
  let inspectorCollapsed = false;

  function updateInspector() {
    const c = colonies[selected];
    if (!c || !inspector) return;

    if (elSelName) elSelName.textContent = `Colony #${selected + 1} • ${c.id}`;
    if (elDnaVal) elDnaVal.textContent = makeDnaCode(c);
    if (elTempVal) elTempVal.textContent = c.dna.temperament;
    if (elBiomeVal) elBiomeVal.textContent = c.dna.biome;
    if (elStyleVal) elStyleVal.textContent = c.dna.style;

    if (mutListEl) {
      mutListEl.innerHTML = "";
      const list = c.mutHistory.slice(0, 8);
      if (!list.length) {
        const d = document.createElement("div");
        d.className = "mutItem";
        d.textContent = "No mutations yet.";
        mutListEl.appendChild(d);
      } else {
        for (const line of list) {
          const d = document.createElement("div");
          d.className = "mutItem";
          d.textContent = line;
          mutListEl.appendChild(d);
        }
      }
    }
  }

  if (btnToggleInspector && inspectorBody) {
    btnToggleInspector.addEventListener("click", () => {
      inspectorCollapsed = !inspectorCollapsed;
      inspectorBody.style.display = inspectorCollapsed ? "none" : "block";
      btnToggleInspector.textContent = inspectorCollapsed ? "▸" : "▾";
    });
  }

  // =========================
  // Shockwaves + particles (MORE SUBTLE)
  // =========================
  function shockwave(col, strength = 1, hueOverride = null) {
    col.shock.push({
      r: 0,
      v: 2.4 + strength * 1.2,            // slower ring
      a: 0.58 + strength * 0.08,          // lower alpha
      w: 1.5 + strength * 0.9,            // thinner
      hue: hueOverride
    });
    playSfx("shock", strength * 0.9);
  }

  // =========================
  // Flow field + angle helpers
  // =========================
  function flowAngle(x, y, time) {
    const t = time * 0.00025;
    const nx = x * 0.0022;
    const ny = y * 0.0022;
    return (
      Math.sin(nx + t) * 1.2 +
      Math.cos(ny - t * 1.3) * 1.0 +
      Math.sin((nx + ny) * 0.7 + t * 1.8) * 0.8
    );
  }

  function lerpAngle(a, b, t) {
    const d = (((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }

  // =========================
  // Drawing helpers
  // =========================
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function strokePath(points, width, color, glow = null) {
    if (glow) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = glow;
      ctx.lineWidth = width + 8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  // MORE BOSS DETAILS + UNIQUE SHAPES PER BOSS
  function drawBossFX(w, time) {
    const head = w.segs[0];
    if (!head) return;

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.003 + w.bossPulse);
    const ringR = 18 + w.width * 1.25 + pulse * 7;

    ctx.globalCompositeOperation = "lighter";

    // base halos
    aura(head.x, head.y, ringR * 4.2, w.hue, 0.10 + pulse * 0.05);
    aura(head.x, head.y, ringR * 2.8, (w.pat.hue2 ?? ((w.hue + 90) % 360)), 0.05 + pulse * 0.05);

    // unique rune ring
    const runeCount =
      w.special === "SOL_STORM" ? 18 :
      w.special === "FIRE_DOGE" ? 14 :
      w.special === "ICE_QUEEN" ? 16 :
      w.special === "EVENT_HORIZON" ? 22 :
      16;

    ctx.strokeStyle = `hsla(${w.hue}, 95%, 72%, ${0.48 + pulse * 0.30})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(head.x, head.y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // rune ticks
    ctx.strokeStyle = `hsla(${(w.hue + 90) % 360}, 95%, 76%, ${0.22 + pulse * 0.24})`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < runeCount; i++) {
      const a = (i / runeCount) * Math.PI * 2 + time * 0.0006 * (w.special === "VALIDATOR_VORTEX" ? 2.2 : 1.0);
      const r1 = ringR + 4;
      const r2 = ringR + 14 + pulse * 4;
      ctx.beginPath();
      ctx.moveTo(head.x + Math.cos(a) * r1, head.y + Math.sin(a) * r1);
      ctx.lineTo(head.x + Math.cos(a) * r2, head.y + Math.sin(a) * r2);
      ctx.stroke();
    }

    // extra: vortex spiral for VALIDATOR_VORTEX
    if (w.special === "VALIDATOR_VORTEX") {
      ctx.strokeStyle = `hsla(${(w.hue + 30) % 360}, 95%, 72%, ${0.22 + pulse * 0.18})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const spins = 2.4;
      for (let t = 0; t <= 1.001; t += 0.04) {
        const a = t * Math.PI * 2 * spins + time * 0.0012;
        const rr = ringR + 8 + t * 26;
        const x = head.x + Math.cos(a) * rr;
        const y = head.y + Math.sin(a) * rr;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // event horizon: dark core
    if (w.special === "EVENT_HORIZON") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(head.x, head.y, ringR * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + pulse * 0.08})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(head.x, head.y, ringR * 0.86, 0, Math.PI * 2);
      ctx.stroke();
    }

    // sparks (slightly reduced)
    if (!w.__sparkT) w.__sparkT = 0;
    const sparkRate =
      w.special === "FIRE_DOGE" ? rand(55, 110) :
      w.special === "SOL_STORM" ? rand(60, 120) :
      rand(75, 145);

    if (time - w.__sparkT > sparkRate) {
      w.__sparkT = time;
      const count = randi(4, 9);
      for (let i = 0; i < count; i++) {
        w.sparks.push({
          x: head.x + rand(-14, 14),
          y: head.y + rand(-14, 14),
          vx: rand(-1.9, 1.9),
          vy: rand(-1.9, 1.9),
          a: rand(0.45, 0.85),
          h: (w.hue + rand(-60, 60) + 360) % 360
        });
      }
    }
    for (const s of w.sparks) {
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.90;
      s.vy *= 0.90;
      s.a *= 0.885;
      ctx.strokeStyle = `hsla(${s.h}, 95%, 78%, ${s.a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + rand(-8, 8), s.y + rand(-8, 8));
      ctx.stroke();
    }
    w.sparks = w.sparks.filter(s => s.a > 0.06);

    // boss trail (more distinct per boss)
    if (!w.trail) w.trail = [];
    w.trail.push({ x: head.x, y: head.y, a: 0.16 });
    const trailCap = w.special === "SOL_STORM" ? 34 : w.special === "EVENT_HORIZON" ? 42 : 28;
    if (w.trail.length > trailCap) w.trail.shift();

    for (let i = 0; i < w.trail.length; i++) {
      const p = w.trail[i];
      p.a *= 0.935;
      const hh = (w.special === "FIRE_DOGE") ? 22 :
                 (w.special === "ICE_QUEEN") ? 210 :
                 (w.special === "EVENT_HORIZON") ? 260 :
                 (w.hue + 40) % 360;

      ctx.strokeStyle = `hsla(${hh}, 95%, 70%, ${p.a})`;
      ctx.lineWidth = (w.special === "EVENT_HORIZON" ? 14 : 10) + i * 0.12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.0 + i * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.font = "950 13px system-ui, -apple-system, Inter, sans-serif";
    ctx.fillStyle = "rgba(245,250,255,.95)";
    ctx.fillText(bossLabel(w.special), head.x + 16, head.y - 16);
  }

  function drawWorm(w, time) {
    const pts = w.segs;
    if (!pts.length) return;

    const glowA = w.isBoss
      ? `hsla(${w.hue}, 95%, 65%, .44)`
      : `hsla(${w.hue}, 95%, 65%, .14)`;

    strokePath(
      pts,
      w.width,
      `hsla(${w.hue}, 95%, 65%, .94)`,
      isInteracting ? null : glowA
    );

    // patterns (skip when interacting)
    if (!isInteracting) {
      for (let i = 0; i < pts.length; i += 2) {
        const p = pts[i];
        const t = i / Math.max(1, pts.length - 1);
        const stripeOn = w.pat.stripe && (i % 6 < 3);
        const useHue = (w.pat.dual && stripeOn) ? w.pat.hue2 : w.hue;

        const r = Math.max(1.6, w.width * (0.30 + 0.18 * Math.sin(t * 10 + w.phase)));
        ctx.fillStyle = `hsla(${useHue}, 95%, ${stripeOn ? 70 : 62}%, .88)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        if (w.pat.dots && (i % 8 === 0)) {
          ctx.fillStyle = `hsla(${(useHue + 30) % 360}, 95%, 78%, .78)`;
          ctx.beginPath();
          ctx.arc(
            p.x + Math.sin(t * 8 + time * 0.003) * 2,
            p.y + Math.cos(t * 8 + time * 0.003) * 2,
            r * 0.55,
            0, Math.PI * 2
          );
          ctx.fill();
        }

        if (w.pat.sparkle && (i % 10 === 0)) {
          ctx.strokeStyle = `hsla(${(useHue + 90) % 360}, 95%, 88%, .26)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y);
          ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3);
          ctx.stroke();
        }
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

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 68%, ${isInteracting ? 0.30 : 0.60})`;
        ctx.lineWidth = Math.max(2.2, w.width * 0.38);
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

    // boss attention FX
    if (w.isBoss && !isInteracting) drawBossFX(w, time);

    // draw breath particles
    if (w.breath?.length && !isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      for (const p of w.breath) {
        ctx.fillStyle = `hsla(${p.h}, 95%, ${p.l}%, ${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawColony(col, time) {
    const hue = col.dna.hue;

    const grow = col.foundingT > 0 ? clamp(col.foundingT / 1.2, 0, 1) : 1;
    const auraScale = 0.55 + 0.45 * grow;

    if (!isInteracting) {
      aura(col.x, col.y, 200 * col.dna.aura * auraScale, hue, 0.18 * grow);
      aura(col.x, col.y, 150 * col.dna.aura * auraScale, (hue + 40) % 360, 0.11 * grow);
      aura(col.x, col.y, 100 * col.dna.aura * auraScale, (hue + 110) % 360, 0.07 * grow);
    } else {
      aura(col.x, col.y, 150 * col.dna.aura * auraScale, hue, 0.12 * grow);
    }

    ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.30 * grow})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < col.outline.length; i++) {
      const o = col.outline[i];
      const wob = Math.sin(time * 0.0014 + o.a * 3 + col.dna.seed) * 8 * grow;
      const r = (o.r + wob) * (0.70 + 0.30 * grow);
      const px = col.x + Math.cos(o.a) * r;
      const py = col.y + Math.sin(o.a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    if (colonies[selected] === col) {
      ctx.strokeStyle = `hsla(${hue}, 95%, 65%, .62)`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(col.x, col.y, 108 * col.dna.aura, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of col.shock) {
      const hh = (s.hue ?? hue);
      ctx.strokeStyle = `hsla(${hh}, 92%, 62%, ${s.a})`;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.arc(col.x, col.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (col.freezeT > 0) {
      ctx.globalCompositeOperation = "lighter";
      aura(col.x, col.y, 240 * col.dna.aura, 200, 0.10 * clamp(col.freezeT / 2.6, 0, 1));
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // =========================
  // Colony founding via worm travel
  // =========================
  function scheduleFounderMission() {
    if (colonies.length >= MAX_COLONIES) return;

    let bestCol = colonies[0];
    for (const c of colonies) if (c.worms.length > bestCol.worms.length) bestCol = c;

    const candidates = bestCol.worms.filter(w => !w.isBoss && !w.mission);
    if (!candidates.length) return;

    const w = candidates[randi(0, candidates.length - 1)];

    let tx = 0, ty = 0;
    for (let tries = 0; tries < 30; tries++) {
      const ang = rand(0, Math.PI * 2);
      const dist = rand(520, 880) + colonies.length * rand(20, 60);
      tx = bestCol.x + Math.cos(ang) * dist;
      ty = bestCol.y + Math.sin(ang) * dist;

      let ok = true;
      for (const c of colonies) {
        if (Math.hypot(c.x - tx, c.y - ty) < 420) { ok = false; break; }
      }
      if (ok) break;
    }

    w.mission = {
      type: "FOUND_COLONY",
      tx, ty,
      startedT: performance.now(),
      etaT: performance.now() + rand(8000, 14000)
    };

    pushLog("event", `A worm begins a migration to found a new colony…`);
    setToast("🐛 Colony expedition launched");
  }

  function completeFounderMission(w, tx, ty, fromCol) {
    const nc = newColony(tx, ty, (fromCol.dna.hue + rand(-120, 120) + 360) % 360);
    nc.foundingT = 1.2;

    w.mission = null;

    const head = w.segs[0];
    if (head) {
      const a = rand(0, Math.PI * 2);
      head.x = tx + Math.cos(a) * 90;
      head.y = ty + Math.sin(a) * 90;
      head.a = rand(0, Math.PI * 2);
      for (let i = 1; i < w.segs.length; i++) {
        const prev = w.segs[i - 1];
        const seg = w.segs[i];
        seg.x = prev.x - Math.cos(prev.a) * seg.len;
        seg.y = prev.y - Math.sin(prev.a) * seg.len;
        seg.a = prev.a;
      }
    }

    fromCol.worms = fromCol.worms.filter(x => x !== w);
    nc.worms.push(w);
    nc.worms.push(newWorm(nc, Math.random() < 0.25));
    nc.worms.push(newWorm(nc, Math.random() < 0.25));

    colonies.push(nc);
    shockwave(nc, 1.2);
    worldShake(7, 420);

    pushLog("mile", `New colony founded by migration!`, fmt(mcap));
    pulseBigToast("🌱 NEW COLONY FOUNDED!");
  }

  // =========================
  // Worm behavior
  // =========================
  function bossSeparationSteer(col, w, head) {
    // keep bosses from clumping
    if (!w.isBoss) return null;

    let ax = 0, ay = 0;
    let hit = 0;
    const personal = w.bossPersonalSpace || 300;

    for (const other of col.worms) {
      if (!other?.isBoss || other === w) continue;
      const oh = other.segs?.[0];
      if (!oh) continue;
      const dx = head.x - oh.x;
      const dy = head.y - oh.y;
      const d = Math.hypot(dx, dy);
      if (d > 1 && d < personal) {
        const k = (personal - d) / personal;
        ax += (dx / d) * k;
        ay += (dy / d) * k;
        hit++;
      }
    }
    if (!hit) return null;
    return Math.atan2(ay, ax);
  }

  function wormBehavior(col, w, time, dt) {
    const head = w.segs[0];
    if (!head) return;

    const freezeSlow = col.freezeT > 0 ? 0.55 : 1.0;

    // -------- mission mode --------
    if (w.mission?.type === "FOUND_COLONY") {
      const { tx, ty, etaT } = w.mission;

      const dx = tx - head.x;
      const dy = ty - head.y;
      const toward = Math.atan2(dy, dx);

      const field = flowAngle(head.x, head.y, time);
      const drift = Math.sin((time + w.wanderT) * 0.0012) * 0.45;
      const desired = lerpAngle(toward, field, 0.22) + drift;

      head.a = lerpAngle(head.a, desired, 0.18);
      const sp = w.speed * 3.2 * freezeSlow * (w.isBoss ? 1.2 : 1.0);
      head.x += Math.cos(head.a) * sp;
      head.y += Math.sin(head.a) * sp;

      for (let i = 1; i < w.segs.length; i++) {
        const prev = w.segs[i - 1];
        const seg = w.segs[i];
        const vx = seg.x - prev.x;
        const vy = seg.y - prev.y;
        const ang = Math.atan2(vy, vx);
        const targetX = prev.x + Math.cos(ang) * seg.len;
        const targetY = prev.y + Math.sin(ang) * seg.len;
        seg.x = seg.x * 0.22 + targetX * 0.78;
        seg.y = seg.y * 0.22 + targetY * 0.78;
        seg.a = ang;
      }

      const dist = Math.hypot(dx, dy);
      if (dist < 120 || time >= etaT) {
        completeFounderMission(w, tx, ty, col);
      }
      return;
    }

    // roam target refresh
    if (!w.__roamChange) w.__roamChange = time + rand(700, 1600);
    if (time >= w.__roamChange) {
      w.__roamChange = time + rand(700, 1600);
      w.roamR = clamp(w.roamR + rand(-90, 90), w.isBoss ? 220 : 90, w.isBoss ? 1400 : 380);
      w.roamR2 = rand(0, Math.PI * 2);

      // FIRE_DOGE: frequent charge bursts
      if (w.isBoss && w.special === "FIRE_DOGE") {
        w.huntT = rand(0.55, 1.25);
        w.wanderA = rand(0, Math.PI * 2);
      } else if (Math.random() < 0.35) {
        w.huntT = rand(0.35, 0.9);
        w.wanderA = rand(0, Math.PI * 2);
      }
    }

    const ringX = col.x + Math.cos(w.roamR2 + Math.sin(time * 0.001 + w.phase) * 0.55) * w.roamR;
    const ringY = col.y + Math.sin(w.roamR2 + Math.cos(time * 0.0013 + w.phase) * 0.55) * w.roamR;

    const toCenter = Math.hypot(head.x - col.x, head.y - col.y);
    const centerRepel = clamp((120 - toCenter) / 120, 0, 1);

    const field = flowAngle(head.x, head.y, time);
    const jitter = Math.sin(time * 0.002 + w.phase) * 0.10;

    const toRing = Math.atan2(ringY - head.y, ringX - head.x);
    const toCol = Math.atan2(col.y - head.y, col.x - head.x);

    let desired = toRing;

    // worm types feel different
    if (w.type === "DRIFTER") {
      desired = lerpAngle(toRing, field, 0.32 + w.roamBias);
    } else if (w.type === "ORBITER") {
      const orbit = toCol + w.orbitDir * (0.9 + 0.35 * Math.sin(time * 0.001 + w.phase));
      desired = lerpAngle(orbit, field, 0.28 + w.roamBias);
    } else {
      const orbit = toCol + w.orbitDir * (0.8 + 0.45 * Math.sin(time * 0.0012 + w.phase));
      desired = lerpAngle(lerpAngle(toRing, orbit, 0.55), field, 0.30 + w.roamBias);
    }

    // bosses: unique steering flavor
    if (w.isBoss) {
      if (w.special === "SOL_STORM") desired = lerpAngle(desired, field, 0.42);          // flow-driven
      if (w.special === "ICE_QUEEN") desired = lerpAngle(desired, toCol + 1.2, 0.22);    // regal orbit
      if (w.special === "VALIDATOR_VORTEX") desired = lerpAngle(desired, toCol + w.orbitDir * 1.6, 0.30); // hard spiral
      if (w.special === "EVENT_HORIZON") desired = lerpAngle(desired, toCol, 0.18);      // ominous center pull
    }

    // repel from colony center if too close
    if (centerRepel > 0) {
      const away = Math.atan2(head.y - col.y, head.x - col.x);
      desired = lerpAngle(desired, away, 0.55 * centerRepel);
    }

    // repel bosses from each other (prevents clumping)
    const sepA = bossSeparationSteer(col, w, head);
    if (sepA !== null) {
      desired = lerpAngle(desired, sepA, 0.38);
    }

    // burst/zigzag
    if (w.huntT > 0) {
      w.huntT = Math.max(0, w.huntT - dt);
      desired = lerpAngle(desired, w.wanderA, w.isBoss ? 0.42 : 0.35);
    }

    const turnAmt = w.turn * (0.95 + 0.25 * Math.sin(time * 0.001 + w.phase));
    head.a = lerpAngle(head.a, desired, clamp(turnAmt * 9.0, 0.07, w.isBoss ? 0.28 : 0.24));
    head.a += (Math.random() - 0.5) * turnAmt + jitter * 0.55;

    const boost = w.isBoss ? 1.65 : 1.0;
    const spBase = w.speed * 2.45 * boost * freezeSlow;

    // FIRE_DOGE charge punch
    let sp = spBase;
    if (w.isBoss && w.special === "FIRE_DOGE") {
      const pulse = 0.65 + 0.35 * Math.sin(time * 0.003 + w.phase);
      sp = spBase * (1.06 + pulse * 0.18);
    }

    // EVENT HORIZON slow/heavy
    if (w.isBoss && w.special === "EVENT_HORIZON") sp *= 0.92;

    head.x += Math.cos(head.a) * sp;
    head.y += Math.sin(head.a) * sp;

    // leash (bosses roam wider)
    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const leash = (w.isBoss ? 860 : 420) + 110 * col.dna.aura + (w.isBoss ? w.roamR * 0.25 : 0);
    if (d > leash) {
      head.x = col.x + (head.x - col.x) * 0.92;
      head.y = col.y + (head.y - col.y) * 0.92;
      head.a = lerpAngle(head.a, toCol, 0.22);
    }

    // follow segments
    for (let i = 1; i < w.segs.length; i++) {
      const prev = w.segs[i - 1];
      const seg = w.segs[i];

      const vx = seg.x - prev.x;
      const vy = seg.y - prev.y;
      const ang = Math.atan2(vy, vx);

      const targetX = prev.x + Math.cos(ang) * seg.len;
      const targetY = prev.y + Math.sin(ang) * seg.len;

      seg.x = seg.x * 0.22 + targetX * 0.78;
      seg.y = seg.y * 0.22 + targetY * 0.78;
      seg.a = ang;
    }

    // Boss ultimates
    if (w.isBoss) {
      if (!w.__nextBossUlt) w.__nextBossUlt = time + rand(15000, 20000);
      if (time >= w.__nextBossUlt) {
        w.__nextBossUlt = time + rand(15000, 20000);
        bossUltimate(col, w, time);
      }
    }

    // decay breath particles
    if (w.breath?.length) {
      for (const p of w.breath) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.965;
        p.vy *= 0.965;
        p.a *= 0.935;
        p.r *= 0.985;
      }
      w.breath = w.breath.filter(p => p.a > 0.05 && p.r > 0.7);
    }
  }

  // =========================
  // Boss Ultimate FX (varies per boss; shakes are subtle)
  // =========================
  function spray(w, head, dir, count, hueA, hueB, speedA, speedB, rA, rB, lA, lB, spread = 1.0) {
    for (let k = 0; k < count; k++) {
      const a = dir + rand(-0.8, 0.8) * spread;
      w.breath.push({
        x: head.x + rand(-10, 10),
        y: head.y + rand(-10, 10),
        vx: Math.cos(a) * rand(speedA, speedB),
        vy: Math.sin(a) * rand(speedA, speedB),
        r: rand(rA, rB),
        a: rand(0.40, 0.85),
        h: rand(hueA, hueB),
        l: rand(lA, lB),
      });
    }
  }

  function bossUltimate(col, w, time) {
    const head = w.segs[0];
    if (!head) return;

    const name = bossLabel(w.special);
    pushLog("boss", `BOSS ULT: ${name}!`);
    pulseBigToast(`${name}!`);
    playSfx("boss", 1.05);

    // default subtle shake + ring
    worldShake(10, 520);
    shockwave(col, 1.4, w.hue);

    const dir = head.a;

    // each boss does different visuals + small gameplay flavor
    switch (w.special) {
      case "FIRE_DOGE":
        playSfx("fire", 1.0);
        worldShake(12, 560);
        shockwave(col, 1.6, 22);
        spray(w, head, dir, 160, 10, 48, 2.6, 6.6, 2.4, 7.0, 58, 74, 0.9);
        break;

      case "SOL_STORM":
        playSfx("storm", 1.0);
        worldShake(13, 650);
        for (let i = 0; i < 3; i++) shockwave(col, 1.4 - i * 0.15, 175);
        spray(w, head, rand(0, Math.PI * 2), 140, 160, 205, 2.4, 6.6, 1.8, 4.5, 62, 82, 1.15);
        break;

      case "ICE_QUEEN":
        playSfx("ice", 1.0);
        worldShake(11, 600);
        col.freezeT = 2.4;
        shockwave(col, 1.6, 200);
        spray(w, head, rand(0, Math.PI * 2), 120, 190, 280, 2.0, 5.9, 1.8, 4.8, 70, 88, 1.05);
        break;

      case "HYDRAWORM":
        // multi-ring burst, less shake
        worldShake(9, 520);
        for (let i = 0; i < 4; i++) shockwave(col, 1.1 - i * 0.10, 140);
        spray(w, head, dir, 120, 120, 170, 2.0, 5.2, 1.8, 5.2, 58, 76, 1.25);
        // tiny bonus: hatchlings
        if (Math.random() < 0.35) {
          const total = colonies.reduce((a, c) => a + c.worms.length, 0);
          if (total < MAX_WORMS) col.worms.push(newWorm(col, Math.random() < 0.18));
        }
        break;

      case "MOONJUDGE":
        // gravity pulse: pulls worms inward briefly (soft)
        worldShake(9, 520);
        shockwave(col, 1.4, 265);
        spray(w, head, dir + Math.PI, 140, 250, 290, 1.6, 4.6, 1.8, 4.8, 62, 86, 0.95);
        for (const ww of col.worms) {
          if (ww === w) continue;
          ww.__roamChange = time + rand(120, 420); // force target shuffle
          ww.roamR = clamp(ww.roamR * rand(0.85, 1.05), 90, ww.isBoss ? 1400 : 380);
        }
        break;

      case "WHALE_SUMMONER":
        worldShake(10, 560);
        shockwave(col, 1.5, 195);
        spray(w, head, rand(0, Math.PI * 2), 160, 165, 210, 1.8, 5.4, 2.2, 6.0, 60, 82, 1.15);
        // economy flavor: small organic “whale splash”
        buyers += randi(1, 3);
        volume += rand(1800, 5200);
        mcap += rand(3500, 11000);
        break;

      case "BREAKER_OF_BOOKS":
        worldShake(10, 560);
        shockwave(col, 1.5, 32);
        spray(w, head, dir, 150, 25, 80, 2.2, 5.8, 2.0, 6.2, 58, 78, 1.0);
        // mutation burst (keeps your mechanics)
        for (let i = 0; i < 2; i++) if (Math.random() < 0.7) mutateRandom();
        break;

      case "VIRAL_VIPER":
        worldShake(11, 520);
        shockwave(col, 1.6, 105);
        spray(w, head, dir, 170, 90, 210, 2.6, 7.0, 1.8, 5.0, 62, 84, 1.05);
        // temporary spawn acceleration
        w.__viralBoostT = time + 6000;
        break;

      case "PHARAOHWORM":
        worldShake(9, 560);
        shockwave(col, 1.6, 48);
        spray(w, head, rand(0, Math.PI * 2), 180, 42, 62, 1.8, 5.6, 2.2, 6.4, 64, 86, 1.2);
        break;

      case "MEMELORD":
        worldShake(10, 620);
        shockwave(col, 1.7, 305);
        spray(w, head, rand(0, Math.PI * 2), 200, 280, 340, 2.0, 6.2, 2.0, 6.5, 60, 84, 1.25);
        break;

      case "VALIDATOR_VORTEX":
        worldShake(11, 650);
        shockwave(col, 1.8, 185);
        spray(w, head, dir + Math.PI * 0.5, 190, 175, 300, 2.4, 6.6, 1.6, 4.6, 60, 84, 1.35);
        break;

      case "EVENT_HORIZON":
        worldShake(8, 650);
        shockwave(col, 1.6, 260);
        // inward pull particles
        spray(w, head, dir + Math.PI, 160, 240, 300, 1.2, 4.2, 1.6, 4.0, 52, 74, 0.9);
        break;

      case "WYRM_EMPEROR":
        worldShake(12, 820);
        shockwave(col, 2.0, w.hue);
        // “final form” double spray
        spray(w, head, dir, 220, 10, 70, 2.4, 6.8, 2.4, 7.2, 58, 86, 1.25);
        spray(w, head, dir + Math.PI, 160, 160, 320, 1.8, 5.4, 1.8, 5.2, 58, 86, 1.15);
        break;

      default:
        // fallback
        spray(w, head, dir, 140, (w.hue + 10) % 360, (w.hue + 80) % 360, 2.0, 5.8, 1.8, 5.0, 60, 82, 1.05);
        break;
    }
  }

  // =========================
  // Mutations
  // =========================
  let mutTimer = 0;
  let spawnTimer = 0;

  function addMutationToColony(c, msg) {
    c.mutHistory.unshift(msg);
    if (c.mutHistory.length > 14) c.mutHistory.length = 14;
    if (c === colonies[selected]) updateInspector();
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];

    const roll = Math.random();
    let msg = "";

    if (roll < 0.18) {
      w.hue = (w.hue + rand(40, 160)) % 360;
      w.pat.hue2 = (w.hue + rand(40, 150)) % 360;
      msg = `Color morph • Worm ${w.id}`;
    } else if (roll < 0.34) {
      w.speed *= rand(1.05, 1.30);
      msg = `Aggression spike • Worm ${w.id}`;
    } else if (roll < 0.50) {
      w.width = clamp(w.width * rand(1.05, 1.35), 3.5, 22);
      msg = `Body growth • Worm ${w.id}`;
    } else if (roll < 0.66) {
      w.turn *= rand(1.10, 1.45);
      msg = `Turn instability • Worm ${w.id}`;
    } else if (roll < 0.80) {
      w.pat.stripe = !w.pat.stripe;
      w.pat.dots = !w.pat.dots;
      msg = `Pattern shift • Worm ${w.id}`;
    } else {
      addLimb(w, Math.random() < 0.4);
      msg = `Limb growth • Worm ${w.id}`;
    }

    addMutationToColony(c, msg);
    pushLog("mut", msg);
    playSfx("mut", 1);
    if (Math.random() < 0.18) shockwave(c, 0.7);
  }

  function maybeSpawnWorms(dt) {
    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= MAX_WORMS) return;

    const g = growthScore();

    // old mechanic preserved, just raised max
    const target = clamp(Math.floor(3 + g * 2.1), 3, MAX_WORMS);

    if (total >= target) return;

    // Viral Viper: temporary boost increases hatch frequency slightly
    let viralBoost = 1.0;
    for (const c of colonies) {
      for (const w of c.worms) {
        if (w.isBoss && w.special === "VIRAL_VIPER" && w.__viralBoostT && performance.now() < w.__viralBoostT) {
          viralBoost = 1.25;
          break;
        }
      }
      if (viralBoost > 1.0) break;
    }

    spawnTimer += dt * viralBoost;
    const rate = clamp(1.2 - g * 0.035, 0.08, 1.2);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.12) shockwave(c, 0.55);
      pushLog("event", "New worm hatched");
    }
  }

  // =========================
  // Colonies spawning by MC (uses travel missions)
  // =========================
  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      scheduleFounderMission();
      pushLog("event", `Milestone reached: ${fmt(nextSplitAt)} MC — expedition dispatched`);
      nextSplitAt += MC_STEP;
    }
  }

  // =========================
  // Boss milestone table (includes your new bosses)
  // =========================
  const BOSS_MILESTONES = [
    { at:  50000,  special: "SOL_STORM",        name: "SOLANA STORM WORM", hue: 175, shockHue: 175 },
    { at: 100000,  special: "FIRE_DOGE",        name: "FIRE DOGE WORM",     hue: 22,  shockHue: 22  },
    { at: 250000,  special: "ICE_QUEEN",        name: "ICE QUEEN",         hue: 200, shockHue: 200 },

    { at: 500000,  special: "HYDRAWORM",        name: "HYDRAWORM",                 hue: 140, shockHue: 140 },
    { at:1000000,  special: "MOONJUDGE",        name: "MOONJUDGE WYRM",             hue: 265, shockHue: 265 },
    { at:1500000,  special: "WHALE_SUMMONER",   name: "WHALE SUMMONER",             hue: 195, shockHue: 195 },
    { at:2000000,  special: "BREAKER_OF_BOOKS", name: "BREAKER OF BOOKS",           hue: 32,  shockHue: 32  },
    { at:2500000,  special: "VIRAL_VIPER",      name: "VIRAL VIPER WORM",           hue: 105, shockHue: 105 },
    { at:3000000,  special: "PHARAOHWORM",      name: "PARABOLIC PHARAOHWORM",      hue: 48,  shockHue: 48  },
    { at:3500000,  special: "MEMELORD",         name: "MEMELORD MEGAWORM",          hue: 305, shockHue: 305 },
    { at:4000000,  special: "VALIDATOR_VORTEX", name: "VALIDATOR VORTEX LEVIATHAN", hue: 185, shockHue: 185 },
    { at:4500000,  special: "EVENT_HORIZON",    name: "EVENT HORIZON EEL",          hue: 260, shockHue: 260 },
    { at:5000000,  special: "WYRM_EMPEROR",     name: "THE FINAL FORM: WYRM EMPEROR", hue: 20, shockHue: 20 },
  ].map(m => ({ ...m, hit: false }));

  function announceBossSpawn(name) {
    pushLog("boss", `👑 BOSS SPAWNED: ${name}!`);
    pulseBigToast(`👑 BOSS SPAWNED: ${name}!`);
    playSfx("boss", 1.1);
  }

  function checkMilestones() {
    const c = colonies[0];
    for (const m of BOSS_MILESTONES) {
      if (m.hit) continue;
      if (mcap >= m.at) {
        m.hit = true;

        const boss = newWorm(c, true, m.special);
        c.worms.push(boss);
        requestAnimationFrame(() => {
          const h = boss?.segs?.[0];
          if (h && Number.isFinite(h.x) && Number.isFinite(h.y)) {
            startBossCameraPull(h.x, h.y);
          }
        });


        // subtle spawn FX
        shockwave(c, 1.6, m.shockHue);
        worldShake(10, 620);

        // ICE QUEEN still does a little freeze on spawn (keeps your vibe)
        if (m.special === "ICE_QUEEN") c.freezeT = 2.4;

        announceBossSpawn(m.name);
        setToast(`👑 ${m.name} arrived`, 1800);
      }
    }
  }

  // =========================
  // Controls
  // =========================
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", () => { ensureAudio(); fn(); });
  }

  bind("feed", () => { volume += rand(20, 90); mcap += rand(120, 460); });
  bind("smallBuy", () => {
    buyers += 1;
    const dv = rand(180, 900), dm = rand(900, 3200);
    volume += dv; mcap += dm;
  });
  bind("whaleBuy", () => {
    const b = randi(2, 5);
    const dv = rand(2500, 8500), dm = rand(9000, 22000);
    buyers += b; volume += dv; mcap += dm;
    shockwave(colonies[0], 1.0);
  });
  bind("sell", () => {
    const dv = rand(600, 2600), dm = rand(2200, 9000);
    volume = Math.max(0, volume - dv);
    mcap = Math.max(0, mcap - dm);
  });
  bind("storm", () => {
    const dv = rand(5000, 18000), dm = rand(2000, 8000);
    volume += dv; mcap += dm;
    shockwave(colonies[0], 1.0);
    worldShake(7, 420);
  });
  bind("mutate", () => mutateRandom());
  bind("focus", () => {
    focusOn = !focusOn;
    const btn = $("focusBtn");
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
      pushLog("event", "Capture saved");
    } catch {
      pushLog("event", "Capture blocked by iOS — screenshot/share instead");
    }
  });
  bind("reset", () => location.reload());

  // =========================
  // Stats
  // =========================
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) {
      const total = colonies.reduce((a, c) => a + c.worms.length, 0);
      elWorms.textContent = String(total);
    }
  }

  // =========================
  // Main step/render
  // =========================
  function step(dt, time) {
    updateBossCamera(dt);
    trySplitByMcap();
    checkMilestones();

    // colony drift + effects
    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;

      if (c.freezeT > 0) c.freezeT = Math.max(0, c.freezeT - dt);
      if (c.foundingT > 0) c.foundingT = Math.max(0, c.foundingT - dt);

      for (const s of c.shock) {
        s.r += s.v;
        s.a *= 0.968; // slightly faster fade
      }
      c.shock = c.shock.filter((s) => s.a > 0.05);
    }

    // worms
    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time, dt);
    }

    if (focusOn) centerOnSelected(true);

    // auto mutations (unchanged)
    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.07, 0.35, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.65) mutateRandom();
    }

    maybeSpawnWorms(dt);

    // keep toast alive
    if (toast) {
      const now = performance.now();
      if (now - toastT > toastHold) toast.textContent = "Simulation Active";
      else toast.textContent = toastMsg;
    }

    updateStats();
  }

  function render(time) {
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    const sh = applyShake(time);

    ctx.save();
    ctx.translate(W / 2 + sh.sx, H / 2 + sh.sy);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    for (const c of colonies) drawColony(c, time);
    for (const c of colonies) for (const w of c.worms) drawWorm(w, time);

    ctx.restore();

    if (elStatus) elStatus.textContent = "Simulation Active";
  }

  // =========================
  // Loop (capped render FPS)
  // =========================
  let last = performance.now();
  let renderAccum = 0;
  const RENDER_FPS = 40;
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

  // =========================
  // Boot
  // =========================
  function boot() {
    resizeCanvas();
    zoomOutToFitAll();
    updateStats();
    updateInspector();

    pushLog("event", "Simulation ready");
    setToast("JS LOADED ✓ (rendering)", 1200);

    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();



// ===== SAFE BOSS CAMERA PULL (OPTION A: GENTLE NUDGE) =====
let bossCamPull = {
  active: false,
  tx: 0,
  ty: 0,
  strength: 0
};

function triggerBossCameraPull(wx, wy) {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
  bossCamPull.active = true;
  bossCamPull.tx = wx;
  bossCamPull.ty = wy;
  bossCamPull.strength = 1.0;
}

function updateBossCameraPull(dt) {
  if (!bossCamPull.active) return;
  const dx = (-bossCamPull.tx - camX);
  const dy = (-bossCamPull.ty - camY);
  camX += dx * 0.035 * bossCamPull.strength;
  camY += dy * 0.035 * bossCamPull.strength;
  bossCamPull.strength *= 0.94;
  if (bossCamPull.strength < 0.02) bossCamPull.active = false;
}

// Hook into main loop safely
const _origUpdate = update;
update = function(dt){
  _origUpdate(dt);
  try { updateBossCameraPull(dt); } catch(e){}
};
