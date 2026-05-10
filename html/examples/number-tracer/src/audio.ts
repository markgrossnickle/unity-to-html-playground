// Tiny Web Audio module. AudioContext is lazy-created on first interaction
// because most browsers refuse to start audio without a user gesture.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain: number): void {
  const c = getCtx();
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Short cheerful two-note "ding" on stroke completion. */
export function playDing(): void {
  tone(880, 0, 0.18, 0.18); // A5
  tone(1318, 0.07, 0.22, 0.16); // E6
}

/** Triumphant rising "ta-da" on whole-number completion. */
export function playTaDa(): void {
  tone(523, 0, 0.16, 0.18); // C5
  tone(659, 0.12, 0.16, 0.18); // E5
  tone(784, 0.24, 0.45, 0.22); // G5
}
