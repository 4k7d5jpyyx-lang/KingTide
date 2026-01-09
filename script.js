(() => {
  "use strict";

  // ---------- Safe helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;

  const safeNum = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);
  const fmt = (n) => "$" + Math.max(0, Math.round(safeNum(n, 0))).toLocaleString();

  const $ = (id) => document.getElementById(id);

  // ---------- Debug banner ----------
  const dbg = $("dbg");
  const setDbg = (t, bad = false) => {
    if (!dbg) return;
    dbg.textContent = t;
    dbg.style.background = bad ? "rgba(120,0,20,.55)" : "rgba(0,0,0,.55)";
  };

  function showErr(e) {
    console.error(e);
    setDbg("JS ERROR ✕ " + (e?.message || e), true);
  }
  window.addEventListener("error", (ev) => showErr(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => showErr(ev.reason));

  // ---------- DOM ----------
  const canvas = $("simCanvas");
  if (!canvas) return showErr("Canvas not found (#simCanvas).");

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return showErr("Canvas context failed.");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");

  const elSelectedName = $("selectedName");
  const elDNA = $("dna");
  const elBiome = $("biome");
  const elStyle = $("style");
  const elTemp = $("temperament");
  const logEl = $("log");

  // ---------- Log ----------
  const LOG_CAP = 50;
  function log(msg, kind = "INFO") {
    if (!logEl) return;
    const d = document.createElement("div");
    d.textContent = `${kind}: ${msg}`;
    logEl.prepend(d);
    while (logEl.children.length > LOG_CAP) logEl.removeChild(logEl.lastChild);
  }

  // ---------- Canvas sizing ----------
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

  // ---------- Camera + interaction ----------
  let camX = 0, camY = 0;
  let zoom = 0.85;              // slightly zoomed out start
  let focusOn = false;

  let dragging = false;
  let moved = false;
  let lastX = 0, lastY = 0;

  // pinch zoom (basic)
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  function toWorld(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  // ---------- Colony + worm models ----------
  function makeDNA(dna) {
    // Stable-ish “DNA string” so it looks like real data
    const a = Math.floor(dna.chaos * 100);
    const b = Math.floor(dna.drift * 100);
    const c = Math.floor(dna.aura * 100);
    const d = Math.floor(dna.limbiness * 100);
    return `H${Math.floor(dna.hue)}-C${a}-D${b}-A${c}-L${d}`;
  }

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

    const nodes = Array.from({ length: randi(4, 7) }, () => ({
      ox: rand(-70, 70),
      oy: rand(-70, 70),
      r: rand(60, 120),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.4, 1.2)
    }));

    return {
      id: Math.random().toString(16).slice(2, 6).toUpperCase(),
      x, y,
      vx: rand(-0.12, 0.12),
      vy: rand(-0.12, 0.12),
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

    // IMPORTANT: random initial heading so they don't all "rush right"
    const startAng = rand(0, Math.PI * 2);

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.5, 1.05),
      turn: rand(0.010, 0.020) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      segs: [],
      limbs: [],
      isBoss: false
    };

    let px = col.x + rand(-55, 55);
    let py = col.y + rand(-55, 55);
    let ang = startAng;

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.28, 0.28) * col.dna.chaos;
    }

    return w;
  }

  function addLimb(w, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, Math.max(3, w.segs.length - 3));
    w.limbs.push({
      at,
      len: big ? rand(35, 90) : rand(22, 70),
      ang: rand(-1.3, 1.3),
      wob: rand(0.7, 1.6)
    });
  }

  // ---------- World ----------
  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  let selected = 0;

  // ---------- Economy / triggers ----------
  let buyers = 0, volume = 0, mcap = 0;
  const MAX_COLONIES = 8;
  const MC_STEP = 50000;
  let nextSplitAt = MC_STEP;
  let bossSpawned = false;

  function growthScore() {
    return (safeNum(mcap) / 20000) + (safeNum(volume) / 6000) + (safeNum(buyers) / 10);
  }

  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
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
      for (let i = 0; i < 4; i++) addLimb(boss, true);
      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.4);
      log("Boss worm emerged", "EVENT");
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const d = rand(320, 520); // more space between colonies
      const nc = newColony(
        base.x + Math.cos(ang) * d,
        base.y + Math.sin(ang) * d,
        (base.dna.hue + rand(-90, 90) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 6);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.1);
      colonies.push(nc);

      log(`New colony spawned at ${fmt(nextSplitAt)} MC`, "EVENT");
      nextSplitAt += MC_STEP;
    }
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    if (r < 0.30) {
      w.hue = (w.hue + rand(30, 140)) % 360;
      log(`Color shift • Worm ${w.id} (Colony #${colonies.indexOf(c) + 1})`, "MUTATION");
    } else if (r < 0.56) {
      w.speed *= rand(1.05, 1.25);
      log(`Aggression spike • Worm ${w.id}`, "MUTATION");
    } else if (r < 0.78) {
      w.width = clamp(w.width * rand(1.05, 1.25), 3.5, 16);
      log(`Body growth • Worm ${w.id}`, "MUTATION");
    } else {
      addLimb(w, Math.random() < 0.35);
      log(`Limb growth • Worm ${w.id}`, "MUTATION");
    }

    if (Math.random() < 0.22) shockwave(c, 0.9);
    refreshInspector();
  }

  // ---------- UI: stats + inspector ----------
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) elWorms.textContent = String(colonies.reduce((a, c) => a + c.worms.length, 0));
  }

  function refreshInspector() {
    const c = colonies[selected];
    if (!c) return;

    if (elSelectedName) elSelectedName.textContent = `Colony #${selected + 1}`;
    if (elDNA) elDNA.textContent = makeDNA(c.dna);
    if (elBiome) elBiome.textContent = c.dna.biome;
    if (elStyle) elStyle.textContent = c.dna.style;
    if (elTemp) elTemp.textContent = c.dna.temperament;
  }

  // ---------- Button binding ----------
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (!btn) {
      // don’t crash if missing; just log once
      return;
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      fn();
      updateStats();
      refreshInspector();
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
    const b = $("focusBtn");
    if (b) b.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
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

  // ---------- Selection ----------
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const d = dist2(wx, wy, c.x, c.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 320 * 320) ? best : -1;
  }

  function centerOnSelected(strength = 0.16) {
    const c = colonies[selected];
    if (!c) return;
    camX = lerp(camX, -c.x, strength);
    camY = lerp(camY, -c.y, strength);
  }

  // Tap/drag handling
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    moved = false;
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

    // Only treat as a “tap” if user did NOT drag
    if (!moved) {
      const w = toWorld(e.clientX, e.clientY);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        log(`Selected Colony #${idx + 1}`, "INFO");
        refreshInspector();
        if (focusOn) centerOnSelected(1); // snap
      }
    }
  }, { passive: true });

  // Pinch zoom (touch)
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.hypot(dx, dy);
      pinchStartZoom = zoom;
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

  // Double tap center
  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) {
      centerOnSelected(1);
    }
    lastTap = now;
  }, { passive: true });

  // ---------- Starfield / galaxies (world space, stable) ----------
  const stars = [];
  const galaxies = [];
  function seedSpace() {
    stars.length = 0;
    galaxies.length = 0;

    // Larger “world” feel
    const R = 2400;
    const N = 520;

    for (let i = 0; i < N; i++) {
      stars.push({
        x: rand(-R, R),
        y: rand(-R, R),
        r: rand(0.4, 1.6),
        a: rand(0.15, 0.9),
        tw: rand(0.5, 1.6),
      });
    }

    // a few soft galaxies
    for (let i = 0; i < 5; i++) {
      galaxies.push({
        x: rand(-R * 0.9, R * 0.9),
        y: rand(-R * 0.9, R * 0.9),
        r: rand(280, 520),
        hue: [190, 280, 140, 210, 310][i % 5],
        a: rand(0.10, 0.18),
      });
    }
  }

  // ---------- Rendering helpers ----------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSpace(time) {
    // galaxies first
    for (const g of galaxies) {
      const pulse = 1 + Math.sin(time * 0.0003 + g.x * 0.0002) * 0.06;
      aura(g.x, g.y, g.r * pulse, g.hue, g.a);
      aura(g.x + 40, g.y - 20, g.r * 0.55, (g.hue + 40) % 360, g.a * 0.55);
    }

    // stars
    ctx.fillStyle = "rgba(255,255,255,.85)";
    for (const s of stars) {
      const tw = 0.6 + Math.sin(time * 0.001 * s.tw + s.x * 0.01) * 0.4;
      const a = clamp(s.a * tw, 0.05, 0.95);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawGrid() {
    // Draw grid in WORLD space so it moves correctly and doesn’t “scroll glitch”
    const step = 220;
    const half = 2400;
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 1;

    for (let x = -half; x <= half; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, -half);
      ctx.lineTo(x, half);
      ctx.stroke();
    }
    for (let y = -half; y <= half; y += step) {
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
    }
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    // stronger nicer aura
    aura(col.x, col.y, 210 * col.dna.aura, baseHue, 0.14);
    aura(col.x, col.y, 150 * col.dna.aura, (baseHue + 40) % 360, 0.08);

    // metaball-ish nodes
    for (let i = 0; i < col.nodes.length; i++) {
      const n = col.nodes[i];
      const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 10;
      const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 10;
      aura(x, y, n.r * 1.05, (baseHue + i * 18) % 360, 0.12);
      aura(x, y, n.r * 0.65, (baseHue + i * 22 + 40) % 360, 0.08);
    }

    // outline
    const R = 140;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .30)`;
    ctx.lineWidth = 1.6;
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

    // outer glow
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.24 : 0.12})`;
    ctx.lineWidth = w.width + (w.isBoss ? 8 : 6);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // core
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.98 : 0.9})`;
    ctx.lineWidth = w.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // limbs
    if (w.limbs?.length) {
      ctx.globalCompositeOperation = "lighter";
      for (const L of w.limbs) {
        const at = clamp(L.at, 0, pts.length - 1);
        const base = pts[at];
        const baseAng =
          (pts[at]?.a || 0) +
          L.ang +
          Math.sin(time * 0.002 * L.wob + w.phase) * 0.35;

        const lx = base.x + Math.cos(baseAng) * L.len;
        const ly = base.y + Math.sin(baseAng) * L.len;

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, .50)`;
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

  function wormBehavior(col, w, time) {
    const head = w.segs[0];

    // Controlled motion: reduce bias and keep them near the colony
    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    // add gentle wandering
    const wander = Math.sin(time * 0.0012 + w.phase) * 0.35 + (Math.random() - 0.5) * 0.12;

    // Blend toward colony so they don’t “drift off right”
    let desired = toward + wander;

    if (w.type === "ORBITER") {
      desired = toward + (Math.sin(time * 0.001 + w.phase) > 0 ? 1 : -1) * 0.95 + wander * 0.35;
    }
    if (w.type === "HUNTER") {
      desired = toward + wander * 0.65;
    }

    // smooth turn
    head.a = head.a * 0.88 + desired * 0.12;

    // move
    const boost = w.isBoss ? 1.4 : 1.0;
    head.x += Math.cos(head.a) * w.speed * 2.0 * boost;
    head.y += Math.sin(head.a) * w.speed * 2.0 * boost;

    // stronger leash back to colony
    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const leash = 320;
    if (d > leash) {
      // pull back rather than random flip
      const pull = (d - leash) / 220;
      head.x = lerp(head.x, col.x, clamp(pull, 0.02, 0.18));
      head.y = lerp(head.y, col.y, clamp(pull, 0.02, 0.18));
      head.a = head.a * 0.85 + toward * 0.15;
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

      seg.x = seg.x * 0.2 + targetX * 0.8;
      seg.y = seg.y * 0.2 + targetY * 0.8;
      seg.a = ang;
    }
  }

  // ---------- Watermark inside canvas ----------
  const logoImg = new Image();
  logoImg.src = "./logo.png";
  let logoReady = false;
  logoImg.onload = () => (logoReady = true);
  logoImg.onerror = () => { /* ignore */ };

  function drawWatermark() {
    if (!logoReady) return;

    // top-left small mark
    const pad = 16;
    const size = 38;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.drawImage(logoImg, pad, pad, size, size);
    ctx.globalAlpha = 1;
    ctx.restore();

    // faint center mark (harder to crop out)
    ctx.save();
    ctx.globalAlpha = 0.06;
    const s = Math.min(W, H) * 0.55;
    ctx.drawImage(logoImg, (W - s) / 2, (H - s) / 2, s, s);
    ctx.restore();
  }

  // ---------- Fit view ----------
  function zoomOutToFitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 620;

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

  // ---------- Main loop ----------
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.0), 3, 80);
    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.1 - g * 0.04, 0.15, 1.1);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.35) shockwave(c, 0.6);
      log("New worm hatched", "INFO");
    }
  }

  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();

    // drift colonies a bit
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

    if (focusOn) centerOnSelected(0.18);

    // auto mutations
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
    // guard against non-finite transforms
    zoom = safeNum(zoom, 1);
    camX = safeNum(camX, 0);
    camY = safeNum(camY, 0);

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // camera
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    // space + grid
    drawSpace(time);
    drawGrid();

    // colonies
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];

      irregularBlob(c, time);

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 120 * c.dna.aura, 0, Math.PI * 2);
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
    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    ctx.restore();

    // watermark (screen space)
    drawWatermark();

    setDbg("JS LOADED ✓ (rendering)");
  }

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

  function boot() {
    resizeCanvas();
    seedSpace();
    zoomOutToFitAll();
    updateStats();
    refreshInspector();
    log("Simulation ready", "INFO");
    requestAnimationFrame(tick);
  }

  // Boot safely even if load doesn’t fire on iOS cache
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 0);
  } else {
    window.addEventListener("load", boot);
  }
})();
