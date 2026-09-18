(() => {
  "use strict";

  const config = window.SNAKE_CONFIG;
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const recordEl = document.getElementById("record");
  const eventFeedEl = document.getElementById("eventFeed");
  const leaderboardEl = document.getElementById("leaderboard");
  const statusStrip = document.getElementById("statusStrip");
  const connectionStatus = document.getElementById("connectionStatus");
  const turboBadge = document.getElementById("turboBadge");
  const shieldBadge = document.getElementById("shieldBadge");
  const shieldCount = document.getElementById("shieldCount");
  const gameOverEl = document.getElementById("gameOver");
  const finalScoreEl = document.getElementById("finalScore");
  const recordMessageEl = document.getElementById("recordMessage");

  const query = new URLSearchParams(window.location.search);
  const isTestMode = query.get("test") === "1";
  if (isTestMode) document.body.classList.add("test-mode");

  let record = Number(sessionStorage.getItem("snake-live-record") || 0);
  let lastStepAt = performance.now();
  let restartTimer = null;
  let recentEvents = [];
  let explosionFlashUntil = 0;
  let audioContext = null;
  let turnKeyBuffer = null;
  let turnKeyBufferPromise = null;
  let explosionNoiseBuffer = null;
  let moveSoundFlip = false;
  const audioConfig = {
    turnKeyEnabled: true,
    turnKeyVolume: 0.62,
    moveEnabled: true,
    moveVolume: 0.035,
    eatEnabled: true,
    eatVolume: 0.20,
    explosionEnabled: true,
    explosionVolume: 0.42,
    ...(config.audio || {})
  };
  const contributors = new Map();
  const giftCounters = new Map();

  const engine = new window.SnakeEngine({
    ...config.board,
    onEvent: handleEngineEvent
  });

  recordEl.textContent = record;

  function getAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
    return audioContext;
  }

  function safeVolume(value, fallback) {
    const parsed = Number(value);
    return Math.max(0, Math.min(1, Number.isFinite(parsed) ? parsed : fallback));
  }

  function unlockAudio() {
    const ac = getAudioContext();
    if (!ac) return;
    if (ac.state !== "running") ac.resume().catch(() => {});
    loadTurnKeyBuffer().catch(() => {});
  }

  function loadTurnKeyBuffer() {
    if (turnKeyBuffer) return Promise.resolve(turnKeyBuffer);
    if (turnKeyBufferPromise) return turnKeyBufferPromise;

    const ac = getAudioContext();
    const src = window.SNAKE_AUDIO_ASSETS?.turnKey;
    if (!ac || !src) return Promise.resolve(null);

    turnKeyBufferPromise = fetch(src)
      .then((response) => response.arrayBuffer())
      .then((data) => ac.decodeAudioData(data.slice(0)))
      .then((buffer) => {
        turnKeyBuffer = buffer;
        return buffer;
      })
      .catch((error) => {
        console.warn("[SnakeAudio] Falha ao carregar clique de teclado:", error);
        turnKeyBufferPromise = null;
        return null;
      });

    return turnKeyBufferPromise;
  }

  function playAudioBuffer(buffer, volume, playbackRate = 1) {
    const ac = getAudioContext();
    if (!ac || ac.state !== "running" || !buffer) return;

    const source = ac.createBufferSource();
    const gain = ac.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ac.destination);
    source.start();
  }

  function playTurnKeySound() {
    if (!audioConfig.turnKeyEnabled) return;
    const ac = getAudioContext();
    if (!ac || ac.state !== "running") return;

    const volume = safeVolume(audioConfig.turnKeyVolume, 0.62);
    if (turnKeyBuffer) {
      playAudioBuffer(turnKeyBuffer, volume);
      return;
    }

    loadTurnKeyBuffer().then((buffer) => {
      if (buffer && ac.state === "running") {
        playAudioBuffer(buffer, volume);
      }
    });
  }

  function playMoveSound() {
    if (!audioConfig.moveEnabled) return;
    const ac = getAudioContext();
    if (!ac || ac.state !== "running") return;

    moveSoundFlip = !moveSoundFlip;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const filter = ac.createBiquadFilter();
    const volume = safeVolume(audioConfig.moveVolume, 0.035);

    osc.type = "square";
    osc.frequency.setValueAtTime(moveSoundFlip ? 145 : 170, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520, now);

    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.02);
  }

  function playEatSound(food) {
    if (!audioConfig.eatEnabled) return;
    const ac = getAudioContext();
    if (!ac || ac.state !== "running") return;

    const special = food?.type === "special";
    const volume = safeVolume(audioConfig.eatVolume, 0.20);
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(special ? 520 : 390, now);
    osc.frequency.exponentialRampToValueAtTime(
      special ? 1050 : 720,
      now + (special ? 0.11 : 0.075),
    );

    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + (special ? 0.13 : 0.09),
    );

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + (special ? 0.14 : 0.10));

    if (special) {
      const sparkle = ac.createOscillator();
      const sparkleGain = ac.createGain();
      sparkle.type = "sine";
      sparkle.frequency.setValueAtTime(1320, now + 0.03);
      sparkle.frequency.exponentialRampToValueAtTime(1760, now + 0.12);
      sparkleGain.gain.setValueAtTime(volume * 0.34, now + 0.03);
      sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      sparkle.connect(sparkleGain);
      sparkleGain.connect(ac.destination);
      sparkle.start(now + 0.03);
      sparkle.stop(now + 0.15);
    }
  }

  function getExplosionNoiseBuffer(ac) {
    if (explosionNoiseBuffer) return explosionNoiseBuffer;

    const duration = 0.55;
    const frameCount = Math.floor(ac.sampleRate * duration);
    const buffer = ac.createBuffer(1, frameCount, ac.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i += 1) {
      const p = i / frameCount;
      const envelope = Math.pow(1 - p, 2.1);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    explosionNoiseBuffer = buffer;
    return buffer;
  }

  function playExplosionSound() {
    if (!audioConfig.explosionEnabled) return;
    const ac = getAudioContext();
    if (!ac || ac.state !== "running") return;

    const volume = safeVolume(audioConfig.explosionVolume, 0.42);
    const now = ac.currentTime;

    const noise = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const noiseGain = ac.createGain();

    noise.buffer = getExplosionNoiseBuffer(ac);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1500, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.48);
    noiseGain.gain.setValueAtTime(volume, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.55);

    const boom = ac.createOscillator();
    const boomGain = ac.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(92, now);
    boom.frequency.exponentialRampToValueAtTime(34, now + 0.42);
    boomGain.gain.setValueAtTime(volume * 0.85, now);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
    boom.connect(boomGain);
    boomGain.connect(ac.destination);
    boom.start(now);
    boom.stop(now + 0.48);
  }

  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("keydown", unlockAudio);
  loadTurnKeyBuffer().catch(() => {});

  function handleEngineEvent(event) {
    if (event.type === "direction-changed") {
      playTurnKeySound();
    }

    if (event.type === "moved") {
      playMoveSound();
    }

    if (event.type === "ate") {
      playEatSound(event.food);
      const user = event.food.user;
      if (user && user !== "JOGO") {
        addContribution(user, event.food.points);
        pushEvent(`🍏 Comida de @${user} • +${event.food.points}`);
      }
      if (event.score > record) {
        record = event.score;
        sessionStorage.setItem("snake-live-record", String(record));
        recordEl.textContent = record;
      }
    }

    if (event.type === "bomb-exploded") {
      playExplosionSound();
      explosionFlashUntil = performance.now() + 280;
      const user = event.bomb.user || "viewer";
      pushEvent(`💥 A bomba de @${user} EXPLODIU!`);
      flashStatus(`💥 BOOM! Bomba de @${user}!`);
    }

    if (event.type === "shield-used") {
      pushEvent("🛡️ Escudo salvou a cobrinha!");
      flashStatus("🛡️ ESCUDO USADO — a partida continua!");
    }

    if (event.type === "game-over") {
      showGameOver(event.score);
    }

    updateHud();
  }

  function gameLoop(now) {
    engine.updateBombs(Date.now());

    if (engine.alive && now - lastStepAt >= engine.tickMs) {
      lastStepAt = now;
      engine.step();
    }

    updatePowerBadges();
    render(now);
    requestAnimationFrame(gameLoop);
  }

  function render(now) {
    const cols = engine.columns;
    const rows = engine.rows;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    const exploding = engine.bombs.some((bomb) => bomb.state === "exploding");
    const shake = exploding ? 2.8 : 0;
    const dx = shake ? (Math.random() - 0.5) * shake * 2 : 0;
    const dy = shake ? (Math.random() - 0.5) * shake * 2 : 0;

    ctx.fillStyle = "#03100d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(dx, dy);

    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#071611");
    bg.addColorStop(1, "#03100d");
    ctx.fillStyle = bg;
    ctx.fillRect(-8, -8, canvas.width + 16, canvas.height + 16);

    ctx.strokeStyle = "rgba(83,255,139,.075)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(canvas.width, y * cellH);
      ctx.stroke();
    }

    for (const obstacle of engine.obstacles) drawLegacyObstacle(obstacle, cellW, cellH);
    for (const bomb of engine.bombs) drawBomb(bomb, cellW, cellH, now);
    for (const food of engine.food) drawFood(food, cellW, cellH);
    drawSnake(cellW, cellH);

    ctx.restore();

    if (now < explosionFlashUntil) {
      const alpha = Math.max(0, (explosionFlashUntil - now) / 280) * 0.22;
      ctx.fillStyle = `rgba(255,188,72,${alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawLegacyObstacle(obstacle, cellW, cellH) {
    const x = obstacle.x * cellW;
    const y = obstacle.y * cellH;
    ctx.fillStyle = "#242e34";
    roundRect(x + 3, y + 3, cellW - 6, cellH - 6, 5);
    ctx.strokeStyle = "#59656d";
    ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
  }

  function drawBomb(bomb, cellW, cellH, now) {
    const cx = (bomb.x + 0.5) * cellW;
    const cy = (bomb.y + 0.5) * cellH;
    const size = Math.min(cellW, cellH);

    if (bomb.state === "armed") {
      const timeLeft = Math.max(0, bomb.explodeAt - Date.now());
      const progress = 1 - timeLeft / engine.bombArmMs;
      const pulse = 0.5 + 0.5 * Math.sin(now / 85);
      const spawnAge = Math.max(0, Date.now() - bomb.createdAt);
      const pop = Math.min(1, spawnAge / 240);
      const scale = (0.72 + 0.28 * easeOutBack(pop)) * (1 + pulse * 0.035);

      ctx.save();
      ctx.fillStyle = `rgba(255,55,55,${0.035 + progress * 0.10})`;
      ctx.strokeStyle = `rgba(255,96,62,${0.18 + progress * 0.62})`;
      ctx.lineWidth = 1.5;
      for (let ox = -engine.bombBlastRadius; ox <= engine.bombBlastRadius; ox += 1) {
        for (let oy = -engine.bombBlastRadius; oy <= engine.bombBlastRadius; oy += 1) {
          const gx = (bomb.x + ox) * cellW;
          const gy = (bomb.y + oy) * cellH;
          if (gx < 0 || gy < 0 || gx >= canvas.width || gy >= canvas.height) continue;
          ctx.fillRect(gx + 2, gy + 2, cellW - 4, cellH - 4);
          if (pulse > 0.55) ctx.strokeRect(gx + 3, gy + 3, cellW - 6, cellH - 6);
        }
      }
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      const radius = size * 0.31;
      const body = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, 1, 0, 0, radius);
      body.addColorStop(0, "#667079");
      body.addColorStop(0.24, "#2f363d");
      body.addColorStop(1, "#080b0d");
      ctx.shadowColor = `rgba(255,66,42,${0.25 + progress * 0.6})`;
      ctx.shadowBlur = 8 + progress * 16;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, size * 0.05, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#777f85";
      roundRect(-size * 0.11, -size * 0.30, size * 0.22, size * 0.12, size * 0.035);

      ctx.strokeStyle = "#a88b61";
      ctx.lineWidth = Math.max(2, size * 0.055);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(size * 0.02, -size * 0.29);
      ctx.quadraticCurveTo(size * 0.16, -size * 0.47, size * 0.29, -size * 0.40);
      ctx.stroke();

      const sparkX = size * 0.30;
      const sparkY = -size * 0.40;
      ctx.shadowColor = "#ffb12d";
      ctx.shadowBlur = 12 + pulse * 8;
      ctx.fillStyle = pulse > 0.4 ? "#fff49a" : "#ff8d24";
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, size * (0.06 + pulse * 0.025), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#ff6b24";
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        const angle = now / 120 + i * (Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(sparkX + Math.cos(angle) * size * 0.08, sparkY + Math.sin(angle) * size * 0.08);
        ctx.lineTo(sparkX + Math.cos(angle) * size * 0.16, sparkY + Math.sin(angle) * size * 0.16);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (bomb.state === "exploding") {
      const elapsed = Date.now() - bomb.explosionStartedAt;
      const p = Math.min(1, elapsed / engine.bombExplosionMs);
      const radius = size * (0.45 + p * (engine.bombBlastRadius + 1.05));
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glow.addColorStop(0, `rgba(255,255,225,${0.95 * (1 - p * 0.45)})`);
      glow.addColorStop(0.22, `rgba(255,210,66,${0.9 * (1 - p * 0.5)})`);
      glow.addColorStop(0.55, `rgba(255,93,31,${0.7 * (1 - p)})`);
      glow.addColorStop(1, "rgba(255,40,20,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255,225,118,${1 - p})`;
      ctx.lineWidth = Math.max(2, size * 0.09 * (1 - p));
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.35 + p * 1.65), 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 12; i += 1) {
        const angle = i * (Math.PI * 2 / 12) + bomb.id * 0.41;
        const dist = size * (0.3 + p * (0.7 + (i % 3) * 0.25));
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        ctx.fillStyle = i % 2 ? `rgba(255,111,31,${1 - p})` : `rgba(255,236,112,${1 - p})`;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, size * 0.045 * (1 - p)), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (bomb.state === "burned") {
      const age = Date.now() - bomb.burnedAt;
      const life = Math.max(1, bomb.expiresAt - bomb.burnedAt);
      const fade = Math.max(0.22, 1 - age / life);
      const x = bomb.x * cellW;
      const y = bomb.y * cellH;

      ctx.shadowColor = `rgba(255,76,24,${0.35 * fade})`;
      ctx.shadowBlur = 10;
      ctx.fillStyle = `rgba(35,31,31,${0.95 * fade + 0.05})`;
      roundRect(x + 3, y + 3, cellW - 6, cellH - 6, 5);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255,93,37,${0.45 * fade})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + cellW * 0.22, y + cellH * 0.20);
      ctx.lineTo(x + cellW * 0.52, y + cellH * 0.48);
      ctx.lineTo(x + cellW * 0.37, y + cellH * 0.78);
      ctx.moveTo(x + cellW * 0.52, y + cellH * 0.48);
      ctx.lineTo(x + cellW * 0.80, y + cellH * 0.30);
      ctx.stroke();
    }
  }

  function drawFood(food, cellW, cellH) {
    const cx = (food.x + 0.5) * cellW;
    const cy = (food.y + 0.5) * cellH;
    const special = food.type === "special";
    ctx.shadowColor = special ? "#ffd45a" : "#ff3d78";
    ctx.shadowBlur = special ? 17 : 10;
    ctx.fillStyle = special ? "#ffd45a" : "#ff456f";
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(cellW, cellH) * (special ? 0.31 : 0.24), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (special) {
      ctx.fillStyle = "#6b4f00";
      ctx.font = `900 ${Math.max(10, cellW * 0.35)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", cx, cy + 1);
    }
  }

  function drawSnake(cellW, cellH) {
    engine.snake.forEach((part, index) => {
      const x = part.x * cellW;
      const y = part.y * cellH;
      const head = index === 0;
      ctx.shadowColor = head ? "#89ff9d" : "#31e978";
      ctx.shadowBlur = head ? 13 : 6;
      ctx.fillStyle = head ? "#82ff90" : index % 2 ? "#32e878" : "#28d96e";
      roundRect(x + 2.5, y + 2.5, cellW - 5, cellH - 5, head ? 7 : 5);
      ctx.shadowBlur = 0;

      if (head) {
        const eyeSize = Math.max(2, cellW * 0.08);
        const eyeOffset = cellW * 0.19;
        ctx.fillStyle = "#05240f";
        ctx.beginPath();
        ctx.arc(
          x + cellW / 2 + eyeOffset * engine.direction.y,
          y + cellH / 2 - eyeOffset * engine.direction.x,
          eyeSize,
          0,
          Math.PI * 2
        );
        ctx.arc(
          x + cellW / 2 - eyeOffset * engine.direction.y,
          y + cellH / 2 + eyeOffset * engine.direction.x,
          eyeSize,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    });
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }

  function updateHud() {
    scoreEl.textContent = engine.score;
    levelEl.textContent = engine.level;
    recordEl.textContent = record;
    shieldCount.textContent = engine.shields;
  }

  function updatePowerBadges() {
    turboBadge.classList.toggle("show", Date.now() < engine.turboUntil);
    shieldBadge.classList.toggle("show", engine.shields > 0);
    shieldCount.textContent = engine.shields;
  }

  function addContribution(user, points) {
    const current = contributors.get(user) || 0;
    contributors.set(user, current + Math.max(1, points));
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const ranking = [...contributors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    leaderboardEl.innerHTML = ranking.length
      ? ranking
          .map(
            ([user, value], index) =>
              `<div class="rank"><span class="pos">${index + 1}</span><span>@${escapeHtml(user)}</span><span class="score">${value}</span></div>`
          )
          .join("")
      : `<div class="event">Aguardando presentes...</div>`;
  }

  function pushEvent(text) {
    recentEvents.unshift(text);
    recentEvents = recentEvents.slice(0, 5);
    eventFeedEl.innerHTML = recentEvents
      .map((item) => `<div class="event">${escapeHtml(item)}</div>`)
      .join("");
  }

  function flashStatus(text) {
    statusStrip.textContent = text;
    clearTimeout(flashStatus.timer);
    flashStatus.timer = setTimeout(() => {
      statusStrip.textContent = "🌹 Presentes colocam comida e mudam a partida!";
    }, 2600);
  }

  function showGameOver(score) {
    finalScoreEl.textContent = score;
    const newRecord = score >= record && score > 0;
    recordMessageEl.textContent = newRecord ? "🏆 Novo recorde da LIVE!" : `Recorde atual: ${record}`;
    gameOverEl.classList.add("show");
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      engine.reset();
      lastStepAt = performance.now();
      gameOverEl.classList.remove("show");
      pushEvent("🐍 Nova partida começou!");
    }, config.board.restartDelayMs);
  }

  function processAction(action, user = "viewer") {
    const safeUser = normalizeUser(user);
    if (!engine.alive && action.action !== "shield") return;

    if (action.action === "food") {
      const created = engine.spawnFoods(action.amount || 1, {
        type: "normal",
        points: 1,
        grow: 1,
        user: safeUser
      });
      if (created > 0) addContribution(safeUser, created);
      pushEvent(`🌹 @${safeUser} colocou ${created} comida${created === 1 ? "" : "s"}`);
      flashStatus(`🌹 @${safeUser} adicionou comida!`);
    }

    if (action.action === "specialFood") {
      const created = engine.spawnFoods(action.amount || 1, {
        type: "special",
        points: 5,
        grow: 2,
        user: safeUser
      });
      if (created > 0) addContribution(safeUser, created * 2);
      pushEvent(`🍩 @${safeUser} criou comida especial`);
      flashStatus(`🍩 COMIDA ESPECIAL de @${safeUser}!`);
    }

    if (action.action === "turbo") {
      engine.setTurbo(action.durationMs || 5000);
      addContribution(safeUser, 3);
      pushEvent(`⚡ @${safeUser} ativou TURBO`);
      flashStatus(`⚡ TURBO ativado por @${safeUser}!`);
    }

    if (action.action === "bomb") {
      const amount = Math.max(1, Math.min(4, action.amount || 1));
      let created = 0;
      for (let i = 0; i < amount; i += 1) {
        if (engine.addBomb(safeUser)) created += 1;
      }
      if (created > 0) addContribution(safeUser, created * 2);
      pushEvent(`💣 @${safeUser} lançou ${created} bomba${created === 1 ? "" : "s"}!`);
      flashStatus(`💣 CUIDADO! Bomba de @${safeUser} armada.`);
    }

    if (action.action === "shield") {
      engine.addShield(action.amount || 1);
      addContribution(safeUser, 4);
      pushEvent(`🛡️ @${safeUser} deu um ESCUDO`);
      flashStatus(`🛡️ ESCUDO enviado por @${safeUser}!`);
    }

    updateHud();
  }

  function processGift(data) {
    const user = data?.user?.uniqueId || data?.user?.nickname || "viewer";
    const giftName = String(data?.giftName || "").trim().toLowerCase();
    const giftKey = giftName.replace(/\s+/g, "");
    const mapping =
      config.gifts[giftName] ||
      config.gifts[giftKey] ||
      config.fallbackByTier[data?.giftType] ||
      config.fallbackByTier.small;

    const streakKey = `${normalizeUser(user)}:${data?.giftId || giftKey}`;
    const now = Date.now();
    const previous = giftCounters.get(streakKey);
    let repeatDelta = 1;
    const repeatCount = Math.max(1, Number(data?.repeatCount) || 1);

    if (previous && now - previous.at < 1600 && repeatCount > previous.count) {
      repeatDelta = repeatCount - previous.count;
    } else if (previous && now - previous.at < 500 && repeatCount === previous.count) {
      repeatDelta = 0;
    }
    giftCounters.set(streakKey, { count: repeatCount, at: now });

    if (repeatDelta <= 0) return;

    const action = { ...mapping };
    if (action.amount) action.amount *= repeatDelta;
    processAction(action, user);
  }

  function normalizeUser(value) {
    return (
      String(value || "viewer")
        .replace(/^@/, "")
        .replace(/[<>]/g, "")
        .slice(0, 22) || "viewer"
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function wireTikTok() {
    if (!window.TikTokBridge) return;

    window.TikTokBridge.on("connected", () => {
      connectionStatus.textContent = "● TIKTOK CONECTADO";
      connectionStatus.classList.remove("offline");
      connectionStatus.classList.add("online");
      pushEvent("✅ TikTok LIVE conectada");
    });

    window.TikTokBridge.on("disconnected", () => {
      connectionStatus.textContent = "TIKTOK DESCONECTADO";
      connectionStatus.classList.remove("online");
      connectionStatus.classList.add("offline");
    });

    window.TikTokBridge.on("reconnecting", () => {
      connectionStatus.textContent = "RECONECTANDO...";
      connectionStatus.classList.remove("online");
      connectionStatus.classList.add("offline");
    });

    window.TikTokBridge.on("gift", processGift);

    window.TikTokBridge.on("chat", (data) => {
      const comment = String(data?.comment || "").toLowerCase();
      if (comment.includes("cobrinha") || comment.includes("snake")) {
        const user = data?.user?.uniqueId || data?.user?.nickname || "viewer";
        pushEvent(`💬 @${normalizeUser(user)}: ${comment.slice(0, 34)}`);
      }
    });
  }

  function setupTestPanel() {
    if (!isTestMode) return;
    const buttons = document.getElementById("testButtons");
    const userInput = document.getElementById("testUser");

    for (const item of config.testActions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => processAction(item, userInput.value));
      buttons.appendChild(button);
    }

    document.getElementById("testReset").addEventListener("click", () => {
      clearTimeout(restartTimer);
      engine.reset();
      lastStepAt = performance.now();
      gameOverEl.classList.remove("show");
      pushEvent("↻ Partida reiniciada");
    });
  }

  renderLeaderboard();
  pushEvent("🐍 Cobrinha pronta. Aguardando a LIVE...");
  updateHud();
  wireTikTok();
  setupTestPanel();
  requestAnimationFrame(gameLoop);

  window.SnakeLiveTest = {
    action: processAction,
    reset: () => engine.reset(),
    keySound: playTurnKeySound,
    moveSound: playMoveSound,
    eatSound: () => playEatSound({ type: "normal" }),
    specialEatSound: () => playEatSound({ type: "special" }),
    explosionSound: playExplosionSound,
    unlockAudio,
    engine
  };
})();
