import { templateFor, type SectionCard } from "./collection";
import type { SectionDefinition } from "./game/types";

export const HEIGHT_BUDGET = 480;

interface DragState {
  cardId: string;
  sourceList: "tray" | "stack";
  ghost: HTMLElement;
  grabDx: number;
  grabDy: number;
  hoverList: "tray" | "stack" | null;
  hoverIndex: number;
}

function heightOf(templateId: string): number {
  const config = templateFor(templateId).config;
  return config.kind === "multiplier" ? config.height ?? 16 : config.height;
}

function kindOf(templateId: string): string {
  return templateFor(templateId).config.kind;
}

export class BoardBuilder {
  private trayEl: HTMLElement;
  private stackEl: HTMLElement;
  private meterFillEl: HTMLElement;
  private meterLabelEl: HTMLElement;
  private startBtn: HTMLButtonElement;

  private trayOrder: string[] = [];
  private stackOrder: string[] = [];
  private cardsById = new Map<string, SectionCard>();

  private drag: DragState | null = null;
  private trayIndicator: HTMLElement;
  private stackIndicator: HTMLElement;

  constructor(
    trayEl: HTMLElement,
    stackEl: HTMLElement,
    meterFillEl: HTMLElement,
    meterLabelEl: HTMLElement,
    startBtn: HTMLButtonElement
  ) {
    this.trayEl = trayEl;
    this.stackEl = stackEl;
    this.meterFillEl = meterFillEl;
    this.meterLabelEl = meterLabelEl;
    this.startBtn = startBtn;

    this.trayIndicator = document.createElement("div");
    this.trayIndicator.className = "insertion-indicator hidden";
    this.stackIndicator = document.createElement("div");
    this.stackIndicator.className = "insertion-indicator hidden";

    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", () => this.cancelDrag());
  }

  setCollection(cards: SectionCard[]) {
    this.cardsById = new Map(cards.map((c) => [c.id, c]));
    this.trayOrder = cards.map((c) => c.id);
    this.stackOrder = [];
    this.render();
  }

  addCard(card: SectionCard) {
    this.cardsById.set(card.id, card);
    this.trayOrder.push(card.id);
    this.render();
  }

  getStackHeight(): number {
    return this.stackOrder.reduce((sum, id) => {
      const card = this.cardsById.get(id)!;
      return sum + heightOf(card.templateId);
    }, 0);
  }

  buildSectionDefinitions(): SectionDefinition[] {
    return this.stackOrder.map((id) => {
      const card = this.cardsById.get(id)!;
      const template = templateFor(card.templateId);
      return { id: card.id, label: template.label, config: template.config };
    });
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

  render() {
    this.trayEl.innerHTML = "";
    this.trayEl.appendChild(this.trayIndicator);
    for (const id of this.trayOrder) {
      this.trayEl.appendChild(this.cardEl(id));
    }
    if (this.trayOrder.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "All sections placed on the board.";
      this.trayEl.appendChild(empty);
    }

    this.stackEl.innerHTML = "";
    this.stackEl.appendChild(this.stackIndicator);
    for (const id of this.stackOrder) {
      this.stackEl.appendChild(this.cardEl(id));
    }
    if (this.stackOrder.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "Drag sections here to build your board (top to bottom).";
      this.stackEl.appendChild(empty);
    }

    const total = this.getStackHeight();
    const pct = Math.min(100, (total / HEIGHT_BUDGET) * 100);
    this.meterFillEl.style.width = `${pct}%`;
    this.meterFillEl.classList.toggle("over-budget", total > HEIGHT_BUDGET);
    this.meterLabelEl.textContent = `${total} / ${HEIGHT_BUDGET}px`;
    this.startBtn.disabled = this.stackOrder.length === 0;
  }

  private onPointerDown(e: PointerEvent, id: string) {
    if (this.drag) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sourceList: "tray" | "stack" = this.trayOrder.includes(id) ? "tray" : "stack";

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

    this.drag = {
      cardId: id,
      sourceList,
      ghost,
      grabDx: e.clientX - rect.left,
      grabDy: e.clientY - rect.top,
      hoverList: sourceList,
      hoverIndex: (sourceList === "tray" ? this.trayOrder : this.stackOrder).indexOf(id),
    };
  }

  private listElFor(list: "tray" | "stack"): HTMLElement {
    return list === "tray" ? this.trayEl : this.stackEl;
  }

  private indicatorFor(list: "tray" | "stack"): HTMLElement {
    return list === "tray" ? this.trayIndicator : this.stackIndicator;
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${e.clientX - this.drag.grabDx}px`;
    this.drag.ghost.style.top = `${e.clientY - this.drag.grabDy}px`;

    const trayRect = this.trayEl.getBoundingClientRect();
    const stackRect = this.stackEl.getBoundingClientRect();
    const inTray = pointInRect(e.clientX, e.clientY, trayRect);
    const inStack = pointInRect(e.clientX, e.clientY, stackRect);

    this.trayIndicator.classList.add("hidden");
    this.stackIndicator.classList.add("hidden");

    let hoverList: "tray" | "stack" | null = null;
    if (inStack) hoverList = "stack";
    else if (inTray) hoverList = "tray";

    if (!hoverList) {
      this.drag.hoverList = null;
      return;
    }

    const listEl = this.listElFor(hoverList);
    const children = Array.from(
      listEl.querySelectorAll<HTMLElement>(".card:not(.card-dragging-source)")
    );

    let index = children.length;
    for (let i = 0; i < children.length; i++) {
      const childRect = children[i].getBoundingClientRect();
      const midY = childRect.top + childRect.height / 2;
      if (e.clientY < midY) {
        index = i;
        break;
      }
    }

    this.drag.hoverList = hoverList;
    this.drag.hoverIndex = index;

    const indicator = this.indicatorFor(hoverList);
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
  }

  private onPointerUp(_e: PointerEvent) {
    if (!this.drag) return;
    const { cardId, sourceList, hoverList, hoverIndex } = this.drag;

    const targetList = hoverList ?? sourceList;
    this.trayOrder = this.trayOrder.filter((id) => id !== cardId);
    this.stackOrder = this.stackOrder.filter((id) => id !== cardId);

    const targetArr = targetList === "tray" ? this.trayOrder : this.stackOrder;
    const clampedIndex = Math.max(0, Math.min(hoverIndex, targetArr.length));
    targetArr.splice(clampedIndex, 0, cardId);

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
    this.trayIndicator.classList.add("hidden");
    this.stackIndicator.classList.add("hidden");
    this.drag = null;
  }
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
