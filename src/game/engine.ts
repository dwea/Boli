import Matter from "matter-js";
import { buildBoard } from "./board";
import { BALL_RADIUS } from "./sections";
import { makeBallGameData } from "./sections";
import type {
  BallGameData,
  BucketGameData,
  MultiplierGameData,
  PinGameData,
  SectionDefinition,
} from "./types";

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

const EXPLOSION_RADIUS = 90;
const EXPLOSION_FORCE = 0.03;

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
      const multiplier = gameData as MultiplierGameData;
      const ballData = ball.plugin.game as BallGameData;
      if (ballData.multipliedIn.has(multiplier.sectionId)) return;
      ballData.multipliedIn.add(multiplier.sectionId);
      this.spawnBall(ball.position.x + (Math.random() - 0.5) * 10, ball.position.y, ballData);
      Body.setVelocity(ball, {
        x: ball.velocity.x + (Math.random() - 0.5) * 1.5,
        y: ball.velocity.y,
      });
      this.callbacks.onMultiply();
      return;
    }

    if ((gameData as PinGameData).isExploder) {
      this.explodeAt(other.position.x, other.position.y);
    }
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

  private spawnBall(x: number, y: number, inheritedData?: BallGameData) {
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.55,
      friction: 0.02,
      frictionAir: 0.0006,
      density: 0.002,
      label: "ball",
    });
    const gameData: BallGameData = inheritedData
      ? { isBall: true, multipliedIn: new Set(inheritedData.multipliedIn) }
      : makeBallGameData();
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

  tick(deltaMs: number) {
    if (!this.running) return;
    Engine.update(this.engine, deltaMs);
    const elapsed = performance.now() - this.startedAt;
    for (const mover of this.movers) mover.update(elapsed);
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.bornAt < 400);
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
      ctx.strokeStyle = `rgba(255,107,107,${1 - age})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
