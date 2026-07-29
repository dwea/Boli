import { templateFor, type SectionCard } from "./collection";
import { roleOf } from "./game/types";
import type { SectionDefinition, SectionRole } from "./game/types";

export const HEIGHT_BUDGET = 480;

const DEFAULT_LAUNCHER_TEMPLATE_ID = "launcher-basic";
const DEFAULT_CATCHER_TEMPLATE_ID = "wide-safe";

type ZoneName = "tray" | "stack" | "launcher" | "catcher";

interface DragState {
  cardId: string;
  sourceZone: ZoneName;
  ghost: HTMLElement;
  grabDx: number;
  grabDy: number;
  hoverZone: ZoneName;
  hoverIndex: number;
}

function heightOf(templateId: string): number {
  const config = templateFor(templateId).config;
  return config.kind === "multiplier" ? config.height ?? 16 : config.height;
}

function kindOf(templateId: string): string {
  return templateFor(templateId).config.kind;
}

function roleOfTemplate(templateId: string): SectionRole {
  return roleOf(templateFor(templateId).config.kind);
}

function pickDefaultCard(
  cards: SectionCard[],
  role: SectionRole,
  preferredTemplateId: string
): SectionCard | null {
  const preferred = cards.find((c) => c.templateId === preferredTemplateId);
  if (preferred) return preferred;
  return cards.find((c) => roleOfTemplate(c.templateId) === role) ?? null;
}

export class BoardBuilder {
  private trayEl: HTMLElement;
  private stackEl: HTMLElement;
  private launcherSlotEl: HTMLElement;
  private catcherSlotEl: HTMLElement;
  private meterFillEl: HTMLElement;
  private meterLabelEl: HTMLElement;
  private startBtn: HTMLButtonElement;
  private statusEl: HTMLElement;

  private trayOrder: string[] = [];
  private stackOrder: string[] = []; // playfield sections only
  private launcherCardId: string | null = null;
  private catcherCardId: string | null = null;
  private cardsById = new Map<string, SectionCard>();

  private drag: DragState | null = null;
  private trayIndicator: HTMLElement;
  private stackIndicator: HTMLElement;

  constructor(
    trayEl: HTMLElement,
    stackEl: HTMLElement,
    launcherSlotEl: HTMLElement,
    catcherSlotEl: HTMLElement,
    meterFillEl: HTMLElement,
    meterLabelEl: HTMLElement,
    startBtn: HTMLButtonElement,
    statusEl: HTMLElement
  ) {
    this.trayEl = trayEl;
    this.stackEl = stackEl;
    this.launcherSlotEl = launcherSlotEl;
    this.catcherSlotEl = catcherSlotEl;
    this.meterFillEl = meterFillEl;
    this.meterLabelEl = meterLabelEl;
    this.startBtn = startBtn;
    this.statusEl = statusEl;

    this.trayIndicator = document.createElement("div");
    this.trayIndicator.className = "insertion-indicator hidden";
    this.stackIndicator = document.createElement("div");
    this.stackIndicator.className = "insertion-indicator hidden";

    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", () => this.cancelDrag());
  }

  /** Hard reset: launcher/catcher get their defaults, stack clears, everything else goes to the tray. */
  setCollection(cards: SectionCard[]) {
    this.cardsById = new Map(cards.map((c) => [c.id, c]));
    const launcher = pickDefaultCard(cards, "launcher", DEFAULT_LAUNCHER_TEMPLATE_ID);
    const catcher = pickDefaultCard(cards, "catcher", DEFAULT_CATCHER_TEMPLATE_ID);
    this.launcherCardId = launcher?.id ?? null;
    this.catcherCardId = catcher?.id ?? null;
    this.stackOrder = [];
    const placed = new Set([this.launcherCardId, this.catcherCardId].filter((id): id is string => id !== null));
    this.trayOrder = cards.map((c) => c.id).filter((id) => !placed.has(id));
    this.render();
  }

  /**
   * Update the owned cards without disturbing the current arrangement --
   * newly owned cards (e.g. turn rewards) land in the tray, everything
   * already placed (including the launcher/catcher slots) stays put.
   */
  syncOwnedCards(cards: SectionCard[]) {
    this.cardsById = new Map(cards.map((c) => [c.id, c]));
    const knownIds = new Set(cards.map((c) => c.id));
    if (this.launcherCardId && !knownIds.has(this.launcherCardId)) this.launcherCardId = null;
    if (this.catcherCardId && !knownIds.has(this.catcherCardId)) this.catcherCardId = null;
    this.stackOrder = this.stackOrder.filter((id) => knownIds.has(id));
    this.trayOrder = this.trayOrder.filter((id) => knownIds.has(id));

    const placed = new Set(
      [this.launcherCardId, this.catcherCardId, ...this.stackOrder, ...this.trayOrder].filter(
        (id): id is string => id !== null
      )
    );
    for (const card of cards) {
      if (!placed.has(card.id)) this.trayOrder.push(card.id);
    }
    this.render();
  }

