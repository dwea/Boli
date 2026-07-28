import Matter from "matter-js";
import type {
  BallGameData,
  BoardMover,
  BucketGameData,
  BucketSectionConfig,
  BumperGameData,
  BumperSectionConfig,
  FloorGameData,
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
    layout === "sparse" ? 24 : (width / count) * 0.92;
  const y = y0 + height / 2;
  const margin = bucketWidth / 2 + 10;
  const usable = width - margin * 2;

  const bodies: Matter.Body[] = [];
  const movers: BoardMover[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const baseX = x0 + margin + t * usable;
    const xFrac = (baseX - (x0 + width / 2)) / (width / 2);
    const score = scoreForOffset(layout, xFrac);

    const body = Bodies.rectangle(baseX, y, bucketWidth, height * 0.7, {
      isStatic: true,
      isSensor: true,
      label: "bucket",
    });
    const gameData: BucketGameData = { isBucket: true, score };
    body.plugin.game = gameData;
    bodies.push(body);

    if (config.moving) {
      const amplitude = Math.min(usable / count / 2, 40);
      const speed = 0.0012 + Math.random() * 0.0006;
      const phase = Math.random() * Math.PI * 2;
      const minX = x0 + bucketWidth / 2 + 4;
      const maxX = x0 + width - bucketWidth / 2 - 4;
      movers.push({
        body,
        update: (elapsedMs: number) => {
          const raw = baseX + amplitude * Math.sin(elapsedMs * speed + phase);
          const clamped = Math.max(minX, Math.min(maxX, raw));
          Body.setPosition(body, { x: clamped, y });
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

export function buildSection(
  id: string,
  x0: number,
  y0: number,
  width: number,
  config: PinSectionConfig | BucketSectionConfig | MultiplierSectionConfig | BumperSectionConfig
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
  const height = config.height ?? 16;
  return buildMultiplierSection(id, x0, y0, width, height, config);
}

/** Solid side walls spanning one section's own y-range (opt-in via `walls: true`). */
export function buildSideWalls(y0: number, height: number, width: number): Matter.Body[] {
  const centerY = y0 + height / 2;
  const left = Bodies.rectangle(-WALL_THICKNESS / 2, centerY, WALL_THICKNESS, height, {
    isStatic: true,
    label: "wall",
  });
  const right = Bodies.rectangle(width + WALL_THICKNESS / 2, centerY, WALL_THICKNESS, height, {
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

export function makeBallGameData(): BallGameData {
  return { isBall: true, multipliedIn: new Set<string>() };
}
