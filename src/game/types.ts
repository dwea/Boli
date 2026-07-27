import Matter from "matter-js";

export type PinPattern = "staggered" | "funnel" | "diamond";

export interface PinSectionConfig {
  kind: "pins";
  height: number;
  pattern?: PinPattern;
  rows?: number;
  exploderChance?: number;
}

export interface BucketSectionConfig {
  kind: "buckets";
  height: number;
  layout: "sparse" | "wide";
  bucketCount?: number;
  moving?: boolean;
}

export interface MultiplierSectionConfig {
  kind: "multiplier";
  height?: number;
}

export type SectionConfig =
  | PinSectionConfig
  | BucketSectionConfig
  | MultiplierSectionConfig;

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
  multipliedIn: Set<string>;
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