  getTotalHeight(): number {
    let total = 0;
    if (this.launcherCardId) total += heightOf(this.cardsById.get(this.launcherCardId)!.templateId);
    for (const id of this.stackOrder) total += heightOf(this.cardsById.get(id)!.templateId);
    if (this.catcherCardId) total += heightOf(this.cardsById.get(this.catcherCardId)!.templateId);
    return total;
  }

  buildSectionDefinitions(): SectionDefinition[] {
    const toDefinition = (id: string): SectionDefinition => {
      const card = this.cardsById.get(id)!;
      const template = templateFor(card.templateId);
      return { id: card.id, label: template.label, config: template.config };
    };
    const defs: SectionDefinition[] = [];
    if (this.launcherCardId) defs.push(toDefinition(this.launcherCardId));
    for (const id of this.stackOrder) defs.push(toDefinition(id));
    if (this.catcherCardId) defs.push(toDefinition(this.catcherCardId));
    return defs;
  }

  private cardEl(id: string): HTMLElement {
    const card = this.cardsById.get(id)!;
    const template = templateFor(card.templateId);
    const el = document.createElement("div");
    el.className = `card card-${kindOf(card.templateId)}`;
    el.dataset.id = id;
    el.style.touchAction = "none";
    el.innerHTML = `
      <span class="card-label">${template.label}</span>
      <span class="card-height">${heightOf(card.templateId)}px</span>
    `;
    el.addEventListener("pointerdown", (e) => this.onPointerDown(e, id));
    return el;
  }

  private renderList(el: HTMLElement, order: string[], indicator: HTMLElement, emptyText: string) {
    el.innerHTML = "";
    el.appendChild(indicator);
    for (const id of order) el.appendChild(this.cardEl(id));
    if (order.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = emptyText;
      el.appendChild(empty);
    }
  }

  private renderSlot(el: HTMLElement, cardId: string | null, emptyText: string) {
    el.innerHTML = "";
    if (cardId) {
      el.appendChild(this.cardEl(cardId));
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = emptyText;
      el.appendChild(empty);
    }
  }

  render() {
    this.renderList(this.trayEl, this.trayOrder, this.trayIndicator, "All sections placed on the board.");
    this.renderList(this.stackEl, this.stackOrder, this.stackIndicator, "Drag playfield sections here.");
    this.renderSlot(this.launcherSlotEl, this.launcherCardId, "Drag a launcher here.");
    this.renderSlot(this.catcherSlotEl, this.catcherCardId, "Drag a catcher here.");

    const total = this.getTotalHeight();
    const pct = Math.min(100, (total / HEIGHT_BUDGET) * 100);
    this.meterFillEl.style.width = `${pct}%`;
    this.meterFillEl.classList.toggle("over-budget", total > HEIGHT_BUDGET);
    this.meterLabelEl.textContent = `${total} / ${HEIGHT_BUDGET}px`;

    const missing: string[] = [];
    if (!this.launcherCardId) missing.push("a launcher");
    if (this.stackOrder.length === 0) missing.push("a playfield section");
    if (!this.catcherCardId) missing.push("a catcher");

    this.startBtn.disabled = missing.length > 0;
    this.statusEl.textContent = missing.length > 0 ? `Your board needs ${missing.join(", ")} to start.` : "";
  }

  private zoneEl(zone: ZoneName): HTMLElement {
    switch (zone) {
      case "tray":
        return this.trayEl;
      case "stack":
        return this.stackEl;
      case "launcher":
        return this.launcherSlotEl;
      case "catcher":
        return this.catcherSlotEl;
    }
  }

  private zoneFor(cardId: string): ZoneName {
    if (this.launcherCardId === cardId) return "launcher";
    if (this.catcherCardId === cardId) return "catcher";
    if (this.stackOrder.includes(cardId)) return "stack";
    return "tray";
  }

  /** A card can only ever land in the tray, or the single zone matching its role. */
  private allowedZonesFor(cardId: string): ZoneName[] {
    const card = this.cardsById.get(cardId)!;
    const role = roleOfTemplate(card.templateId);
    if (role === "launcher") return ["tray", "launcher"];
    if (role === "catcher") return ["tray", "catcher"];
    return ["tray", "stack"];
  }

