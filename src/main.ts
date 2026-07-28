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
const MAX_BALL_DROPS = 10;
const EXPLODE_BONUS_PER_BALL = 5;
const COVERAGE_BONUS_MAX = 50;

const buildScreen = document.getElementById("build-screen")!;
const playScreen = document.getElementById("play-screen")!;
const trayList = document.getElementById("tray-list")!;
const stackList = document.getElementById("stack-list")!;
const heightFill = document.getElementById("height-fill")!;
const heightLabel = document.getElementById("height-label")!;
const boardStatus = document.getElementById("board-status")!;
const startTurnBtn = document.getElementById("start-turn") as HTMLButtonElement;

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const scoreEl = document.getElementById("stat-score")!;
const ballsEl = document.getElementById("stat-balls")!;
const livesEl = document.getElementById("stat-lives")!;
const gameoverEl = document.getElementById("gameover")!;
const finalScoreEl = document.getElementById("final-score")!;
const rewardLabelEl = document.getElementById("reward-label")!;
const coverageLabelEl = document.getElementById("coverage-label")!;
const restartBtn = document.getElementById("restart") as HTMLButtonElement;
const abortTurnBtn = document.getElementById("abort-turn") as HTMLButtonElement;
const resetCollectionBtn = document.getElementById("reset-collection") as HTMLButtonElement;

let collection = loadCollection();
const builder = new BoardBuilder(trayList, stackList, heightFill, heightLabel, startTurnBtn, boardStatus);
builder.setCollection(collection);

const SCORE_ANIM_MS = 450;

let score = 0;
let displayedScore = 0;
let scoreAnimId = 0;
let ballsDropped = 0;
let lives = STARTING_LIVES;
let gameOver = false;
let game: PachinkoGame;
let rafId = 0;
let lastTime = performance.now();

function updateHud() {
  ballsEl.textContent = `${ballsDropped}/${MAX_BALL_DROPS}`;
  livesEl.textContent = String(Math.max(0, lives));
}

// Counts the score display up from its current value to the new total,
// swelling, brightening, and glowing while it spins.
function animateScoreDisplay(from: number, to: number) {
  cancelAnimationFrame(scoreAnimId);
  const startTime = performance.now();
  scoreEl.classList.remove("score-pop");
  void scoreEl.offsetWidth; // restart the CSS animation even if one is already running
  scoreEl.classList.add("score-pop");

  function step(now: number) {
    const t = Math.min(1, (now - startTime) / SCORE_ANIM_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    displayedScore = Math.round(from + (to - from) * eased);
    scoreEl.textContent = String(displayedScore);
    if (t < 1) {
      scoreAnimId = requestAnimationFrame(step);
    } else {
      displayedScore = to;
      scoreEl.textContent = String(to);
      scoreEl.classList.remove("score-pop");
    }
  }
  scoreAnimId = requestAnimationFrame(step);
}

function addScore(points: number) {
  if (points === 0) return;
  const from = displayedScore;
  score += points;
  animateScoreDisplay(from, score);
}

// A turn ends when either lives run out or every ball has been dropped and
// none are still in flight -- whichever happens first.
function checkTurnEnd() {
  if (gameOver) return;
  if (lives <= 0 || (ballsDropped >= MAX_BALL_DROPS && game.activeBallCount === 0)) {
    endGame();
  }
}

function sizeCanvas(height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = BOARD_WIDTH * dpr;
  canvas.height = height * dpr;
  canvas.style.width = "100%";
  canvas.style.maxWidth = `${BOARD_WIDTH}px`;
  canvas.style.aspectRatio = `${BOARD_WIDTH} / ${height}`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startTurn() {
  const sections = builder.buildSectionDefinitions();
  if (sections.length === 0) return;

  score = 0;
  displayedScore = 0;
  cancelAnimationFrame(scoreAnimId);
  scoreEl.classList.remove("score-pop");
  scoreEl.textContent = "0";
  ballsDropped = 0;
  lives = STARTING_LIVES;
  gameOver = false;
  gameoverEl.classList.add("hidden");
  rewardLabelEl.textContent = "";
  coverageLabelEl.textContent = "";

  game = new PachinkoGame(sections, BOARD_WIDTH, {
    onScore: (points) => {
      addScore(points);
    },
    onMiss: () => {
      lives -= 1;
      updateHud();
    },
    onMultiply: () => {
      // Visual/audio feedback hook for future polish.
    },
    onExplode: (ballsCaught) => {
      addScore(ballsCaught * EXPLODE_BONUS_PER_BALL);
    },
    onBallSettled: () => {
      checkTurnEnd();
    },
  });

  sizeCanvas(game.boardHeight);
  updateHud();

  buildScreen.classList.add("hidden");
  playScreen.classList.remove("hidden");
  window.scrollTo(0, 0);

  cancelAnimationFrame(rafId);
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function endGame() {
  gameOver = true;
  game.stop();

  const totalPins = game.totalPinCount;
  const touchedPins = game.touchedPinCount;
  if (totalPins > 0) {
    const coverageBonus = Math.round(COVERAGE_BONUS_MAX * (touchedPins / totalPins));
    addScore(coverageBonus);
    coverageLabelEl.textContent = `+${coverageBonus} coverage bonus (${touchedPins}/${totalPins} pins hit)`;
  } else {
    coverageLabelEl.textContent = "";
  }
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

function loop(now: number) {
  const delta = Math.min(32, now - lastTime);
  lastTime = now;
  if (!gameOver) {
    game.tick(delta);
    game.render(ctx);
  }
  rafId = requestAnimationFrame(loop);
}

function handleCanvasTap(clientX: number, clientY: number) {
  if (gameOver || ballsDropped >= MAX_BALL_DROPS) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = BOARD_WIDTH / rect.width;
  const scaleY = game.boardHeight / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  if (game.tryLaunchAt(x, y)) {
    ballsDropped += 1;
    updateHud();
  }
}

canvas.addEventListener("pointerdown", (e) => {
  handleCanvasTap(e.clientX, e.clientY);
});

startTurnBtn.addEventListener("click", startTurn);
restartBtn.addEventListener("click", backToCollection);
abortTurnBtn.addEventListener("click", abortTurn);

withConfirm(resetCollectionBtn, "Reset collection", "Tap again to confirm", () => {
  collection = resetCollection();
  builder.setCollection(collection);
});
