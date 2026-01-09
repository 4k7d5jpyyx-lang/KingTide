(() => {
  "use strict";

  // ---------- On-screen debug ----------
  const dbg = document.createElement("div");
  dbg.style.cssText = `
    position:fixed; left:10px; top:10px; z-index:999999;
    padding:8px 10px; border-radius:12px;
    background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.18);
    color:rgba(235,240,248,.92); font:600 12px/1.2 system-ui, -apple-system, Inter, sans-serif;
    backdrop-filter: blur(10px);
    max-width: 78vw;
    pointer-events:none;
  `;
  dbg.textContent = "JS LOADED ✓";
  document.body.appendChild(dbg);

  function showErr(e) {
    dbg.textContent = "JS ERROR ✕ " + (e?.message || e);
    dbg.style.background = "rgba(120,0,20,.55)";
    console.error(e);
  }
  window.addEventListener("error", (ev) => showErr(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => showErr(ev.reason));

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  const TAU = Math.PI * 2;

  // deterministic hash (for procedural stars)
  function hash2i(x, y) {
    let n = (x * 374761393 + y * 668265263) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = (n * 1274126177) | 0;
    return (n ^ (n >>> 16)) >>> 0;
  }
  function h01(u32) { return (u32 & 0xfffffff) / 0xfffffff; }

  // ---------- DOM ----------
  const canvas = $("simCanvas") || $("c");
  if (!canvas) return showErr("Canvas not found (expected #simCanvas or #c).");

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return showErr("Canvas context failed.");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");

  // ---------- HARD REMOVE OLD "Selected Colony" UI (the one you circled) ----------
  // This UI is coming from your HTML. We force-hide it (even if injected later).
  function killOldSelectedPanel() {
    const nodes = Array.from(document.querySelectorAll("div,section,aside,article,main,footer,header"));
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      // Match the exact panel by content fingerprint
      if (
        t.includes("Selected") &&
        /Colony\s*#\d+/i.test(t) &&
        t.includes("DNA") &&
        t.includes("Temperament") &&
        t.includes("Biome") &&
        t.includes("Style")
      ) {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
      }
    }

    // Also hide common IDs/classes if you used them earlier
    const selectors = [
      "#selectedPanel", "#selectedColony", "#colonyInspector", "#colonyInspect",
      "#traitsPanel", "#traits", "#dnaPanel", "#dna", "#inspector",
      ".selectedPanel", ".colonyInspector", ".traitsPanel", ".inspectorPanel"
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
      });
    }
  }

  // run now + for a few seconds (covers late DOM rendering)
  killOldSelectedPanel();
  const __killTO = setInterval(killOldSelectedPanel, 400);
  setTimeout(() => clearInterval(__killTO), 8000);

  // ---------- Event Log (SIM EVENTS ONLY) ----------
  const EVENT_LOG_CAP = 18;
  let eventLogEl = $("eventLog") || null;

  function ensureEventLogBelowStats() {
    // Find a stable "stats panel" anchor: parent of buyers/volume/mcap/etc
    const anchors = [elBuyers, elVolume, elMcap, elColonies, elWorms].filter(Boolean);
    let statsBox = null;

    for (const a of anchors) {
      // find a parent that contains multiple stat ids
      let p = a;
      for (let k = 0; k < 6 && p; k++) {
        const hasMany =
          (p.querySelector?.("#buyers") && p.querySelector?.("#volume")) ||
          (p.querySelector?.("#mcap") && p.querySelector?.("#colonies")) ||
          (p.querySelector?.("#worms") && p.querySelector?.("#buyers"));
        if (hasMany) { statsBox = p; break; }
        p = p.parentElement;
      }
      if (statsBox) break;
    }

    if (!eventLogEl) {
      eventLogEl = document.createElement("div");
      eventLogEl.id = "eventLog";
      eventLogEl.style.cssText = `
        width: 100%;
        margin-top: 10px;
        max-height: 210px;
        overflow: hidden;
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
        padding: 10px;
        border-radius: 16px;
        background: rgba(0,0,0,.35);
        border: 1px solid rgba(255,255,255,.14);
        backdrop-filter: blur(10px);
        color: rgba(235,240,248,.92);
        font: 700 12px/1.2 system-ui, -apple-system, Inter, sans-serif;
        pointer-events: none;
      `;
    }

    if (statsBox && statsBox.parentElement) {
      // Insert right AFTER the stats box
      if (eventLogEl.parentElement !== statsBox.parentElement) {
        statsBox.parentElement.insertBefore(eventLogEl, statsBox.nextSibling);
      } else {
        // already in same parent: keep it right after stats
        const next = statsBox.nextSibling;
        if (next !== eventLogEl) statsBox.parentElement.insertBefore(eventLogEl, next);
      }

      // make sure it's not fixed anymore
      eventLogEl.style.position = "relative";
      eventLogEl.style.left = "auto";
      eventLogEl.style.bottom = "auto";
      eventLogEl.style.zIndex = "auto";
      return true;
    }

    // fallback (if stats not found): fixed bottom
    if (!eventLogEl.parentElement) document.body.appendChild(eventLogEl);
    eventLogEl.style.position = "fixed";
    eventLogEl.style.left = "10px";
    eventLogEl.style.bottom = "10px";
    eventLogEl.style.zIndex = "999999";
    eventLogEl.style.width = "min(420px, 92vw)";
    return false;
  }

  ensureEventLogBelowStats();

  let lastEvent = { msg: "", t: 0, count: 0 };
  function logSim(msg, kind = "EVENT") {
    ensureEventLogBelowStats();
    if (!eventLogEl) return;

    const now = Date.now();
    if (msg === lastEvent.msg && now - lastEvent.t < 1400) {
      lastEvent.count++;
      const first = eventLogEl.firstChild;
      if (first) first.textContent = `${kind}: ${msg} (x${lastEvent.count})`;
      lastEvent.t = now;
      return;
    }
    lastEvent = { msg, t: now, count: 1 };

    const d = document.createElement("div");
    d.style.cssText = `
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(0,0,0,.28);
      border: 1px solid rgba(255,255,255,.10);
    `;
    d.textContent = `${kind}: ${msg}`;
    eventLogEl.prepend(d);

    while (eventLogEl.children.length > EVENT_LOG_CAP) {
      eventLogEl.removeChild(eventLogEl.lastChild);
    }
  }

  // ---------- Sound FX (iOS-safe unlock + queue) ----------
  let audioCtx = null;
  let master = null;
  let audioUnlocked = false;
  const pendingSfx = [];

  function ensureAudio() {
    try {
      if (audioUnlocked) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;

      audioCtx = audioCtx || new AC();
      master = master || audioCtx.createGain();
      master.gain.value = 0.14;
      master.connect(audioCtx.destination);

      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.value = 0.0001;
      o.frequency.value = 220;
      o.connect(g);
      g.connect(master);
      o.start();
      o.stop(audioCtx.currentTime + 0.01);

      audioUnlocked = true;

      while (pendingSfx.length) {
        try { pendingSfx.shift()(); } catch {}
      }
      return true;
    } catch {
      return false;
    }
  }

  function playOrQueue(fn) {
    if (audioUnlocked && audioCtx && master) fn();
    else pendingSfx.push(fn);
  }

  function tone({ type = "sine", f0 = 440, f1 = 440, dur = 0.12, gain = 0.12 }) {
    if (!audioUnlocked || !audioCtx || !master) return;
    const t0 = audioCtx.currentTime;

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;

    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g);
    g.connect(master);

    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst({ dur = 0.10, gain = 0.06, hp = 900 }) {
    if (!audioUnlocked || !audioCtx || !master) return;
    const t0 = audioCtx.currentTime;

    const bufferSize = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(master);

    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    enabled() {
      tone({ type: "triangle", f0: 520, f1: 820, dur: 0.16, gain: 0.12 });
      tone({ type: "triangle", f0: 820, f1: 1120, dur: 0.10, gain: 0.09 });
    },
    ready() {
      tone({ type: "triangle", f0: 420, f1: 720, dur: 0.16, gain: 0.11 });
    },
    mutation() {
      tone({ type: "sine", f0: 860, f1: 1240, dur: 0.10, gain: 0.10 });
      noiseBurst({ dur: 0.06, gain: 0.04, hp: 1400 });
    },
    hatch() {
      tone({ type: "square", f0: 420, f1: 680, dur: 0.09, gain: 0.08 });
    },
    newColony() {
      tone({ type: "triangle", f0: 360, f1: 620, dur: 0.18, gain: 0.11 });
      tone({ type: "triangle", f0: 620, f1: 980, dur: 0.14, gain: 0.09 });
    },
    boss() {
      tone({ type: "sine", f0: 130, f1: 70, dur: 0.22, gain: 0.14 });
      noiseBurst({ dur: 0.12, gain: 0.06, hp: 650 });
    }
  };

  function unlockAudioOnce() {
    const ok = ensureAudio();
    if (ok) {
      playOrQueue(() => SFX.enabled());
      dbg.textContent = "JS LOADED ✓ (audio enabled)";
      logSim("Audio enabled", "INFO");
    } else {
      dbg.textContent = "JS LOADED ✓ (tap for audio)";
    }
    window.removeEventListener("pointerdown", unlockAudioOnce);
    window.removeEventListener("touchstart", unlockAudioOnce);
    window.removeEventListener("click", unlockAudioOnce);
  }
  window.addEventListener("pointerdown", unlockAudioOnce, { passive: true });
  window.addEventListener("touchstart", unlockAudioOnce, { passive: true });
  window.addEventListener("click", unlockAudioOnce, { passive: true });

  // ---------- Canvas sizing (iOS safe + performance) ----------
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width || 1);
    H = Math.max(1, rect.height || 1);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));
  setTimeout(resizeCanvas, 0);

  // ---------- Economy / triggers ----------
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

  // ---------- Camera + interaction ----------
  let camX = 0, camY = 0, zoom = 0.78;
  let dragging = false, lastX = 0, lastY = 0;
  let selected = 0;
  let focusOn = false;
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
    return (best !== -1 && bestD < 260 * 260) ? best : -1;
  }

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

    const w = toWorld(e.clientX, e.clientY);
    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      if (focusOn) centerOnSelected(true);
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  }, { passive: true });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.6, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

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

  // ---------- Colony / worm models ----------
  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.55, 1.35),
      drift: rand(0.55, 1.35),
      aura: rand(0.95, 1.85),
      limbiness: rand(0.25, 1.1),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM"][randi(0, 4)],
      style: ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT"][randi(0, 4)]
    };

    const nodes = Array.from({ length: randi(4, 7) }, () => ({
      ox: rand(-70, 70),
      oy: rand(-70, 70),
      r: rand(60, 135),
      ph: rand(0, TAU),
      sp: rand(0.4, 1.2)
    }));

    return {
      id: Math.random().toString(16).slice(2, 6).toUpperCase(),
      x, y,
      vx: rand(-0.18, 0.18),
      vy: rand(-0.18, 0.18),
      dna,
      nodes,
      worms: [],
      shock: []
    };
  }

  function newWorm(col, big = false) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(18, 28) : randi(10, 18);
    const baseLen = big ? rand(10, 16) : rand(7, 12);

    const hue = (col.dna.hue + rand(-140, 140) + 360) % 360;

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.5, 1.05),
      turn: rand(0.008, 0.02) * col.dna.chaos,
      phase: rand(0, TAU),
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      homePhi: rand(0, TAU),
      homeR: rand(65, 125),
      jitterBias: rand(0.6, 1.4),
      limbs: [],
      segs: [],
      isBoss: false
    };

    let px = col.x + rand(-55, 55);
    let py = col.y + rand(-55, 55);
    let ang = rand(0, TAU);

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.3, 0.3) * col.dna.chaos;
    }
    return w;
  }

  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  // ---------- Fit view ----------
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
    zoom = clamp(fit * 0.90, 0.6, 1.6);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  // ---------- Events / mechanics ----------
  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
  }

  function addLimb(w, col, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(35, 90) : rand(22, 70),
      ang: rand(-1.3, 1.3),
      wob: rand(0.7, 1.6)
    });
  }

  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= 50000) {
      const c = colonies[0];
      const boss = newWorm(c, true);
      boss.isBoss = true;
      boss.width *= 1.6;
      boss.speed *= 0.7;
      boss.hue = 120;
      for (let i = 0; i < 4; i++) addLimb(boss, c, true);
      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.4);

      logSim("Boss worm emerged", "EVENT");
      playOrQueue(() => SFX.boss());
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, TAU);
      const dist = rand(260, 420);
      const nc = newColony(
        base.x + Math.cos(ang) * dist,
        base.y + Math.sin(ang) * dist,
        (base.dna.hue + rand(-90, 90) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 6);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.1);
      colonies.push(nc);

      logSim(`New colony spawned at ${fmt(nextSplitAt)} MC`, "EVENT");
      playOrQueue(() => SFX.newColony());
      nextSplitAt += MC_STEP;

      if (colonies.length <= 3) zoomOutToFitAll();
    }
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    if (r < 0.30) {
      w.hue = (w.hue + rand(30, 140)) % 360;
      logSim(`Color shift • Worm ${w.id}`, "MUTATION");
    } else if (r < 0.56) {
      w.speed *= rand(1.05, 1.25);
      logSim(`Aggression spike • Worm ${w.id}`, "MUTATION");
    } else if (r < 0.78) {
      w.width = clamp(w.width * rand(1.05, 1.25), 3.5, 16);
      logSim(`Body growth • Worm ${w.id}`, "MUTATION");
    } else {
      addLimb(w, c, Math.random() < 0.35);
      logSim(`Limb growth • Worm ${w.id}`, "MUTATION");
    }

    if (Math.random() < 0.22) shockwave(c, 0.9);
    playOrQueue(() => SFX.mutation());
  }

  // ---------- Worm population scaling ----------
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.2), 3, 80);

    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.2 - g * 0.04, 0.15, 1.2);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.35) shockwave(c, 0.6);

      logSim("New worm hatched", "EVENT");
      playOrQueue(() => SFX.hatch());
    }
  }

  // ---------- Controls (keep mechanics; no event spam) ----------
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", fn);
  }

  bind("feed", () => { volume += rand(20, 90); mcap += rand(120, 460); });
  bind("smallBuy", () => { buyers += 1; volume += rand(180, 900); mcap += rand(900, 3200); });
  bind("whaleBuy", () => { buyers += randi(2, 5); volume += rand(2500, 8500); mcap += rand(9000, 22000); shockwave(colonies[0], 1.2); });
  bind("sell", () => { volume = Math.max(0, volume - rand(600, 2600)); mcap = Math.max(0, mcap - rand(2200, 9000)); });
  bind("storm", () => { volume += rand(5000, 18000); mcap += rand(2000, 8000); shockwave(colonies[0], 1.0); });
  bind("mutate", () => mutateRandom());
  bind("focus", () => {
    focusOn = !focusOn;
    const btn = document.querySelector(`button[data-action="focus"]`);
    if (btn) btn.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(false);
  });
  bind("zoomIn", () => (zoom = clamp(zoom * 1.12, 0.6, 2.6)));
  bind("zoomOut", () => (zoom = clamp(zoom * 0.88, 0.6, 2.6)));
  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
    } catch {}
  });
  bind("reset", () => location.reload());

  // ---------- Stats update ----------
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

  // ---------- Rendering helpers ----------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function colonyBloom(c, time) {
    const h = c.dna.hue;
    const pul = 1 + Math.sin(time * 0.0012 + c.dna.chaos) * 0.07;

    ctx.globalCompositeOperation = "lighter";
    aura(c.x, c.y, 240 * c.dna.aura * pul, (h + 10) % 360, isInteracting ? 0.10 : 0.18);
    aura(c.x, c.y, 180 * c.dna.aura * pul, (h + 55) % 360, isInteracting ? 0.07 : 0.14);

    ctx.globalCompositeOperation = "source-over";
    aura(c.x, c.y, 120 * c.dna.aura * pul, h, isInteracting ? 0.14 : 0.22);
    aura(c.x, c.y, 90 * c.dna.aura * pul, (h + 35) % 360, isInteracting ? 0.10 : 0.16);
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    if (!isInteracting) {
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 10;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 10;
        aura(x, y, n.r * 1.05, (baseHue + i * 18) % 360, 0.16);
        aura(x, y, n.r * 0.7, (baseHue + i * 22 + 40) % 360, 0.11);
      }
    } else {
      aura(col.x, col.y, 160 * col.dna.aura, baseHue, 0.12);
    }

    const R = 150;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .26)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let a = 0; a <= TAU + 0.001; a += Math.PI / 22) {
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

    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.22 : 0.12})`;
      ctx.lineWidth = w.width + (w.isBoss ? 9 : 6);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.98 : 0.9})`;
    ctx.lineWidth = w.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    if (!isInteracting) {
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i];
        const r = Math.max(2.2, w.width * 0.35);
        ctx.fillStyle = `hsla(${(w.hue + 20) % 360}, 95%, 70%, .78)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }
    }

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

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, ${isInteracting ? 0.30 : 0.50})`;
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

  // ---------- SPACE BACKGROUND (MORE STARS + BRIGHTER NEBULAS + GALAXIES) ----------
  const nebulas = Array.from({ length: 9 }, (_, i) => {
    const a = rand(0, TAU);
    const r = 900 + i * 260;
    return {
      x: Math.cos(a) * r + rand(-260, 260),
      y: Math.sin(a) * r + rand(-260, 260),
      r: 680 + rand(-160, 260),
      hue: (140 + i * 34 + rand(-20, 20)) % 360,
      a: 0.20 + rand(0.06, 0.12) // BRIGHTER
    };
  });

  const galaxies = Array.from({ length: 5 }, (_, i) => {
    const a = rand(0, TAU);
    const r = 1200 + i * 520;
    return {
      x: Math.cos(a) * r + rand(-380, 380),
      y: Math.sin(a) * r + rand(-380, 380),
      r: 980 + rand(-180, 240),
      hue: (200 + i * 42 + rand(-15, 15)) % 360,
      a: 0.18 + rand(0.05, 0.10) // BRIGHTER
    };
  });

  function drawSpaceBackground(time) {
    const left = (-W / 2) / zoom - camX;
    const right = (W / 2) / zoom - camX;
    const top = (-H / 2) / zoom - camY;
    const bottom = (H / 2) / zoom - camY;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(left, top, right - left, bottom - top);

    // Milky-way band (subtle but visible)
    ctx.globalCompositeOperation = "lighter";
    {
      const bandA = (time * 0.00005) % TAU;
      const bx = (left + right) * 0.5 + Math.cos(bandA) * 280;
      const by = (top + bottom) * 0.5 + Math.sin(bandA) * 280;

      const g = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(right - left, bottom - top) * 0.9);
      g.addColorStop(0, "rgba(80,120,255,0.08)");
      g.addColorStop(0.35, "rgba(120,80,255,0.06)");
      g.addColorStop(0.65, "rgba(80,255,190,0.05)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(left, top, right - left, bottom - top);
    }

    // Nebulas
    for (const n of nebulas) {
      const pul = 1 + Math.sin(time * 0.0007 + n.x * 0.0003) * 0.08;
      const rr = n.r * pul;

      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr);
      g.addColorStop(0, `hsla(${n.hue},95%,60%,${isInteracting ? n.a * 0.45 : n.a})`);
      g.addColorStop(0.55, `hsla(${(n.hue + 28) % 360},95%,58%,${isInteracting ? n.a * 0.25 : n.a * 0.55})`);
      g.addColorStop(1, `hsla(${n.hue},95%,50%,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, rr, 0, TAU);
      ctx.fill();
    }

    // Galaxies (brighter core)
    for (const ga of galaxies) {
      const pul = 1 + Math.sin(time * 0.00055 + ga.y * 0.0004) * 0.07;
      const rr = ga.r * pul;

      const g = ctx.createRadialGradient(ga.x, ga.y, 0, ga.x, ga.y, rr);
      g.addColorStop(0, `hsla(${ga.hue},95%,68%,${isInteracting ? ga.a * 0.50 : ga.a})`);
      g.addColorStop(0.18, `hsla(${(ga.hue + 18) % 360},95%,62%,${isInteracting ? ga.a * 0.28 : ga.a * 0.65})`);
      g.addColorStop(1, `hsla(${ga.hue},95%,50%,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ga.x, ga.y, rr, 0, TAU);
      ctx.fill();
    }

    // Stars: MUCH denser + brighter
    ctx.globalCompositeOperation = "source-over";
    const cell = 140;                  // smaller cell => more stars
    const x0 = Math.floor(left / cell) - 2;
    const x1 = Math.floor(right / cell) + 2;
    const y0 = Math.floor(top / cell) - 2;
    const y1 = Math.floor(bottom / cell) + 2;

    const perCell = isInteracting ? 4 : 10;

    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        let h = hash2i(gx, gy);

        for (let i = 0; i < perCell; i++) {
          h = (h * 1664525 + 1013904223) >>> 0;
          const rx = h01(h);
          h = (h * 1664525 + 1013904223) >>> 0;
          const ry = h01(h);
          h = (h * 1664525 + 1013904223) >>> 0;
          const rs = h01(h);
          h = (h * 1664525 + 1013904223) >>> 0;
          const rh = h01(h);

          const sx = (gx + rx) * cell;
          const sy = (gy + ry) * cell;

          const tw = 0.6 + 0.4 * Math.sin(time * 0.002 + (gx * 17 + gy * 31 + i * 13));
          const r = 0.7 + rs * 2.4;
          const a = (0.30 + rs * 0.70) * tw; // BRIGHTER

          const hue = rh < 0.07 ? 200 : rh < 0.12 ? 280 : rh < 0.17 ? 50 : 0;

          if (hue === 0) ctx.fillStyle = `rgba(255,255,255,${a})`;
          else ctx.fillStyle = `hsla(${hue},95%,72%,${a})`;

          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, TAU);
          ctx.fill();

          if (!isInteracting && rs > 0.82) {
            ctx.strokeStyle = `rgba(255,255,255,${a * 0.65})`;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(sx - 4.2, sy);
            ctx.lineTo(sx + 4.2, sy);
            ctx.moveTo(sx, sy - 4.2);
            ctx.lineTo(sx, sy + 4.2);
            ctx.stroke();
          }
        }
      }
    }

    ctx.restore();
  }

  // ---------- Worm behavior ----------
  function wormBehavior(col, w, time) {
    const head = w.segs[0];

    w.homePhi += 0.0012 * w.orbitDir * (0.7 + col.dna.chaos * 0.25);
    const targetX = col.x + Math.cos(w.homePhi) * w.homeR;
    const targetY = col.y + Math.sin(w.homePhi) * w.homeR;

    const toward = Math.atan2(targetY - head.y, targetX - head.x);
    const wander = Math.sin(time * 0.0016 + w.phase) * 0.18 * w.jitterBias;
    const noise = (Math.random() - 0.5) * w.turn * 1.15;

    if (w.type === "DRIFTER") {
      head.a = head.a * 0.92 + toward * 0.08 + wander * 0.05 + noise;
    } else if (w.type === "ORBITER") {
      const orbit = toward + w.orbitDir * 0.75;
      head.a = head.a * 0.88 + orbit * 0.12 + wander * 0.06 + noise;
    } else {
      const bite = toward + Math.sin(time * 0.0028 + w.phase) * 0.32;
      head.a = head.a * 0.84 + bite * 0.16 + wander * 0.05 + noise;
    }

    const boost = w.isBoss ? 2.0 : 1.0;
    head.x += Math.cos(head.a) * w.speed * 2.2 * boost;
    head.y += Math.sin(head.a) * w.speed * 2.2 * boost;

    const dx = head.x - col.x;
    const dy = head.y - col.y;
    const d = Math.hypot(dx, dy);
    const limit = 300;

    if (d > limit) {
      const pull = (d - limit) / 120;
      head.x -= (dx / (d || 1)) * pull * 8.0;
      head.y -= (dy / (d || 1)) * pull * 8.0;

      const inward = Math.atan2(-dy, -dx);
      head.a = head.a * 0.78 + inward * 0.22;
    }

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

  // ---------- Simulation step ----------
  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();

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

    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.08, 0.4, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.65) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();
  }

  function render(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    // Background FIRST (now definitely visible)
    drawSpaceBackground(time);

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];

      colonyBloom(c, time);
      irregularBlob(c, time);

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .50)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 105 * c.dna.aura, 0, TAU);
        ctx.stroke();
      }

      for (const s of c.shock) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 92%, 62%, ${s.a})`;
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s.r, 0, TAU);
        ctx.stroke();
      }
    }

    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    ctx.restore();
    dbg.textContent = "JS LOADED ✓ (rendering)";
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let renderAccum = 0;
  const RENDER_FPS = 40;
  const RENDER_DT = 1 / RENDER_FPS;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // keep killing old UI if it tries to come back
    killOldSelectedPanel();

    step(dt, now);

    renderAccum += dt;
    if (renderAccum >= RENDER_DT) {
      renderAccum = 0;
      render(now);
    }

    requestAnimationFrame(tick);
  }

  // ---------- Boot ----------
  function boot() {
    resizeCanvas();
    ensureEventLogBelowStats();
    zoomOutToFitAll();
    updateStats();

    logSim("Simulation ready (tap to enable sound)", "INFO");
    playOrQueue(() => SFX.ready());
    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
