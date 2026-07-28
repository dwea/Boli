import Matter from "matter-js";
import { buildBoard } from "./board";
import { BALL_RADIUS, BUMPER_RADIUS } from "./sections";
import type {
  BallGameData,
  BucketGameData,
  BumperGameData,
  LauncherGameData,
  LauncherZone,
  MultiplierGameData,
  PinGameData,
  SectionDefinition,
} from "./types";

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

const EXPLOSION_RADIUS = 90;
const EXPLOSION_FORCE = 0.03;
const BUMPER_KICK_SPEED = 15;
// Guards only against the same crossing event re-triggering (e.g. a
// freshly spawned sibling ball still overlapping the sensor) -- not a
// permanent "already doubled here" flag, so every real downward crossing
// doubles the ball, section repeats and spawned balls included.
const MULTIPLY_COOLDOWN_MS = 200;
// Repeated bumper kicks (or bumper + explosion chains) could otherwise
// compound into runaway velocity; this is the hard ceiling on ball speed.
const MAX_BALL_SPEED = 22;
// A hard ceiling above the very top of the board; anything shot back up
// past this line (a bumper kick, say) bounces back down instead of flying
// off indefinitely.
const CEILING_LINE_Y = -20;
// All simulated motion (ball physics, movers) runs at 75% of real time.
const TIME_SCALE = 0.75;
const PIN_FLASH_MS = 220;
const BUCKET_FLASH_MS = 260;

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface Particle {
  x: number;
  y: number;
  bornAt: number;
  color: string;
  /** "ring" (default) is the existing expanding stroke; "glow" is a filled, swelling-then-fading radial blend. */
  kind?: "ring" | "glow";
  durationMs?: number;
}

export interface GameCallbacks {
  onScore: (points: number, bucketX: number, bucketY: number) => void;
  onMiss: () => void;
  onMultiply: () => void;
  onExplode: (ballsCaught: number) => void;
  onBallSettled: () => void;
}

export class PachinkoGame {
  readonly engine: Matter.Engine;
  readonly world: Matter.World;
  readonly boardWidth: number;
  readonly boardHeight: number;
  private movers: ReturnType<typeof buildBoard>["movers"];
  private launcherZones: LauncherZone[];
  private balls: Set<Matter.Body> = new Set();
  private particles: Particle[] = [];
  private pinHits = new Map<Matter.Body, number>();
  private bucketHits = new Map<Matter.Body, number>();
  private simTime = 0;
  private callbacks: GameCallbacks;
  private running = true;

  constructor(sections: SectionDefinition[], boardWidth: number, callbacks: GameCallbacks) {
    this.engine = Engine.create();
    this.engine.gravity.y = 1;
    this.world = this.engine.world;
    this.boardWidth = boardWidth;
    this.callbacks = callbacks;

    const board = buildBoard(sections, boardWidth);
    this.boardHeight = board.totalHeight + 20;
    this.movers = board.movers;
    this.launcherZones = board.launcherZones;
    World.add(this.world, board.bodies);

    Events.on(this.engine, "collisionStart", (event) => {
      for (const pair of event.pairs) {
        this.handlePair(pair.bodyA, pair.bodyB);
      }
    });
  }

  private handlePair(a: Matter.Body, b: Matter.Body) {
    const [ball, other] = a.plugin?.game?.isBall ? [a, b] : b.plugin?.game?.isBall ? [b, a] : [null, null];
    if (!ball || !other || !this.balls.has(ball)) return;

    const gameData = other.plugin?.game;
    if (!gameData) return;

    if (gameData.isBucket) {
      const bucket = gameData as BucketGameData;
      this.bucketHits.set(other, this.simTime);
      this.particles.push({
        x: other.position.x,
        y: other.position.y,
        bornAt: this.simTime,
        color: "#ffd166",
      });
      this.callbacks.onScore(bucket.score, other.position.x, other.position.y);
      this.removeBall(ball);
      return;
    }

    if (gameData.isFloor) {
      // A brief flame-colored glow where the ball hit, as if it fell into lava.
      this.particles.push({
        x: ball.position.x,
        y: ball.position.y,
        bornAt: this.simTime,
        color: "#ff4d1f",
        kind: "glow",
        durationMs: 550,
      });
      this.callbacks.onMiss();
      this.removeBall(ball);
      return;
    }

    if (gameData.isMultiplier) {
      if (ball.velocity.y <= 0) return; // only downward crossings double the ball
      const ballData = ball.plugin.game as BallGameData;
      if (this.simTime - ballData.lastMultiplyAt < MULTIPLY_COOLDOWN_MS) return;
      ballData.lastMultiplyAt = this.simTime;
      this.spawnBall(ball.position.x + (Math.random() - 0.5) * 10, ball.position.y, this.simTime);
      Body.setVelocity(ball, {
        x: ball.velocity.x + (Math.random() - 0.5) * 1.5,
        y: ball.velocity.y,
      });
      this.callbacks.onMultiply();
      return;
    }

    if ((gameData as BumperGameData).isBumper) {
      this.hitBumper(ball, other);
      return;
    }

    if ((gameData as PinGameData).isPin) {
      this.pinHits.set(other, this.simTime);
      if ((gameData as PinGameData).isExploder) {
        this.explodeAt(other.position.x, other.position.y);
      }
    }
  }

