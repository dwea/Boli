import Matter from "matter-js";
import type {
  BoardMover,
  BucketGameData,
  BucketSectionConfig,
  BumperGameData,
  BumperSectionConfig,
  FloorGameData,
  LauncherGameData,
  LauncherSectionConfig,
  MultiplierGameData,
  MultiplierSectionConfig,
  PinGameData,
  PinPattern,
  PinSectionConfig,
} from "./types";

const { Bodies, Body } = Matter;

export const PIN_RADIUS = 5;
export const BALL_RADIUS = 7;
export const BUMPER_RADIUS = 20;
const WALL_THICKNESS = 16;

export interface SectionBuildResult {
  bodies: Matter.Body[];
  movers: BoardMover[];
}

function scoreForOffset(layout: "sparse" | "wide", xFrac: number): number {
  const base = layout === "sparse" ? 10 : 3;
  const spread = layout === "sparse" ? 4 : 1;
  return Math.round(base * (1 + Math.abs(xFrac) * spread));
}

/** A static, non-sensor rectangle spanning two points -- for the angled bucket lips. */
function segmentBody(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  options: Matter.IChamferableBodyDefinition
): Matter.Body {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, length, thickness, { ...options, angle });
}

function pinBody(x: number, y: number, isExploder: boolean): Matter.Body {
  const body = Bodies.circle(x, y, PIN_RADIUS, {
    isStatic: true,
    restitution: 0.65,
    friction: 0.05,
    label: isExploder ? "exploder-pin" : "pin",
  });
  const gameData: PinGameData = { isPin: true, isExploder };
  body.plugin.game = gameData;
  return body;
}

function buildPinsSection(
  x0: number,
  y0: number,
  width: number,
  height: number,
  config: PinSectionConfig
): SectionBuildResult {
  const pattern: PinPattern = config.pattern ?? "staggered";
  const rowSpacing = 28;
  const rows = config.rows ?? Math.max(2, Math.floor(height / rowSpacing));
  const margin = 24;
  const usableWidth = width - margin * 2;
  const exploderChance = config.exploderChance ?? 0;
  const bodies: Matter.Body[] = [];

  const maybeExploder = () => Math.random() < exploderChance;

  for (let row = 0; row < rows; row++) {
    const y = y0 + ((row + 1) * height) / (rows + 1);

    if (pattern === "staggered") {
      const cols = 7;
      const offset = row % 2 === 0 ? 0 : usableWidth / cols / 2;
      for (let col = 0; col <= cols; col++) {
        const x = x0 + margin + offset + (col * usableWidth) / cols;
        if (x < x0 + margin - 1 || x > x0 + width - margin + 1) continue;
        bodies.push(pinBody(x, y, maybeExploder()));
      }
    } else if (pattern === "funnel") {
      // Two converging diagonal lines: wide at the top of the section,
      // meeting near the center at the bottom, funneling balls inward.
      const progress = row / Math.max(1, rows - 1);
      const inset = margin + progress * (usableWidth / 2 - 20);
      bodies.push(pinBody(x0 + inset, y, maybeExploder()));
      bodies.push(pinBody(x0 + width - inset, y, maybeExploder()));
    } else if (pattern === "diamond") {
      // Two diverging diagonal lines: narrow at the top, spreading toward
      // the edges at the bottom, pushing balls outward.
      const progress = row / Math.max(1, rows - 1);
      const inset = margin + (1 - progress) * (usableWidth / 2 - 20);
      bodies.push(pinBody(x0 + inset, y, maybeExploder()));
      bodies.push(pinBody(x0 + width - inset, y, maybeExploder()));
    }
  }

  return { bodies, movers: [] };
}

const BUCKET_WALL_THICKNESS = 4;
// A very small angled lip at the mouth of each bucket, flaring outward at
// the top, so a ball that clips the rim gets funneled inward instead of
// deflecting away.
const BUCKET_LIP_SPAN = 8;
const BUCKET_LIP_RISE = 6;

