import type { SectionConfig } from "./game/types";

export interface SectionTemplate {
  id: string;
  label: string;
  config: SectionConfig;
}

export interface SectionCard {
  id: string;
  templateId: string;
}

export const TEMPLATES: SectionTemplate[] = [
  {
    id: "staggered-basic",
    label: "Staggered Field",
    config: { kind: "pins", height: 170, pattern: "staggered", exploderChance: 0 },
  },
  {
    id: "staggered-exploder",
    label: "Staggered Field (Exploders)",
    config: { kind: "pins", height: 170, pattern: "staggered", exploderChance: 0.08 },
  },
  {
    id: "funnel-basic",
    label: "Funnel Field",
    config: { kind: "pins", height: 150, pattern: "funnel", exploderChance: 0.04 },
  },
  {
    id: "diamond-basic",
    label: "Diamond Field",
    config: { kind: "pins", height: 150, pattern: "diamond", exploderChance: 0.04 },
  },
  {
    id: "sparse-5",
    label: "Sparse Catchers (5)",
    config: { kind: "buckets", height: 50, layout: "sparse", bucketCount: 5 },
  },
  {
    id: "sparse-7",
    label: "Sparse Catchers (7)",
    config: { kind: "buckets", height: 60, layout: "sparse", bucketCount: 7 },
  },
  {
    id: "wide-safe",
    label: "Wide Safety Net",
    config: { kind: "buckets", height: 60, layout: "wide", bucketCount: 2, moving: false },
  },
  {
    id: "wide-moving",
    label: "Wide Moving Net",
    config: { kind: "buckets", height: 60, layout: "wide", bucketCount: 2, moving: true },
  },
  {
    id: "doubler",
    label: "Doubler Strip",
    config: { kind: "multiplier", height: 14 },
  },
  {
    id: "doubler-compact",
    label: "Compact Doubler",
    config: { kind: "multiplier", height: 10 },
  },
  {
    id: "bumper-trio",
    label: "Bumper Trio",
    config: { kind: "bumpers", height: 140, walls: true },
  },
  {
    id: "launcher-basic",
    label: "Basic Launcher",
    config: { kind: "launcher", height: 50 },
  },
];

const STORAGE_KEY = "boli-collection-v1";
// A launcher, a playfield section, and a catcher are mandatory for every
// board (see roleOf() in game/types.ts) -- the starter deck always carries
// at least one of each so a turn can always be arranged.
const STARTER_TEMPLATE_IDS = [
  "launcher-basic",
  "staggered-basic",
  "sparse-5",
  "doubler",
  "funnel-basic",
  "wide-safe",
  "bumper-trio",
];

export function templateFor(templateId: string): SectionTemplate {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(`Unknown section template: ${templateId}`);
  return template;
}

function makeCardId(templateId: string): string {
  return `${templateId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function starterCollection(): SectionCard[] {
  return STARTER_TEMPLATE_IDS.map((templateId) => ({
    id: makeCardId(templateId),
    templateId,
  }));
}

export function loadCollection(): SectionCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const starter = starterCollection();
      saveCollection(starter);
      return starter;
    }
    const parsed = JSON.parse(raw) as SectionCard[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const starter = starterCollection();
      saveCollection(starter);
      return starter;
    }
    return parsed;
  } catch {
    return starterCollection();
  }
}

export function saveCollection(cards: SectionCard[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // localStorage unavailable (private mode, etc); collection just won't persist.
  }
}

export function grantRandomCard(): SectionCard {
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return { id: makeCardId(template.id), templateId: template.id };
}

export function resetCollection(): SectionCard[] {
  const starter = starterCollection();
  saveCollection(starter);
  return starter;
}
