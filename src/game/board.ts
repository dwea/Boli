import { buildFloor, buildSection, buildSideWalls } from "./sections";
import type { BuiltBoard, SectionDefinition } from "./types";

export function buildBoard(
  sections: SectionDefinition[],
  boardWidth: number
): BuiltBoard {
  const bodies: BuiltBoard["bodies"] = [];
  const movers: BuiltBoard["movers"] = [];
  let cursorY = 0;

  for (const section of sections) {
    const height =
      section.config.kind === "multiplier"
        ? section.config.height ?? 16
        : section.config.height;
    const result = buildSection(section.id, 0, cursorY, boardWidth, section.config);
    bodies.push(...result.bodies);
    movers.push(...result.movers);
    // Sections wrap the ball to the opposite side at their left/right edges
    // by default; `walls: true` opts a section into solid side walls instead.
    if (section.config.walls) {
      bodies.push(...buildSideWalls(cursorY, height, boardWidth));
    }
    cursorY += height;
  }

  const floor = buildFloor(boardWidth, cursorY);
  bodies.push(floor);

  return {
    bodies,
    movers,
    totalHeight: cursorY,
    boardWidth,
  };
}