function buildBucketsSection(
  id: string,
  x0: number,
  y0: number,
  width: number,
  height: number,
  config: BucketSectionConfig
): SectionBuildResult {
  const layout = config.layout;
  const count = config.bucketCount ?? (layout === "sparse" ? 5 : 2);
  const bucketWidth =
    layout === "sparse" ? 24 : (width / count) * 0.8;
  const y = y0 + height / 2;
  const depth = height * 0.7;
  const yTop = y - depth / 2;
  const yBottom = y + depth / 2;
  const margin = bucketWidth / 2 + 10;
  const usable = width - margin * 2;

  // With enough buckets, fixed-size lips flaring toward each other from
  // adjacent buckets can pinch the gap between them narrower than a ball
  // (e.g. Sparse Catchers (7)), trapping it bouncing in the seam instead of
  // falling through. Shrink the lip span so the clear gap between adjacent
  // bucket footprints never drops below a ball's diameter plus a margin.
  const spacing = count > 1 ? usable / (count - 1) : Infinity;
  const MIN_GAP = BALL_RADIUS * 2 + 6;
  const maxLipSpan = Math.max(0, (spacing - bucketWidth - MIN_GAP) / 2);
  const lipSpan = Math.min(BUCKET_LIP_SPAN, maxLipSpan);

  const bodies: Matter.Body[] = [];
  const movers: BoardMover[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const baseX = x0 + margin + t * usable;
    const xFrac = (baseX - (x0 + width / 2)) / (width / 2);
    const score = scoreForOffset(layout, xFrac);

    const leftX = baseX - bucketWidth / 2;
    const rightX = baseX + bucketWidth / 2;

    // Open-top hard-edged pocket: solid side walls, with the scoring sensor
    // just a thin strip at the very bottom -- so a ball visibly drops through
    // the open pocket interior before it registers, instead of scoring the
    // instant it clears the mouth.
    const sensorWidth = Math.max(4, bucketWidth - BUCKET_WALL_THICKNESS * 2);
    const sensorHeight = 10;
    const sensor = Bodies.rectangle(baseX, yBottom - sensorHeight / 2, sensorWidth, sensorHeight, {
      isStatic: true,
      isSensor: true,
      label: "bucket",
    });
    const gameData: BucketGameData = { isBucket: true, score };
    sensor.plugin.game = gameData;

    const wallOptions = { isStatic: true, restitution: 0.3, label: "bucket-wall" };
    const leftWall = Bodies.rectangle(leftX, y, BUCKET_WALL_THICKNESS, depth, wallOptions);
    const rightWall = Bodies.rectangle(rightX, y, BUCKET_WALL_THICKNESS, depth, wallOptions);
    const leftLip = segmentBody(
      leftX - lipSpan,
      yTop - BUCKET_LIP_RISE,
      leftX,
      yTop,
      BUCKET_WALL_THICKNESS,
      wallOptions
    );
    const rightLip = segmentBody(
      rightX + lipSpan,
      yTop - BUCKET_LIP_RISE,
      rightX,
      yTop,
      BUCKET_WALL_THICKNESS,
      wallOptions
    );

    const bucketBodies = [sensor, leftWall, rightWall, leftLip, rightLip];
    bodies.push(...bucketBodies);

    if (config.moving) {
      const amplitude = Math.min(usable / count / 2, 40);
      const speed = 0.0012 + Math.random() * 0.0006;
      const phase = Math.random() * Math.PI * 2;
      const minX = x0 + bucketWidth / 2 + 4;
      const maxX = x0 + width - bucketWidth / 2 - 4;
      const startX = bucketBodies.map((b) => b.position.x);
      movers.push({
        body: sensor,
        update: (elapsedMs: number) => {
          const raw = baseX + amplitude * Math.sin(elapsedMs * speed + phase);
          const clamped = Math.max(minX, Math.min(maxX, raw));
          const dx = clamped - baseX;
          bucketBodies.forEach((b, idx) => {
            Body.setPosition(b, { x: startX[idx] + dx, y: b.position.y });
          });
        },
      });
    }
  }

  void id;
  return { bodies, movers };
}

