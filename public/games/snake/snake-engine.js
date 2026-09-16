(() => {
  "use strict";

  class SnakeEngine {
    constructor(options = {}) {
      this.columns = options.columns ?? 22;
      this.rows = options.rows ?? 30;
      this.normalTickMs = options.normalTickMs ?? 155;
      this.turboTickMs = options.turboTickMs ?? 88;
      this.maxFood = options.maxFood ?? 28;
      this.maxObstacles = options.maxObstacles ?? 18;
      this.onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
      this.reset();
    }

    reset() {
      const cy = Math.floor(this.rows / 2);
      const cx = Math.floor(this.columns / 2);
      this.snake = [
        { x: cx, y: cy },
        { x: cx - 1, y: cy },
        { x: cx - 2, y: cy },
        { x: cx - 3, y: cy }
      ];
      this.direction = { x: 1, y: 0 };
      this.food = [];
      this.obstacles = [];
      this.score = 0;
      this.level = 1;
      this.shields = 0;
      this.turboUntil = 0;
      this.alive = true;
      this.pendingGrowth = 0;
      this.lastEaten = null;
      this.spawnFood({ type: "normal", points: 1, grow: 1, user: "JOGO" });
      this.onEvent({ type: "reset" });
    }

    get tickMs() {
      return Date.now() < this.turboUntil ? this.turboTickMs : this.normalTickMs;
    }

    setTurbo(durationMs = 5000) {
      const base = Math.max(Date.now(), this.turboUntil);
      this.turboUntil = base + Math.max(500, durationMs);
      this.onEvent({ type: "power", power: "turbo", until: this.turboUntil });
    }

    addShield(amount = 1) {
      this.shields = Math.min(5, this.shields + Math.max(1, amount));
      this.onEvent({ type: "power", power: "shield", shields: this.shields });
    }

    spawnFood(options = {}) {
      if (this.food.length >= this.maxFood) return false;
      const cell = this.findEmptyCell();
      if (!cell) return false;
      const item = {
        ...cell,
        type: options.type ?? "normal",
        points: options.points ?? 1,
        grow: options.grow ?? 1,
        user: options.user ?? "",
        createdAt: Date.now()
      };
      this.food.push(item);
      this.onEvent({ type: "food-spawned", food: item });
      return true;
    }

    spawnFoods(count, options = {}) {
      const amount = Math.max(1, Math.min(12, Number(count) || 1));
      let created = 0;
      for (let i = 0; i < amount; i += 1) {
        if (this.spawnFood(options)) created += 1;
      }
      return created;
    }

    addObstacle() {
      if (this.obstacles.length >= this.maxObstacles) return false;
      const cell = this.findEmptyCell({ avoidHeadRadius: 5 });
      if (!cell) return false;
      this.obstacles.push(cell);
      this.onEvent({ type: "obstacle-spawned", obstacle: cell });
      return true;
    }

    step() {
      if (!this.alive) return;

      this.direction = this.chooseDirection();
      const head = this.snake[0];
      const next = {
        x: head.x + this.direction.x,
        y: head.y + this.direction.y
      };

      const collision = this.getCollision(next);
      if (collision) {
        if (this.shields > 0) {
          this.shields -= 1;
          if (collision.type === "obstacle") {
            this.obstacles = this.obstacles.filter(
              (o) => !(o.x === next.x && o.y === next.y)
            );
          }
          const rescue = this.findSafestDirection();
          if (rescue) this.direction = rescue;
          this.onEvent({
            type: "shield-used",
            collision: collision.type,
            shields: this.shields
          });
          return;
        }
        this.alive = false;
        this.onEvent({ type: "game-over", score: this.score });
        return;
      }

      this.snake.unshift(next);

      const foodIndex = this.food.findIndex((f) => f.x === next.x && f.y === next.y);
      if (foodIndex >= 0) {
        const eaten = this.food.splice(foodIndex, 1)[0];
        this.score += eaten.points;
        this.pendingGrowth += Math.max(0, eaten.grow - 1);
        this.level = 1 + Math.floor(this.score / 20);
        this.lastEaten = eaten;
        this.onEvent({ type: "ate", food: eaten, score: this.score, level: this.level });
        if (this.food.length === 0) {
          this.spawnFood({ type: "normal", points: 1, grow: 1, user: "JOGO" });
        }
      } else if (this.pendingGrowth > 0) {
        this.pendingGrowth -= 1;
      } else {
        this.snake.pop();
      }
    }

    chooseDirection() {
      const candidates = this.getCandidateDirections();
      if (candidates.length === 0) return this.direction;

      const target = this.getBestFoodTarget();
      let best = null;
      let bestScore = -Infinity;

      for (const dir of candidates) {
        const head = this.snake[0];
        const next = { x: head.x + dir.x, y: head.y + dir.y };
        if (this.getCollision(next)) continue;

        const space = this.floodSpace(next, 110);
        let score = space * 2.2;

        if (target) {
          const distance = Math.abs(next.x - target.x) + Math.abs(next.y - target.y);
          score -= distance * 3.5;
          if (target.type === "special") score += 7;
        }

        if (dir.x === this.direction.x && dir.y === this.direction.y) score += 2;
        score += Math.random() * 0.35;

        if (score > bestScore) {
          bestScore = score;
          best = dir;
        }
      }

      return best ?? this.findSafestDirection() ?? this.direction;
    }

    getCandidateDirections() {
      const dirs = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
      ];
      return dirs.filter(
        (d) => !(d.x === -this.direction.x && d.y === -this.direction.y)
      );
    }

    findSafestDirection() {
      let best = null;
      let bestSpace = -1;
      for (const dir of this.getCandidateDirections()) {
        const head = this.snake[0];
        const next = { x: head.x + dir.x, y: head.y + dir.y };
        if (this.getCollision(next)) continue;
        const space = this.floodSpace(next, 140);
        if (space > bestSpace) {
          bestSpace = space;
          best = dir;
        }
      }
      return best;
    }

    getBestFoodTarget() {
      if (this.food.length === 0) return null;
      const head = this.snake[0];
      return this.food.reduce((best, item) => {
        if (!best) return item;
        const d1 = Math.abs(head.x - item.x) + Math.abs(head.y - item.y);
        const d2 = Math.abs(head.x - best.x) + Math.abs(head.y - best.y);
        const bonus1 = item.type === "special" ? -4 : 0;
        const bonus2 = best.type === "special" ? -4 : 0;
        return d1 + bonus1 < d2 + bonus2 ? item : best;
      }, null);
    }

    floodSpace(start, limit = 120) {
      const queue = [start];
      const seen = new Set([this.key(start)]);
      let count = 0;

      while (queue.length && count < limit) {
        const cell = queue.shift();
        count += 1;
        for (const d of [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 }
        ]) {
          const next = { x: cell.x + d.x, y: cell.y + d.y };
          const key = this.key(next);
          if (seen.has(key) || this.getCollision(next, true)) continue;
          seen.add(key);
          queue.push(next);
        }
      }
      return count;
    }

    getCollision(cell, ignoreTail = false) {
      if (
        cell.x < 0 ||
        cell.x >= this.columns ||
        cell.y < 0 ||
        cell.y >= this.rows
      ) {
        return { type: "wall" };
      }

      const body = ignoreTail ? this.snake.slice(0, -1) : this.snake;
      if (body.some((s) => s.x === cell.x && s.y === cell.y)) {
        return { type: "self" };
      }

      if (this.obstacles.some((o) => o.x === cell.x && o.y === cell.y)) {
        return { type: "obstacle" };
      }

      return null;
    }

    findEmptyCell(options = {}) {
      const avoidHeadRadius = options.avoidHeadRadius ?? 0;
      const head = this.snake[0];

      for (let attempt = 0; attempt < 180; attempt += 1) {
        const cell = {
          x: Math.floor(Math.random() * this.columns),
          y: Math.floor(Math.random() * this.rows)
        };

        if (
          avoidHeadRadius &&
          Math.abs(cell.x - head.x) + Math.abs(cell.y - head.y) < avoidHeadRadius
        ) {
          continue;
        }

        if (this.isOccupied(cell)) continue;
        return cell;
      }
      return null;
    }

    isOccupied(cell) {
      return (
        this.snake.some((s) => s.x === cell.x && s.y === cell.y) ||
        this.food.some((f) => f.x === cell.x && f.y === cell.y) ||
        this.obstacles.some((o) => o.x === cell.x && o.y === cell.y)
      );
    }

    key(cell) {
      return `${cell.x},${cell.y}`;
    }
  }

  window.SnakeEngine = SnakeEngine;
})();
