// Web Audio SFX for space-dodge. Lazy AudioContext, started on first
// interaction. Three sounds: a quiet engine hum (looped triangle), a crash
// burst (white-noise envelope), and a descending game-over tone.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let engineNodes: { osc: OscillatorNode; gain: GainNode } | null = null;

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
  master.gain.value = 0.4;
  master.connect(ctx.destination);
}

export function startEngine(): void {
  if (!ctx || !master || engineNodes) return;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 90;
  const gain = ctx.createGain();
  gain.gain.value = 0.04;
  osc.connect(gain).connect(master);
  osc.start();
  engineNodes = { osc, gain };
}

export function stopEngine(): void {
  if (!ctx || !engineNodes) return;
  const { osc, gain } = engineNodes;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.15);
  osc.stop(now + 0.18);
  engineNodes = null;
}

export function playCrash(): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  const dur = 0.35;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.6, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  src.connect(filter).connect(gain).connect(master);
  src.start(now);
  src.stop(now + dur);
}

export function playGameOver(): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.9);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + 1.05);
}