function buildMultiplierSection(
  id: string,
  x0: number,
  y0: number,
  width: number,
  height: number,
  _config: MultiplierSectionConfig
): SectionBuildResult {
  const y = y0 + height / 2;
  const body = Bodies.rectangle(x0 + width / 2, y, width - 4, Math.max(6, height * 0.6), {
    isStatic: true,
    isSensor: true,
    label: "multiplier",
  });
  const gameData: MultiplierGameData = { isMultiplier: true, sectionId: id };
  body.plugin.game = gameData;
  return { bodies: [body], movers: [] };
}

function buildBumpersSection(
  x0: number,
  y0: number,
  width: number,
  height: number
): SectionBuildResult {
  // Classic triangular pinball-bumper trio: one up top, two below.
  const centerX = x0 + width / 2;
  const spacing = Math.min(width * 0.22, 70);
  const topY = y0 + height * 0.38;
  const bottomY = y0 + height * 0.68;

  const positions = [
    { x: centerX, y: topY },
    { x: centerX - spacing, y: bottomY },
    { x: centerX + spacing, y: bottomY },
  ];

  const bodies = positions.map(({ x, y }) => {
    const body = Bodies.circle(x, y, BUMPER_RADIUS, {
      isStatic: true,
      restitution: 0.9,
      friction: 0,
      label: "bumper",
    });
    const gameData: BumperGameData = { isBumper: true };
    body.plugin.game = gameData;
    return body;
  });

  return { bodies, movers: [] };
}

function buildLauncherSection(x0: number, y0: number, width: number, height: number): SectionBuildResult {
  // A sensor marker, not an obstacle -- purely so the renderer and the tap
  // handler can find where launcher zones are. Balls pass through it freely.
  const body = Bodies.rectangle(x0 + width / 2, y0 + height / 2, width, height, {
    isStatic: true,
    isSensor: true,
    label: "launcher",
  });
  const gameData: LauncherGameData = { isLauncher: true };
  body.plugin.game = gameData;
  return { bodies: [body], movers: [] };
}

export function buildSection(
  id: string,
  x0: number,
  y0: number,
  width: number,
  config:
    | PinSectionConfig
    | BucketSectionConfig
    | MultiplierSectionConfig
    | BumperSectionConfig
    | LauncherSectionConfig
): SectionBuildResult {
  if (config.kind === "pins") {
    return buildPinsSection(x0, y0, width, config.height, config);
  }
  if (config.kind === "buckets") {
    return buildBucketsSection(id, x0, y0, width, config.height, config);
  }
  if (config.kind === "bumpers") {
    return buildBumpersSection(x0, y0, width, config.height);
  }
  if (config.kind === "launcher") {
    return buildLauncherSection(x0, y0, width, config.height);
  }
  const height = config.height ?? 16;
  return buildMultiplierSection(id, x0, y0, width, height, config);
}

// A wall spanning a section's full height meets an open (wrap-around)
// region right at its top/bottom edge -- a ball riding the wall can get
// pinched in that corner seam instead of wrapping away. Insetting the wall
// from both ends leaves a gap there so the ball always has room to clear it.
const WALL_END_GAP = 24;

/** Solid side walls spanning one section's own y-range (opt-in via `walls: true`). */
export function buildSideWalls(y0: number, height: number, width: number): Matter.Body[] {
  const gap = Math.min(WALL_END_GAP, height * 0.15);
  const wallHeight = Math.max(0, height - gap * 2);
  const centerY = y0 + height / 2;
  const left = Bodies.rectangle(-WALL_THICKNESS / 2, centerY, WALL_THICKNESS, wallHeight, {
    isStatic: true,
    label: "wall",
  });
  const right = Bodies.rectangle(width + WALL_THICKNESS / 2, centerY, WALL_THICKNESS, wallHeight, {
    isStatic: true,
    label: "wall",
  });
  return [left, right];
}

export function buildFloor(width: number, y: number): Matter.Body {
  const body = Bodies.rectangle(width / 2, y + 2, width, 4, {
    isStatic: true,
    isSensor: true,
    label: "floor",
  });
  const gameData: FloorGameData = { isFloor: true };
  body.plugin.game = gameData;
  return body;
}

