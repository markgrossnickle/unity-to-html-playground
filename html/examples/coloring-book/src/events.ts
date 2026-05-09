// Tiny typed event bus. The DOM controllers (palette, picker, toolbar) don't
// know about Phaser; the scene listens for these events and reacts. This is
// cleaner than wiring shared module-level callbacks and avoids a global state
// library for what is essentially "two surfaces talk to each other".

export interface EventMap {
  "picture:select": string; // slug
  "color:select": string; // hex
  undo: void;
  clear: void;
  "recent:update": void;
}

type Listener<E extends keyof EventMap> = (payload: EventMap[E]) => void;

class EventBus {
  // Storage is loose internally; the on/emit signatures keep the public API
  // type-safe per event name without tripping TS variance issues.
  private readonly listeners = new Map<keyof EventMap, Set<(payload: unknown) => void>>();

  on<E extends keyof EventMap>(event: E, fn: Listener<E>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (payload: unknown) => void);
  }

  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

export const events = new EventBus();
