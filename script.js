(() => {
  "use strict";

  // ---------- On-screen debug ----------
  const dbg = document.createElement("div");
  dbg.style.cssText = `
    position:fixed; left:10px; top:10px; z-index:999999;
    padding:8px 10px; border-radius:12px;
    background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.18);
    color:rgba(235,240,248,.92); font:700 12px/1.2 system-ui, -apple-system, Inter, sans-serif;
    backdrop-filter: blur(10px);
    max-width: 78vw;
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

  // ---------- DOM ----------
  const canvas = $("simCanvas");
  if (!canvas) return showErr("Canvas not found (#simCanvas).");

  canvas.style.touchAction = "none";

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return showErr("Canvas context failed.");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const logEl = $("log");

  const elSelName  = $("selName");
  const elSelDNA   = $("selDNA");
  const elSelBiome = $("selBiome");
  const elSelStyle = $("selStyle");

  // ---------- Log ----------
  const LOG_CAP = 45;
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
    if (!rect.width || !rect.height) return;
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 180));
  setTimeout(resizeCanvas, 0);

  // ---------- Economy ----------
  let buyers = 0, volume = 0, mcap = 0;

  // ---------- Camera + interaction ----------
  let camX = 0, camY = 0, zoom = 0.78;
  let dragging = false;
  let selected = 0;
  let focusOn = false;
  let isInteracting = false;

  // tap detection
  let downX = 0, downY = 0, lastX = 0, lastY = 0, downT = 0;
  const TAP_MOVE_PX = 10;
  const TAP_TIME_MS = 330;

  function toWorld(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  function setSelectedUI(c, idx) {
    if (!c) return;
    if (elSelName)  elSelName.textContent  = `Colony #${idx + 1}`;
    if (elSelDNA)   elSelDNA.textContent   = c.dna.temperament;
    if (elSelBiome) elSelBiome.textContent = c.dna.biome;
    if (elSelStyle) elSelStyle.textContent = c.dna.style;
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
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    downT = performance.now();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    camX += dx / zoom;
    camY += dy / zoom;
  });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    const upT = performance.now();
    const move = Math.hypot(e.clientX - downX, e.clientY - downY);

    // select only on taps
    if (move <= TAP_MOVE_PX && (upT - downT) <= TAP_TIME_MS) {
      const w = toWorld(e.clientX, e.clientY);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        setSelectedUI(colonies[selected], selected);
        log(`Selected Colony #${idx + 1}`, "INFO");
        if (focusOn) centerOnSelected(false);
      }
    }
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  });

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
    if (!smooth) {
      camX = -c.x;
      camY = -c.y;
      return;
    }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

  // ---------- Models ----------
  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.55, 1.35),
      drift: rand(0.55, 1.35),
      aura: rand(0.9, 1.6),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM"][randi(0, 4)],
      style: ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT"][randi(0, 4)]
    };

    return { x, y, vx: rand(-0.18, 0.18), vy: rand(-0.18, 0.18), dna, worms: [] };
  }

  function newWorm(col, big = false) {
    const segCount = big ? randi(18, 28) : randi(10, 18);
    const baseLen = big ? rand(10, 16) : rand(7, 12);
    const hue = (col.dna.hue + rand(-140, 140) + 360) % 360;

    const w = {
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.5, 1.05),
      turn: rand(0.008, 0.02) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      segs: []
    };

    let px = col.x + rand(-55, 55);
    let py = col.y + rand(-55, 55);
    let ang = rand(0, Math.PI * 2);

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
  setSelectedUI(colonies[0], 0);

  // ---------- Buttons (THIS is why yours weren’t working) ----------
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (!btn) {
      console.warn("Missing button for action:", action);
      return;
    }
    btn.addEventListener("click", fn);
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
    log(`Buy +1 • +${fmt(dv)} vol • +${fmt(dm)} MC`, "INFO");
  });

  bind("whaleBuy", () => {
    const b = randi(2, 5);
    const dv = rand(2500, 8500);
    const dm = rand(9000, 22000);
    buyers += b;
    volume += dv;
    mcap += dm;
    log(`Whale Buy +${b} • +${fmt(dv)} vol • +${fmt(dm)} MC`, "EVENT");
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
    log(`Volume Storm • +${fmt(dv)} vol • +${fmt(dm)} MC`, "EVENT");
  });

  bind("mutate", () => {
    const c = colonies[selected] || colonies[0];
    if (!c || !c.worms.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];
    w.hue = (w.hue + rand(35, 120)) % 360;
    w.speed *= rand(1.02, 1.12);
    log("Mutation pulse", "MUTATION");
  });

  bind("focus", () => {
    focusOn = !focusOn;
    const btn = document.querySelector(`button[data-action="focus"]`);
    if (btn) btn.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(false);
  });

  bind("zoomIn", () => zoom = clamp(zoom * 1.12, 0.55, 2.6));
  bind("zoomOut", () => zoom = clamp(zoom * 0.88, 0.55, 2.6));

  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
      log("Capture saved", "INFO");
    } catch {
      log("Capture blocked — use screenshot/share on iOS", "WARN");
    }
  });

  bind("reset", () => location.reload());

  // ---------- Stats ----------
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) elWorms.textContent = String(colonies.reduce((a, c) => a + c.worms.length, 0));
  }

  // ---------- Visuals ----------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorm(w, time) {
    const pts = w.segs;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${isInteracting ? 0.12 : 0.18})`;
    ctx.lineWidth = w.width + (isInteracting ? 5 : 7);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, 0.92)`;
    ctx.lineWidth = w.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function wormStep(col, w, time) {
    const head = w.segs[0];
    const jitter = Math.sin(time * 0.002 + w.phase) * 0.12;
    head.a += (Math.random() - 0.5) * w.turn + jitter;

    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);
    head.a = head.a * 0.86 + toward * 0.14;

    head.x += Math.cos(head.a) * w.speed * 2.2;
    head.y += Math.sin(head.a) * w.speed * 2.2;

    const d = Math.hypot(head.x - col.x, head.y - col.y);
    if (d > 280) {
      head.a = toward + (Math.random() > 0.5 ? 1 : -1) * 0.9;
      head.x = col.x + (head.x - col.x) * 0.90;
      head.y = col.y + (head.y - col.y) * 0.90;
    }

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

  function step(dt, time) {
    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;

      for (const w of c.worms) wormStep(c, w, time);
    }

    if (focusOn) centerOnSelected(true);
    updateStats();
  }

  function render(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // camera
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    // soft space background
    for (const c of colonies) {
      aura(c.x, c.y, 150 * c.dna.aura, c.dna.hue, isInteracting ? 0.10 : 0.16);
      aura(c.x, c.y, 110 * c.dna.aura, (c.dna.hue + 40) % 360, isInteracting ? 0.06 : 0.10);
    }

    // highlight selected
    const sc = colonies[selected];
    if (sc) {
      ctx.strokeStyle = `hsla(${sc.dna.hue}, 95%, 65%, .55)`;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, 110 * sc.dna.aura, 0, Math.PI * 2);
      ctx.stroke();
    }

    // worms
    for (const c of colonies) for (const w of c.worms) drawWorm(w, time);

    ctx.restore();
    dbg.textContent = "JS LOADED ✓ (rendering)";
  }

  // ---------- Loop ----------
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
    updateStats();
    log("Simulation ready", "INFO");
    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
