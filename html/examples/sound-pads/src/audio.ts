// Tiny Web Audio synth. One shared AudioContext + master gain; per-tap we spin
// up a fresh oscillator + ADSR-shaped gain, then disconnect on `onended`.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

const ATTACK = 0.005;   // 5ms
const DECAY = 0.08;     // 80ms
const SUSTAIN = 0.4;    // ratio of peak
const RELEASE = 0.25;   // 250ms
const HOLD = 0.18;      // sustain plateau before release
const PEAK = 0.6;

/** Lazy-init. Safe to call repeatedly; safe to call from a user gesture. */
export function init(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  // Headroom — many simultaneous notes shouldn't clip.
  master.gain.value = 0.4;
  master.connect(ctx.destination);
}

export function playNote(frequency: number): void {
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  // Triangle is warmer than sine and softer than square — pleasant for chords.
  osc.type = "triangle";
  osc.frequency.value = frequency;

  const gain = ctx.createGain();
  const sustainLevel = PEAK * SUSTAIN;
  const decayEnd = now + ATTACK + DECAY;
  const releaseStart = decayEnd + HOLD;
  const releaseEnd = releaseStart + RELEASE;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PEAK, now + ATTACK);
  gain.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
  gain.gain.setValueAtTime(sustainLevel, releaseStart);
  gain.gain.linearRampToValueAtTime(0.0001, releaseEnd);

  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(releaseEnd + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