  // Nearest-valid-zone picking (by distance to each candidate zone's own
  // rect, 0 if the pointer is already inside it) instead of strict
  // containment -- a short/empty list's rect can be much smaller than it
  // looks, so requiring the pointer stay strictly inside it made dropping
  // "past the end" of a short stack miss every zone and silently revert to
  // the source. This always resolves to some allowed zone instead.
  private pickHoverZone(clientX: number, clientY: number, allowed: ZoneName[]): ZoneName {
    let best = allowed[0];
    let bestDist = Infinity;
    for (const zone of allowed) {
      const rect = this.zoneEl(zone).getBoundingClientRect();
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = zone;
      }
    }
    return best;
  }

  private onPointerDown(e: PointerEvent, id: string) {
    if (this.drag) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sourceZone = this.zoneFor(id);

    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("card-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);

    // Hide the source card in place (rather than removing it from the DOM)
    // so the element that received this pointerdown stays in the document
    // for the whole gesture -- removing it mid-drag fires a pointercancel.
    el.classList.add("card-dragging-source");

    const currentOrder = sourceZone === "tray" ? this.trayOrder : sourceZone === "stack" ? this.stackOrder : [id];
    this.drag = {
      cardId: id,
      sourceZone,
      ghost,
      grabDx: e.clientX - rect.left,
      grabDy: e.clientY - rect.top,
      hoverZone: sourceZone,
      hoverIndex: currentOrder.indexOf(id),
    };
  }

  private clearHoverIndicators() {
    this.trayIndicator.classList.add("hidden");
    this.stackIndicator.classList.add("hidden");
    this.launcherSlotEl.classList.remove("drop-target");
    this.catcherSlotEl.classList.remove("drop-target");
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${e.clientX - this.drag.grabDx}px`;
    this.drag.ghost.style.top = `${e.clientY - this.drag.grabDy}px`;

    const allowed = this.allowedZonesFor(this.drag.cardId);
    const hoverZone = this.pickHoverZone(e.clientX, e.clientY, allowed);
    this.drag.hoverZone = hoverZone;

    this.clearHoverIndicators();

    if (hoverZone === "tray" || hoverZone === "stack") {
      const order = hoverZone === "tray" ? this.trayOrder : this.stackOrder;
      const listEl = this.zoneEl(hoverZone);
      const children = Array.from(
        listEl.querySelectorAll<HTMLElement>(".card:not(.card-dragging-source)")
      );

      let index = order.length;
      for (let i = 0; i < children.length; i++) {
        const childRect = children[i].getBoundingClientRect();
        const midY = childRect.top + childRect.height / 2;
        if (e.clientY < midY) {
          index = i;
          break;
        }
      }
      this.drag.hoverIndex = index;

      const indicator = hoverZone === "tray" ? this.trayIndicator : this.stackIndicator;
      indicator.classList.remove("hidden");
      const listRect = listEl.getBoundingClientRect();
      if (children.length === 0) {
        indicator.style.top = "4px";
      } else if (index >= children.length) {
        const last = children[children.length - 1].getBoundingClientRect();
        indicator.style.top = `${last.bottom - listRect.top + listEl.scrollTop + 4}px`;
      } else {
        const target = children[index].getBoundingClientRect();
        indicator.style.top = `${target.top - listRect.top + listEl.scrollTop - 2}px`;
      }
    } else {
      this.drag.hoverIndex = 0;
      this.zoneEl(hoverZone).classList.add("drop-target");
    }
  }

  private onPointerUp(_e: PointerEvent) {
    if (!this.drag) return;
    const { cardId, hoverZone, hoverIndex } = this.drag;

    this.trayOrder = this.trayOrder.filter((id) => id !== cardId);
    this.stackOrder = this.stackOrder.filter((id) => id !== cardId);
    if (this.launcherCardId === cardId) this.launcherCardId = null;
    if (this.catcherCardId === cardId) this.catcherCardId = null;

    if (hoverZone === "tray") {
      const idx = Math.max(0, Math.min(hoverIndex, this.trayOrder.length));
      this.trayOrder.splice(idx, 0, cardId);
    } else if (hoverZone === "stack") {
      const idx = Math.max(0, Math.min(hoverIndex, this.stackOrder.length));
      this.stackOrder.splice(idx, 0, cardId);
    } else if (hoverZone === "launcher") {
      if (this.launcherCardId && this.launcherCardId !== cardId) this.trayOrder.push(this.launcherCardId);
      this.launcherCardId = cardId;
    } else {
      if (this.catcherCardId && this.catcherCardId !== cardId) this.trayOrder.push(this.catcherCardId);
      this.catcherCardId = cardId;
    }

    this.cleanupDrag();
    this.render();
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.cleanupDrag();
    this.render();
  }

  private cleanupDrag() {
    if (!this.drag) return;
    this.drag.ghost.remove();
    this.clearHoverIndicators();
    this.drag = null;
  }
}