  private hitBumper(ball: Matter.Body, bumper: Matter.Body) {
    const dx = ball.position.x - bumper.position.x;
    const dy = ball.position.y - bumper.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    Body.setVelocity(ball, {
      x: (dx / dist) * BUMPER_KICK_SPEED,
      y: (dy / dist) * BUMPER_KICK_SPEED - 2,
    });
    this.particles.push({ x: bumper.position.x, y: bumper.position.y, bornAt: this.simTime, color: "#ff2d78" });
  }

  private explodeAt(x: number, y: number) {
    let caught = 0;
    for (const ball of this.balls) {
      const dx = ball.position.x - x;
      const dy = ball.position.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < EXPLOSION_RADIUS && dist > 0.01) {
        caught++;
        const falloff = 1 - dist / EXPLOSION_RADIUS;
        Body.applyForce(ball, ball.position, {
          x: (dx / dist) * EXPLOSION_FORCE * falloff,
          y: (dy / dist) * EXPLOSION_FORCE * falloff - 0.01 * falloff,
        });
      }
    }
    this.particles.push({ x, y, bornAt: this.simTime, color: "#ff6b6b" });
    if (caught > 0) this.callbacks.onExplode(caught);
  }

  // `bornFromMultiplyAt` gives a ball spawned by a multiplier the same
  // cooldown timestamp as its sibling, so it doesn't immediately re-trigger
  // the very event it was just born from while still overlapping the
  // sensor -- but it's otherwise free to double again like any other ball.
  private spawnBall(x: number, y: number, bornFromMultiplyAt = -Infinity) {
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.55,
      friction: 0.02,
      frictionAir: 0.0006,
      density: 0.002,
      label: "ball",
    });
    const gameData: BallGameData = { isBall: true, lastMultiplyAt: bornFromMultiplyAt };
    ball.plugin.game = gameData;
    this.balls.add(ball);
    World.add(this.world, ball);
  }

  /** Launches a ball if (x, y) falls within one of the board's launcher zones; returns whether it did. */
  tryLaunchAt(x: number, y: number): boolean {
    const zone = this.launcherZones.find((z) => y >= z.y0 && y <= z.y0 + z.height);
    if (!zone) return false;
    const clampedX = Math.max(BALL_RADIUS + 4, Math.min(this.boardWidth - BALL_RADIUS - 4, x));
    this.spawnBall(clampedX, zone.y0 + Math.min(10, zone.height / 2));
    return true;
  }

  private removeBall(ball: Matter.Body) {
    this.balls.delete(ball);
    Composite.remove(this.world, ball);
    this.callbacks.onBallSettled();
  }

  get activeBallCount(): number {
    return this.balls.size;
  }

  tick(deltaMs: number) {
    if (!this.running) return;
    const scaledDelta = deltaMs * TIME_SCALE;
    this.simTime += scaledDelta;
    Engine.update(this.engine, scaledDelta);
    this.capBallSpeeds();
    this.wrapBallsHorizontally();
    this.enforceCeiling();
    for (const mover of this.movers) mover.update(this.simTime);
    this.particles = this.particles.filter((p) => this.simTime - p.bornAt < (p.durationMs ?? 400));
  }

  // Sections without walls have no side colliders at all, so a ball only
  // ever ends up past the board edge there -- teleport it to the opposite
  // side, preserving velocity and how far past the edge it had gotten.
  private wrapBallsHorizontally() {
    for (const ball of this.balls) {
      if (ball.position.x < 0) {
        Body.setPosition(ball, { x: ball.position.x + this.boardWidth, y: ball.position.y });
      } else if (ball.position.x > this.boardWidth) {
        Body.setPosition(ball, { x: ball.position.x - this.boardWidth, y: ball.position.y });
      }
    }
  }

  // A thin physical ceiling body risks tunneling: a fast ball can cross its
  // whole thickness within one physics step, since Matter's collision
  // detection is discrete rather than continuous. A direct position/velocity
  // correction (the same approach as the wrap and speed cap above) always
  // catches it regardless of speed.
  private enforceCeiling() {
    for (const ball of this.balls) {
      if (ball.position.y < CEILING_LINE_Y) {
        Body.setPosition(ball, { x: ball.position.x, y: CEILING_LINE_Y });
        if (ball.velocity.y < 0) {
          Body.setVelocity(ball, { x: ball.velocity.x, y: -ball.velocity.y * 0.6 });
        }
      }
    }
  }

  // General safety net so no chain of bumper/exploder hits can compound
  // into runaway speed -- applies every tick, not just after a bumper hit.
  private capBallSpeeds() {
    for (const ball of this.balls) {
      const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
      if (speed > MAX_BALL_SPEED) {
        const scale = MAX_BALL_SPEED / speed;
        Body.setVelocity(ball, { x: ball.velocity.x * scale, y: ball.velocity.y * scale });
      }
    }
  }

  stop() {
    this.running = false;
  }

  // 1 right at the moment of a hit, decaying linearly to 0 over durationMs.
  private flashAmount(hits: Map<Matter.Body, number>, body: Matter.Body, durationMs: number): number {
    const hitAt = hits.get(body);
    if (hitAt === undefined) return 0;
    const t = (this.simTime - hitAt) / durationMs;
    return t >= 1 ? 0 : 1 - t;
  }

  render(ctx: CanvasRenderingContext2D) {
    const w = this.boardWidth;
    const h = this.boardHeight;
    ctx.clearRect(0, 0, w, h);

    const bodies = Composite.allBodies(this.world);
    for (const body of bodies) {
      if (body.label === "wall") {
        // The wall bodies themselves sit just off-canvas; draw a thin
        // indicator along the inside edge so a walled section (no wrap)
        // reads visibly differently from an open, wrap-around one.
        const y0 = body.bounds.min.y;
        const y1 = body.bounds.max.y;
        ctx.fillStyle = "rgba(139, 144, 171, 0.6)";
        ctx.fillRect(body.position.x < 0 ? 0 : w - 6, y0, 6, y1 - y0);
        continue;
      }

      if (body.label === "bucket-wall") {
        const vertices = body.vertices;
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (const v of vertices.slice(1)) ctx.lineTo(v.x, v.y);
        ctx.closePath();
        ctx.fillStyle = "#c7cbde";
        ctx.fill();
        continue;
      }

      const data = body.plugin?.game;
      if (!data) continue;

      if ((data as PinGameData).isPin) {
        const pin = data as PinGameData;
        const flash = this.flashAmount(this.pinHits, body, PIN_FLASH_MS);
        const radius = 5 + flash * 4;
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = pin.isExploder ? "#ff6b6b" : "#5b6a9c";
        ctx.fill();
        if (flash > 0) {
          ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.85})`;
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        if (pin.isExploder) {
          ctx.strokeStyle = "rgba(255,107,107,0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if ((data as BucketGameData).isBucket) {
        const bucket = data as BucketGameData;
        const flash = this.flashAmount(this.bucketHits, body, BUCKET_FLASH_MS);
        const vertices = body.vertices;
        ctx.save();
        if (flash > 0) {
          const scale = 1 + flash * 0.18;
          ctx.translate(body.position.x, body.position.y);
          ctx.scale(scale, scale);
          ctx.translate(-body.position.x, -body.position.y);
        }
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (const v of vertices.slice(1)) ctx.lineTo(v.x, v.y);
        ctx.closePath();
        const hue = 200 - Math.min(bucket.score, 50) * 3;
        ctx.fillStyle = `hsl(${hue}, 70%, 45%)`;
        ctx.fill();
        if (flash > 0) {
          ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.6})`;
          ctx.fill();
        }
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(bucket.score), body.position.x, body.position.y);
        ctx.restore();
      } else if ((data as BumperGameData).isBumper) {
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, BUMPER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#ff2d78";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, BUMPER_RADIUS * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
        ctx.fill();
      } else if ((data as LauncherGameData).isLauncher) {
        const vertices = body.vertices;
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (const v of vertices.slice(1)) ctx.lineTo(v.x, v.y);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 183, 3, 0.08)";
        ctx.fill();
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "#ffb703";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#ffb703";
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Tap anywhere to launch", body.position.x, body.position.y);
      } else if ((data as MultiplierGameData).isMultiplier) {
        const vertices = body.vertices;
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (const v of vertices.slice(1)) ctx.lineTo(v.x, v.y);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 183, 3, 0.35)";
        ctx.fill();
        ctx.strokeStyle = "#ffb703";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#ffb703";
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("x2", body.position.x, body.position.y + 4);
      }
    }

    ctx.fillStyle = "#f4f7ff";
    for (const ball of this.balls) {
      ctx.beginPath();
      ctx.arc(ball.position.x, ball.position.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of this.particles) {
      const age = Math.min(1, Math.max(0, (this.simTime - p.bornAt) / (p.durationMs ?? 400)));
      if (p.kind === "glow") {
        // Swells out then fades away entirely, like a brief flame flaring up.
        const radius = 22 * Math.sin(Math.PI * age);
        if (radius < 0.5) continue;
        const alpha = 1 - age;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        grad.addColorStop(0, `rgba(255, 235, 190, ${alpha})`);
        grad.addColorStop(0.45, `rgba(255, 120, 40, ${alpha * 0.85})`);
        grad.addColorStop(1, "rgba(160, 20, 10, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 + age * 60, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(p.color, 1 - age);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }
}
