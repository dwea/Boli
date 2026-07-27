import { PachinkoGame } from "./game/engine";
import type { SectionDefinition } from "./game/types";

const BOARD_WIDTH = 360;
const STARTING_LIVES = 5;
const EXPLODE_BONUS_PER_BALL = 5;

const SECTIONS: SectionDefinition[] = [
  { id: "p1", label: "Staggered Field", config: { kind: "pins", height: 170, pattern: "staggered", exploderChance: 0.06 } },
  { id: "b1", label: "Sparse Catchers", config: { kind: "buckets", height: 50, layout: "sparse", bucketCount: 5 } },
  { id: "m1", label: "Doubler", config: { kind: "multiplier", height: 14 } },
  { id: "p2", label: "Funnel Field", config: { kind: "pins", height: 150, pattern: "funnel", exploderChance: 0.08 } },
  { id: "b2", label: "Moving Wide Net", config: { kind: "buckets", height: 60, layout: "wide", bucketCount: 2, moving: true } },
  { id: "p3", label: "Diamond Field", config: { kind: "pins", height: 150, pattern: "diamond" } },
  { id: "b3", label: "Sparse Finale", config: { kind: "buckets", height: 70, layout: "sparse", bucketCount: 6 } },
];

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const scoreEl = document.getElementById("stat-score")!;
const ballsEl = document.getElementById("stat-balls")!;
const livesEl = document.getElementById("stat-lives")!;
const gameoverEl = document.getElementById("gameover")!;
const finalScoreEl = document.getElementById("final-score")!;
const restartBtn = document.getElementById("restart") as HTMLButtonElement;

let score = 0;
let ballsDropped = 0;
let lives = STARTING_LIVES;
let gameOver = false;
let game: PachinkoGame;
let rafId = 0;
let lastTime = performance.now();

function updateHud() {
  scoreEl.textContent = String(score);
  ballsEl.textContent = String(ballsDropped);
  livesEl.textContent = String(Math.max(0, lives));
}

function sizeCanvas(height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = BOARD_WIDTH * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${BOARD_WIDTH}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startGame() {
  score = 0;
  ballsDropped = 0;
  lives = STARTING_LIVES;
  gameOver = false;
  gameoverEl.classList.add("hidden");

  game = new PachinkoGame(SECTIONS, BOARD_WIDTH, {
    onScore: (points) => {
      score += points;
      updateHud();
    },
    onMiss: () => {
      lives -= 1;
      updateHud();
      if (lives <= 0) endGame();
    },
    onMultiply: () => {
      // Visual/audio feedback hook for future polish.
    },
    onExplode: (ballsCaught) => {
      score += ballsCaught * EXPLODE_BONUS_PER_BALL;
      updateHud();
    },
    onBallSettled: () => {
      // Hook for future combo/streak tracking.
    },
  });

  sizeCanvas(game.boardHeight);
  updateHud();
}

function endGame() {
  gameOver = true;
  game.stop();
  finalScoreEl.textContent = String(score);
  gameoverEl.classList.remove("hidden");
}

function loop(now: number) {
  const delta = Math.min(32, now - lastTime);
  lastTime = now;
  if (!gameOver) {
    game.tick(delta);
    game.render(ctx);
  }
  rafId = requestAnimationFrame(loop);
}

function dropAt(clientX: number, clientY: number) {
  if (gameOver) return;
  const rect = canvas.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.top + 60) return;
  const scaleX = BOARD_WIDTH / rect.width;
  const x = (clientX - rect.left) * scaleX;
  game.dropBall(x);
  ballsDropped += 1;
  updateHud();
}

canvas.addEventListener("pointerdown", (e) => {
  dropAt(e.clientX, e.clientY);
});

restartBtn.addEventListener("click", () => {
  startGame();
});

startGame();
cancelAnimationFrame(rafId);
lastTime = performance.now();
rafId = requestAnimationFrame(loop);
