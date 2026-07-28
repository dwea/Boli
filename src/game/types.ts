import Matter from "matter-js";

export type PinPattern = "staggered" | "funnel" | "diamond";

/**
 * `walls` controls what happens at the left/right edges of a section's own
 * height range: unset/false (the default) wraps the ball to the opposite
 * side, like Asteroids; true gives that section solid side walls instead,
 * so the ball bounces off them.
 */
interface SectionConfigBase {
  walls?: boolean;
}

export interface PinSectionConfig extends SectionConfigBase {
  kind: "pins";
  height: number;
  pattern?: PinPattern;
  rows?: number;
  exploderChance?: number;
}

export interface BucketSectionConfig extends SectionConfigBase {
  kind: "buckets";
  height: number;
  layout: "sparse" | "wide";
  bucketCount?: number;
  moving?: boolean;
}

export interface MultiplierSectionConfig extends SectionConfigBase {
  kind: "multiplier";
  height?: number;
}

export interface BumperSectionConfig extends SectionConfigBase {
  kind: "bumpers";
  height: number;
}

export type SectionConfig =
  | PinSectionConfig
  | BucketSectionConfig
  | MultiplierSectionConfig
  | BumperSectionConfig;

export interface SectionDefinition {
  id: string;
  label: string;
  config: SectionConfig;
}

export interface BoardMover {
  body: Matter.Body;
  update: (elapsedMs: number) => void;
}

export interface BuiltBoard {
  bodies: Matter.Body[];
  movers: BoardMover[];
  totalHeight: number;
  boardWidth: number;
}

export interface BallGameData {
  isBall: true;
  scoredOrLost?: boolean;
  /**
   * Timestamp (performance.now()) this ball last triggered a multiplier --
   * only guards against re-triggering the same crossing event within one
   * short cooldown window. A ball (including one just spawned by a
   * multiply) can double again at any doubler, including the same one,
   * once it legitimately re-crosses it downward after that window.
   */
  lastMultiplyAt: number;
}

export interface BucketGameData {
  isBucket: true;
  score: number;
}

export interface PinGameData {
  isPin: true;
  isExploder: boolean;
}

export interface MultiplierGameData {
  isMultiplier: true;
  sectionId: string;
}

export interface FloorGameData {
  isFloor: true;
}

export interface BumperGameData {
  isBumper: true;
}
