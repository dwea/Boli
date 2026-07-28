import Matter from "matter-js";
import { buildBoard } from "./board";
import { BALL_RADIUS, BUMPER_RADIUS } from "./sections";
import type {
  BallGameData,
  BucketGameData,
  BumperGameData,
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
// Balls spawn at y=-10; anything shot back up past this line (a bumper
// kick, say) bounces back down instead of flying off past the drop point.
const CEILING_LINE_Y = -20;

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
  private balls: Set<Matter.Body> = new Set();
  private particles: Particle[] = [];
  private startedAt = performance.now();
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
      this.callbacks.onScore(bucket.score, other.position.x, other.position.y);
      this.removeBall(ball);
      return;
    }

    if (gameData.isFloor) {
      this.callbacks.onMiss();
      this.removeBall(ball);
      return;
    }

    if (gameData.isMultiplier) {
      if (ball.velocity.y <= 0) return; // only downward crossings double the ball
      const ballData = ball.plugin.game as BallGameData;
      const now = performance.now();
      if (now - ballData.lastMultiplyAt < MULTIPLY_COOLDOWN_MS) return;
      ballData.lastMultiplyAt = now;
      this.spawnBall(ball.position.x + (Math.random() - 0.5) * 10, ball.position.y, now);
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

    if ((gameData as PinGameData).isExploder) {
      this.explodeAt(other.position.x, other.position.y);
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
    this.particles.push({ x: bumper.position.x, y: bumper.position.y, bornAt: performance.now(), color: "#ff2d78" });
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
    this.particles.push({ x, y, bornAt: performance.now(), color: "#ff6b6b" });
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

  dropBall(x: number) {
    const clamped = Math.max(BALL_RADIUS + 4, Math.min(this.boardWidth - BALL_RADIUS - 4, x));
    this.spawnBall(clamped, -10);
  }

  private removeBall(ball: Matter.Body) {
    this.balls.delete(ball);
    Composite.remove(this.world, ball);
    this.callbacks.onBallSettled();
  }

  get activeBallCount(): number {
    return this.balls.size;
  }

  /**
   * Board-space y of the oldest still-falling ball, for camera-follow --
   * i.e. literally "the first ball" of whatever's currently in flight.
   * Sets preserve insertion order, so the first entry is the oldest.
   */
  getLeadBallY(): number | null {
    for (const ball of this.balls) return ball.position.y;
    return null;
  }

  tick(deltaMs: number) {
    if (!this.running) return;
    Engine.update(this.engine, deltaMs);
    this.capBallSpeeds();
    this.wrapBallsHorizontally();
    this.enforceCeiling();
    const elapsed = performance.now() - this.startedAt;
    for (const mover of this.movers) mover.update(elapsed);
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.bornAt < 400);
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

      const data = body.plugin?.game;
      if (!data) continue;

      if ((data as PinGameData).isPin) {
        const pin = data as PinGameData;
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = pin.isExploder ? "#ff6b6b" : "#5b6a9c";
        ctx.fill();
        if (pin.isExploder) {
          ctx.strokeStyle = "rgba(255,107,107,0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if ((data as BucketGameData).isBucket) {
        const bucket = data as BucketGameData;
        const vertices = body.vertices;
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (const v of vertices.slice(1)) ctx.lineTo(v.x, v.y);
        ctx.closePath();
        const hue = 200 - Math.min(bucket.score, 50) * 3;
        ctx.fillStyle = `hsl(${hue}, 70%, 45%)`;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(bucket.score), body.position.x, body.position.y);
      } else if ((data as BumperGameData).isBumper) {
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, BUMPER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#ff2d78";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, BUMPER_RADIUS * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
        ctx.fill();
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

    const now = performance.now();
    for (const p of this.particles) {
      const age = (now - p.bornAt) / 400;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + age * 60, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(p.color, 1 - age);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
