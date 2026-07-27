import { BoardBuilder } from "./builder";
import {
  grantRandomCard,
  loadCollection,
  resetCollection,
  saveCollection,
  templateFor,
} from "./collection";
import { PachinkoGame } from "./game/engine";

const BOARD_WIDTH = 360;
const STARTING_LIVES = 5;
const EXPLODE_BONUS_PER_BALL = 5;

const buildScreen = document.getElementById("build-screen")!;
const playScreen = document.getElementById("play-screen")!;
const trayList = document.getElementById("tray-list")!;
const stackList = document.getElementById("stack-list")!;
const heightFill = document.getElementById("height-fill")!;
const heightLabel = document.getElementById("height-label")!;
const startTurnBtn = document.getElementById("start-turn") as HTMLButtonElement;

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dropRail = document.getElementById("drop-rail")!;
const scoreEl = document.getElementById("stat-score")!;
const ballsEl = document.getElementById("stat-balls")!;
const livesEl = document.getElementById("stat-lives")!;
const gameoverEl = document.getElementById("gameover")!;
const finalScoreEl = document.getElementById("final-score")!;
const rewardLabelEl = document.getElementById("reward-label")!;
const restartBtn = document.getElementById("restart") as HTMLButtonElement;
const abortTurnBtn = document.getElementById("abort-turn") as HTMLButtonElement;
const resetCollectionBtn = document.getElementById("reset-collection") as HTMLButtonElement;

let collection = loadCollection();
const builder = new BoardBuilder(trayList, stackList, heightFill, heightLabel, startTurnBtn);
builder.setCollection(collection);

let score = 0;
let ballsDropped = 0;
let lives = STARTING_LIVES;
let gameOver = false;
let game: PachinkoGame;
let rafId = 0;
let lastTime = performance.now();
let scrollTargetY = 0;

function updateHud() {
  scoreEl.textContent = String(score);
  ballsEl.textContent = String(ballsDropped);
  livesEl.textContent = String(Math.max(0, lives));
}

function sizeCanvas(height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = BOARD_WIDTH * dpr;
  canvas.height = height * dpr;
  canvas.style.width = "100%";
  canvas.style.maxWidth = `${BOARD_WIDTH}px`;
  canvas.style.aspectRatio = `${BOARD_WIDTH} / ${height}`;
  dropRail.style.maxWidth = `${BOARD_WIDTH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startTurn() {
  const sections = builder.buildSectionDefinitions();
  if (sections.length === 0) return;

  score = 0;
  ballsDropped = 0;
  lives = STARTING_LIVES;
  gameOver = false;
  gameoverEl.classList.add("hidden");
  rewardLabelEl.textContent = "";

  game = new PachinkoGame(sections, BOARD_WIDTH, {
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

  buildScreen.classList.add("hidden");
  playScreen.classList.remove("hidden");
  window.scrollTo(0, 0);
  scrollTargetY = 0;

  cancelAnimationFrame(rafId);
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function endGame() {
  gameOver = true;
  game.stop();
  finalScoreEl.textContent = String(score);

  const reward = grantRandomCard();
  collection = [...collection, reward];
  saveCollection(collection);
  rewardLabelEl.textContent = `New section unlocked: ${templateFor(reward.templateId).label}`;

  gameoverEl.classList.remove("hidden");
}

function backToCollection() {
  cancelAnimationFrame(rafId);
  playScreen.classList.add("hidden");
  buildScreen.classList.remove("hidden");
  builder.syncOwnedCards(collection);
}

function abortTurn() {
  if (!gameOver) game.stop();
  gameOver = true;
  gameoverEl.classList.add("hidden");
  backToCollection();
}

function withConfirm(button: HTMLButtonElement, label: string, confirmLabel: string, action: () => void) {
  let confirming = false;
  let timeoutId = 0;
  button.addEventListener("click", () => {
    if (!confirming) {
      confirming = true;
      button.textContent = confirmLabel;
      button.classList.add("confirming");
      timeoutId = window.setTimeout(() => {
        confirming = false;
        button.textContent = label;
        button.classList.remove("confirming");
      }, 3000);
      return;
    }
    window.clearTimeout(timeoutId);
    confirming = false;
    button.textContent = label;
    button.classList.remove("confirming");
    action();
  });
}

// Keeps the furthest-fallen ball comfortably in view as the board scrolls
// past one screen -- nudges scroll toward it once it drifts outside the
// middle band of the viewport, eased rather than snapped.
function followLeadBall() {
  const leadY = game.getLeadBallY();
  if (leadY === null) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.height <= 0) return;

  const scale = rect.height / game.boardHeight;
  const ballViewportY = rect.top + leadY * scale;
  const vh = window.innerHeight;

  if (ballViewportY > vh * 0.7 || ballViewportY < vh * 0.3) {
    scrollTargetY = window.scrollY + (ballViewportY - vh * 0.5);
  }

  const current = window.scrollY;
  const next = current + (scrollTargetY - current) * 0.12;
  if (Math.abs(next - current) > 0.5) {
    window.scrollTo(0, next);
  }
}

function loop(now: number) {
  const delta = Math.min(32, now - lastTime);
  lastTime = now;
  if (!gameOver) {
    game.tick(delta);
    game.render(ctx);
    followLeadBall();
  }
  rafId = requestAnimationFrame(loop);
}

function dropAt(clientX: number) {
  if (gameOver) return;
  const rect = dropRail.getBoundingClientRect();
  const scaleX = BOARD_WIDTH / rect.width;
  const x = (clientX - rect.left) * scaleX;
  game.dropBall(x);
  ballsDropped += 1;
  updateHud();
}

dropRail.addEventListener("pointerdown", (e) => {
  dropAt(e.clientX);
});

startTurnBtn.addEventListener("click", startTurn);
restartBtn.addEventListener("click", backToCollection);
abortTurnBtn.addEventListener("click", abortTurn);

withConfirm(resetCollectionBtn, "Reset collection", "Tap again to confirm", () => {
  collection = resetCollection();
  builder.setCollection(collection);
});
