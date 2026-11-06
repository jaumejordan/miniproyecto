(() => {
  document.querySelector("style").remove();
  document.title = "Hushlight — Find your way out";
  document.body.innerHTML = `
    <main class="game">
      <header class="topline">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">E.</div>
          <div>
            <h1 class="brand-name">Hushlight</h1>
            <p class="brand-caption">Find your way through the dark</p>
          </div>
        </div>
        <div class="status" id="status" aria-live="polite">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="statusText">Ready to explore</span>
        </div>
      </header>
      <section class="hud" aria-label="Game status">
        <div class="hud-item">
          <div class="hud-label">Objective</div>
          <div class="hud-value" id="objective">Find the key</div>
        </div>
        <div class="hud-center" id="pulseStatus">Your echoes reveal the way</div>
        <div class="hud-item right">
          <div class="hud-label">Floor</div>
          <div class="hud-value" id="floor">01</div>
        </div>
      </section>
      <div class="court">
        <canvas id="canvas" width="800" height="544" aria-label="Hushlight. Explore the maze, collect its key, and reach the exit while avoiding the creature."></canvas>
        <div class="overlay" id="overlay">
          <div class="overlay-card">
            <p class="eyebrow">A maze you can't see</p>
            <h2 id="overlayTitle">Listen to the dark.</h2>
            <p class="overlay-message" id="overlayMessage">Find the key and escape. Press Space to send an echo that reveals nearby passages—but the creature hears it too.</p>
            <button id="startButton" type="button">Enter the maze</button>
          </div>
        </div>
      </div>
      <footer class="bottomline">
        <span class="desktop-hint">Move <kbd class="key">W</kbd><kbd class="key">A</kbd><kbd class="key">S</kbd><kbd class="key">D</kbd> or <kbd class="key">↑</kbd><kbd class="key">←</kbd><kbd class="key">↓</kbd><kbd class="key">→</kbd> · Echo <kbd class="key">Space</kbd> · Pause <kbd class="key">P</kbd></span>
        <span>Every maze is different</span>
      </footer>
      <nav class="touch-controls" aria-label="Touch controls">
        <div class="dpad">
          <button type="button" data-move="up" aria-label="Move up">↑</button>
          <button type="button" data-move="left" aria-label="Move left">←</button>
          <button type="button" data-move="down" aria-label="Move down">↓</button>
          <button type="button" data-move="right" aria-label="Move right">→</button>
        </div>
        <button class="pulse-button" id="pulseButton" type="button">Send echo · Space</button>
      </nav>
    </main>`;

  const canvas = document.querySelector("#canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#overlay");
  const title = document.querySelector("#overlayTitle");
  const message = document.querySelector("#overlayMessage");
  const startButton = document.querySelector("#startButton");
  const status = document.querySelector("#status");
  const statusText = document.querySelector("#statusText");
  const objective = document.querySelector("#objective");
  const pulseStatus = document.querySelector("#pulseStatus");
  const cols = 25;
  const rows = 17;
  const tile = 32;
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const moveNames = new Map([
    ["ArrowUp", [0, -1]], ["w", [0, -1]], ["W", [0, -1]],
    ["ArrowRight", [1, 0]], ["d", [1, 0]], ["D", [1, 0]],
    ["ArrowDown", [0, 1]], ["s", [0, 1]], ["S", [0, 1]],
    ["ArrowLeft", [-1, 0]], ["a", [-1, 0]], ["A", [-1, 0]]
  ]);
  const heldKeys = new Set();
  let maze;
  let player;
  let monster;
  let keyCell;
  let exitCell;
  let hasKey = false;
  let state = "ready";
  let floor = 1;
  let lastMove = 0;
  let lastMonsterMove = 0;
  let lastPulse = -Infinity;
  let pulse = null;
  let noise = null;
  let lastTime = 0;
  let pulseReadyAt = 0;
  let glow = 0;

  function setStatus(text, live = false) {
    statusText.textContent = text;
    status.classList.toggle("is-live", live);
  }

  function generateMaze() {
    const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
    const stack = [[1, 1]];
    grid[1][1] = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const choices = directions
        .map(([dx, dy]) => [x + dx * 2, y + dy * 2, dx, dy])
        .filter(([nx, ny]) => nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === 1);
      if (!choices.length) {
        stack.pop();
        continue;
      }
      const [nx, ny, dx, dy] = choices[Math.floor(Math.random() * choices.length)];
      grid[y + dy][x + dx] = 0;
      grid[ny][nx] = 0;
      stack.push([nx, ny]);
    }

    const distances = distanceMap(grid, 1, 1);
    const reachable = [...distances.entries()].sort((a, b) => b[1] - a[1]);
    exitCell = cellFromKey(reachable[0][0]);
    keyCell = cellFromKey(reachable[Math.floor(reachable.length * .72)][0]);
    const monsterPosition = cellFromKey(reachable[Math.floor(reachable.length * .48)][0]);
    return { grid, monsterPosition };
  }

  function cellKey(x, y) { return `${x},${y}`; }

  function cellFromKey(key) {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  }

  function distanceMap(grid, startX, startY) {
    const distances = new Map([[cellKey(startX, startY), 0]]);
    const queue = [[startX, startY]];
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index];
      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        const nextKey = cellKey(nx, ny);
        if (grid[ny]?.[nx] === 0 && !distances.has(nextKey)) {
          distances.set(nextKey, distances.get(cellKey(x, y)) + 1);
          queue.push([nx, ny]);
        }
      }
    }
    return distances;
  }

  function resetGame() {
    const generated = generateMaze();
    maze = generated.grid;
    player = { x: 1, y: 1 };
    monster = generated.monsterPosition;
    hasKey = false;
    pulse = null;
    noise = null;
    lastPulse = -Infinity;
    lastMove = 0;
    lastMonsterMove = 0;
    state = "playing";
    overlay.hidden = true;
    objective.textContent = "Find the key";
    setStatus("The maze is listening", true);
    pulseReadyAt = 0;
    updatePulseStatus(performance.now());
  }

  function updatePulseStatus(now) {
    const remaining = Math.max(0, pulseReadyAt - now);
    pulseStatus.textContent = remaining > 0
      ? `Echo recharging · ${(remaining / 1000).toFixed(1)}s`
      : "Space · send an echo";
  }

  function sendPulse(now = performance.now()) {
    if (state !== "playing" || now - lastPulse < 1150) return;
    lastPulse = now;
    pulse = { x: player.x, y: player.y, at: now };
    noise = { x: player.x, y: player.y, until: now + 2500 };
    pulseReadyAt = now + 1150;
    glow = 1;
  }

  function movePlayer(dx, dy, now) {
    if (state !== "playing" || now - lastMove < 105) return;
    lastMove = now;
    const x = player.x + dx;
    const y = player.y + dy;
    if (maze[y]?.[x] !== 0) return;
    player.x = x;
    player.y = y;
    if (!hasKey && player.x === keyCell.x && player.y === keyCell.y) {
      hasKey = true;
      objective.textContent = "Reach the exit";
      glow = 1;
    }
    if (hasKey && player.x === exitCell.x && player.y === exitCell.y) {
      floor += 1;
      document.querySelector("#floor").textContent = String(floor).padStart(2, "0");
      resetGame();
    }
    checkCaught();
  }

  function checkCaught() {
    if (Math.abs(player.x - monster.x) + Math.abs(player.y - monster.y) > 0) return;
    state = "lost";
    title.textContent = "The dark caught you.";
    message.textContent = "The creature found your echo. The maze has changed—try another route.";
    startButton.textContent = "Try again";
    overlay.hidden = false;
    setStatus("Lost in the maze");
  }

  function moveMonster(now) {
    if (state !== "playing" || now - lastMonsterMove < 420) return;
    lastMonsterMove = now;
    const target = noise && now < noise.until ? noise : player;
    const distances = distanceMap(maze, target.x, target.y);
    let best = null;
    let bestDistance = distances.get(cellKey(monster.x, monster.y)) ?? Infinity;
    for (const [dx, dy] of directions) {
      const x = monster.x + dx;
      const y = monster.y + dy;
      const distance = distances.get(cellKey(x, y));
      if (distance !== undefined && distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
    if (best) {
      monster = best;
      checkCaught();
    }
  }

  function drawMaze() {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const isWall = maze[y][x] === 1;
        ctx.fillStyle = isWall ? "#202a23" : ((x + y) % 2 ? "#18211a" : "#1a241c");
        ctx.fillRect(x * tile, y * tile, tile, tile);
        if (isWall) {
          ctx.fillStyle = "#29352b";
          ctx.fillRect(x * tile + 3, y * tile + 3, tile - 6, tile - 6);
        } else {
          ctx.fillStyle = "rgba(172, 190, 163, .045)";
          ctx.fillRect(x * tile + 15, y * tile + 15, 2, 2);
        }
      }
    }
  }

  function drawObjective(now) {
    const x = exitCell.x * tile + tile / 2;
    const y = exitCell.y * tile + tile / 2;
    ctx.strokeStyle = hasKey ? "#c4f26b" : "#647064";
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 9, y - 11, 18, 22);
    ctx.fillStyle = hasKey ? "#c4f26b" : "#7e897e";
    ctx.fillRect(x - 3, y - 1, 6, 12);
    if (!hasKey) {
      const keyX = keyCell.x * tile + tile / 2;
      const keyY = keyCell.y * tile + tile / 2;
      ctx.save();
      ctx.translate(keyX, keyY);
      ctx.rotate(Math.sin(now / 240) * .12);
      ctx.strokeStyle = "#f3ca73";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(-3, -4, 6, 0, Math.PI * 2);
      ctx.moveTo(3, -1);
      ctx.lineTo(11, 7);
      ctx.lineTo(8, 10);
      ctx.moveTo(7, 4);
      ctx.lineTo(4, 7);
      ctx.stroke();
      ctx.restore();
    }
  }

  function eraseLight(x, y, radius, alpha = 1) {
    const centerX = x * tile + tile / 2;
    const centerY = y * tile + tile / 2;
    const gradient = ctx.createRadialGradient(centerX, centerY, 8, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(.7, `rgba(255,255,255,${alpha * .88})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.globalCompositeOperation = "source-over";
  }

  function isLit(x, y, now) {
    const playerDistance = Math.hypot(player.x - x, player.y - y);
    if (playerDistance < 3.15) return true;
    if (!pulse) return false;
    const age = now - pulse.at;
    return age < 1350 && Math.hypot(pulse.x - x, pulse.y - y) < 5.4;
  }

  function drawFog(now) {
    ctx.fillStyle = "rgba(5, 9, 7, .96)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    eraseLight(player.x, player.y, tile * 3.45);
    if (pulse && now - pulse.at < 1350) {
      const age = now - pulse.at;
      const fade = 1 - age / 1350;
      eraseLight(pulse.x, pulse.y, tile * 5.5, fade);
      ctx.strokeStyle = `rgba(196, 242, 107, ${fade * .72})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        pulse.x * tile + tile / 2,
        pulse.y * tile + tile / 2,
        tile * (1.2 + age / 1350 * 4.1),
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }

  function drawCharacters(now) {
    if (isLit(monster.x, monster.y, now)) {
      const x = monster.x * tile + tile / 2;
      const y = monster.y * tile + tile / 2;
      ctx.fillStyle = "#dc7866";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#241613";
      ctx.fillRect(x - 5, y - 2, 3, 3);
      ctx.fillRect(x + 2, y - 2, 3, 3);
    }
    const x = player.x * tile + tile / 2;
    const y = player.y * tile + tile / 2;
    ctx.fillStyle = "#c4f26b";
    ctx.shadowColor = "#c4f26b";
    ctx.shadowBlur = 12 + glow * 10;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f5ffd9";
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMaze();
    drawObjective(now);
    drawFog(now);
    drawCharacters(now);
    glow = Math.max(0, glow - .025);
  }

  function frame(now) {
    const delta = Math.min((now - lastTime) / 1000 || 0, .04);
    lastTime = now;
    if (state === "playing") {
      for (const key of heldKeys) {
        const direction = moveNames.get(key);
        if (direction) {
          movePlayer(direction[0], direction[1], now);
          break;
        }
      }
      moveMonster(now);
      if (noise && now >= noise.until) noise = null;
    }
    updatePulseStatus(now);
    draw(now);
    requestAnimationFrame(frame);
  }

  function pauseGame() {
    if (state === "playing") {
      state = "paused";
      title.textContent = "Catch your breath.";
      message.textContent = "The creature waits in the dark. Resume when you're ready.";
      startButton.textContent = "Resume";
      overlay.hidden = false;
      setStatus("Paused");
    } else if (state === "paused") {
      state = "playing";
      overlay.hidden = true;
      setStatus("The maze is listening", true);
    }
  }

  startButton.addEventListener("click", () => {
    if (state === "paused") {
      pauseGame();
      return;
    }
    resetGame();
  });
  document.querySelector("#pulseButton").addEventListener("click", () => sendPulse());
  window.addEventListener("keydown", (event) => {
    if (moveNames.has(event.key) || event.key === " ") event.preventDefault();
    heldKeys.add(event.key);
    if (event.key === " " && !event.repeat) sendPulse();
    if ((event.key === "p" || event.key === "P" || event.key === "Escape") && !event.repeat) pauseGame();
  });
  window.addEventListener("keyup", (event) => heldKeys.delete(event.key));
  window.addEventListener("blur", () => heldKeys.clear());
  document.querySelectorAll("[data-move]").forEach((button) => {
    const direction = button.dataset.move;
    const key = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" }[direction];
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      heldKeys.add(key);
      movePlayer(...moveNames.get(key), performance.now());
    });
    const release = () => heldKeys.delete(key);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });

  const generated = generateMaze();
  maze = generated.grid;
  player = { x: 1, y: 1 };
  monster = generated.monsterPosition;
  draw(0);
  requestAnimationFrame(frame);
})();
