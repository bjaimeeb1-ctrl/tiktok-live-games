(() => {
  "use strict";

  const api = window.SnakeLiveTest;
  const engine = api?.engine;
  const gameFrame = document.querySelector(".game-frame");
  const baseCanvas = document.getElementById("gameCanvas");
  const turboBadge = document.getElementById("turboBadge");

  if (!engine || !gameFrame || !baseCanvas || !turboBadge) return;

  const style = document.createElement("style");
  style.textContent = `
    .game-frame { overflow: hidden; }
    .turbo-fx-canvas {
      position: absolute;
      z-index: 5;
      inset: 8px;
      width: calc(100% - 16px);
      height: calc(100% - 16px);
      pointer-events: none;
      border-radius: 15px;
    }
    .game-frame.turbo-active {
      border-color: rgba(37,229,255,.85);
      box-shadow:
        0 0 18px rgba(37,229,255,.28),
        0 0 42px rgba(37,229,255,.16),
        inset 0 0 30px rgba(37,229,255,.10);
      animation: turboFramePulse .42s ease-in-out infinite alternate;
    }
    .badge.turbo {
      position: relative;
      min-width: 102px;
      overflow: hidden;
      color: #baf8ff;
      background: rgba(2,20,28,.94);
      border-color: rgba(37,229,255,.72);
      box-shadow: 0 0 18px rgba(37,229,255,.18);
    }
    .badge.turbo .turbo-main {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      white-space: nowrap;
    }
    .badge.turbo .turbo-time { color: #fff; font-variant-numeric: tabular-nums; }
    .badge.turbo .turbo-meter {
      position: absolute;
      left: 6px;
      right: 6px;
      bottom: 2px;
      height: 2px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,.12);
    }
    .badge.turbo .turbo-meter i {
      display: block;
      height: 100%;
      width: 100%;
      transform-origin: left center;
      background: linear-gradient(90deg, #25e5ff, #9dfcff);
      box-shadow: 0 0 8px rgba(37,229,255,.8);
    }
    @keyframes turboFramePulse {
      from { filter: brightness(1); }
      to { filter: brightness(1.09); }
    }
  `;
  document.head.appendChild(style);

  const fxCanvas = document.createElement("canvas");
  fxCanvas.className = "turbo-fx-canvas";
  fxCanvas.width = baseCanvas.width;
  fxCanvas.height = baseCanvas.height;
  fxCanvas.setAttribute("aria-hidden", "true");
  gameFrame.appendChild(fxCanvas);

  const ctx = fxCanvas.getContext("2d");
  const trails = [];
  let lastHeadKey = "";
  let wasActive = false;
  let activationAt = 0;
  let turboStartedAt = 0;
  let turboInitialDuration = 5000;

  turboBadge.innerHTML = `
    <span class="turbo-main">⚡ TURBO <span class="turbo-time">5.0s</span></span>
    <span class="turbo-meter"><i></i></span>
  `;
  const timeEl = turboBadge.querySelector(".turbo-time");
  const meterEl = turboBadge.querySelector(".turbo-meter i");

  function rememberHead(now) {
    const head = engine.snake?.[0];
    if (!head) return;
    const key = `${head.x},${head.y}`;
    if (key === lastHeadKey) return;
    lastHeadKey = key;
    trails.unshift({ x: head.x, y: head.y, at: now });
    if (trails.length > 18) trails.length = 18;
  }

  function drawTrail(now, cellW, cellH) {
    for (let i = trails.length - 1; i >= 0; i -= 1) {
      const point = trails[i];
      const age = now - point.at;
      if (age > 900) continue;
      const life = 1 - age / 900;
      const cx = (point.x + 0.5) * cellW;
      const cy = (point.y + 0.5) * cellH;
      const radius = Math.min(cellW, cellH) * (0.26 + life * 0.20);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.1);
      glow.addColorStop(0, `rgba(125,249,255,${0.30 * life})`);
      glow.addColorStop(0.35, `rgba(37,229,255,${0.18 * life})`);
      glow.addColorStop(1, "rgba(37,229,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSnakeGlow(cellW, cellH, now) {
    const pulse = 0.65 + 0.35 * Math.sin(now / 70);
    engine.snake.slice(0, 10).forEach((part, index) => {
      const cx = (part.x + 0.5) * cellW;
      const cy = (part.y + 0.5) * cellH;
      const alpha = Math.max(0.06, (0.30 - index * 0.022) * pulse);
      ctx.shadowColor = "#25e5ff";
      ctx.shadowBlur = index === 0 ? 30 : 18;
      ctx.fillStyle = `rgba(99,244,255,${alpha})`;
      ctx.fillRect(part.x * cellW + 2, part.y * cellH + 2, cellW - 4, cellH - 4);
      ctx.shadowBlur = 0;

      if (index === 0) {
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(cellW, cellH) * 1.25);
        halo.addColorStop(0, `rgba(190,255,255,${0.24 * pulse})`);
        halo.addColorStop(0.35, `rgba(37,229,255,${0.18 * pulse})`);
        halo.addColorStop(1, "rgba(37,229,255,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(cellW, cellH) * 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawSpeedLines(cellW, cellH, now) {
    const head = engine.snake?.[0];
    const dir = engine.direction;
    if (!head || !dir) return;
    const cx = (head.x + 0.5) * cellW;
    const cy = (head.y + 0.5) * cellH;
    const size = Math.min(cellW, cellH);
    const phase = (now % 240) / 240;

    ctx.lineCap = "round";
    for (let i = 0; i < 7; i += 1) {
      const side = (i - 3) * size * 0.22;
      const travel = (phase + i * 0.13) % 1;
      const back = size * (0.6 + travel * 2.8);
      const length = size * (0.35 + (i % 3) * 0.12);
      const px = cx - dir.x * back + -dir.y * side;
      const py = cy - dir.y * back + dir.x * side;
      ctx.strokeStyle = `rgba(107,241,255,${0.18 + (1 - travel) * 0.38})`;
      ctx.lineWidth = Math.max(1.5, size * 0.045);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - dir.x * length, py - dir.y * length);
      ctx.stroke();
    }
  }

  function drawActivationRing(now, cellW, cellH) {
    const elapsed = now - activationAt;
    if (elapsed < 0 || elapsed > 650) return;
    const head = engine.snake?.[0];
    if (!head) return;
    const p = elapsed / 650;
    const cx = (head.x + 0.5) * cellW;
    const cy = (head.y + 0.5) * cellH;
    const radius = Math.min(cellW, cellH) * (0.55 + p * 2.1);
    ctx.strokeStyle = `rgba(120,248,255,${0.85 * (1 - p)})`;
    ctx.lineWidth = Math.max(2, 5 * (1 - p));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawVignette(now) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 95);
    ctx.save();
    ctx.strokeStyle = `rgba(37,229,255,${0.16 + pulse * 0.10})`;
    ctx.lineWidth = 10;
    ctx.shadowColor = "#25e5ff";
    ctx.shadowBlur = 22;
    ctx.strokeRect(5, 5, fxCanvas.width - 10, fxCanvas.height - 10);
    ctx.restore();
  }

  function frame(now) {
    ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    const currentTime = Date.now();
    const active = currentTime < engine.turboUntil;

    if (active && !wasActive) {
      activationAt = now;
      turboStartedAt = currentTime;
      turboInitialDuration = Math.max(500, engine.turboUntil - currentTime);
      trails.length = 0;
      lastHeadKey = "";
    }

    wasActive = active;
    gameFrame.classList.toggle("turbo-active", active);

    if (active) {
      const remaining = Math.max(0, engine.turboUntil - currentTime);
      const denominator = Math.max(500, turboInitialDuration);
      const meter = Math.min(1, remaining / denominator);
      timeEl.textContent = `${(remaining / 1000).toFixed(1)}s`;
      meterEl.style.transform = `scaleX(${meter})`;

      rememberHead(now);
      const cellW = fxCanvas.width / engine.columns;
      const cellH = fxCanvas.height / engine.rows;
      drawTrail(now, cellW, cellH);
      drawSpeedLines(cellW, cellH, now);
      drawSnakeGlow(cellW, cellH, now);
      drawActivationRing(now, cellW, cellH);
      drawVignette(now);
    } else {
      trails.length = 0;
      meterEl.style.transform = "scaleX(0)";
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
