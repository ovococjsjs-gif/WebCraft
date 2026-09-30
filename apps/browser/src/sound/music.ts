/**
 * Generative background music in the spirit of the reference soundtrack: an unhurried soft
 * piano over a warm pad, a new piece every few minutes and long silences in between. Every piece
 * is composed on the spot from a mode, a slow chord progression and a sparse melody, so a world
 * never plays the same tune twice. Notes are scheduled a couple of seconds ahead only.
 */

type Mood = 'overworld' | 'night' | 'nether' | 'end' | 'water';

const MODES: Record<Mood, readonly number[][]> = {
  // Scale degrees in semitones; each mood picks one of its modes.
  overworld: [
    [0, 2, 4, 7, 9, 11], // major, no fourth: bright and open
    [0, 2, 4, 6, 7, 9, 11], // lydian: floating
    [0, 2, 4, 5, 7, 9], // major hexatonic
  ],
  night: [
    [0, 2, 3, 5, 7, 10], // dorian flavour
    [0, 3, 5, 7, 10], // minor pentatonic
  ],
  nether: [
    [0, 1, 3, 5, 7, 8], // phrygian: uneasy
    [0, 2, 3, 6, 7, 8, 11], // harmonic-minor-ish
  ],
  end: [[0, 2, 3, 7, 8]],
  water: [[0, 2, 4, 7, 9]],
};
/** Chord roots as scale steps, four chords a piece. */
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 5, 4],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
  [0, 2, 3, 0],
];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

export class MusicDirector {
  private ctx: AudioContext;
  private out: GainNode;
  private piece: {
    start: number;
    end: number;
    beat: number;
    root: number;
    scale: readonly number[];
    progression: readonly number[];
    scheduledTo: number;
    lastMelody: number;
  } | null = null;
  /** When the next piece may begin (AudioContext time). */
  private nextAt: number;
  private mood: Mood = 'overworld';
  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(out);
    // The first piece waits a little: arriving in a world should be quiet.
    this.nextAt = ctx.currentTime + rand(25, 60);
  }
  get playing() {
    return !!this.piece;
  }
  /** Skip the wait, for the debug API and tests. */
  startSoon() {
    this.nextAt = this.ctx.currentTime + 0.2;
  }
  stop() {
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0.0001, now, 0.8);
    this.piece = null;
    this.nextAt = now + rand(60, 140);
    // The gain comes back once the tail has faded.
    this.out.gain.setTargetAtTime(1, now + 4, 0.1);
  }
  /** Called a few times a second with what the player is doing. */
  update(mood: Mood, enabled: boolean) {
    const now = this.ctx.currentTime;
    if (!enabled) {
      if (this.piece) this.stop();
      return;
    }
    if (!this.piece && now >= this.nextAt) this.begin(mood, now);
    const piece = this.piece;
    if (!piece) return;
    if (now > piece.end) {
      this.piece = null;
      // Several minutes of silence between pieces, as in the reference.
      this.nextAt = now + rand(150, 330);
      return;
    }
    while (piece.scheduledTo < Math.min(piece.end - 3, now + 2.5)) this.scheduleBar(piece);
  }
  private begin(mood: Mood, now: number) {
    this.mood = mood;
    const scale = pick(MODES[mood]);
    const bpm = mood === 'nether' ? rand(52, 62) : rand(60, 76);
    const beat = 60 / bpm;
    const bars = mood === 'end' ? 16 : pick([16, 20, 24]);
    const root = (mood === 'nether' ? 45 : mood === 'end' ? 50 : 48) + Math.floor(rand(0, 7));
    this.piece = {
      start: now + 0.3,
      end: now + 0.3 + bars * 4 * beat + 6,
      beat,
      root,
      scale,
      progression: pick(PROGRESSIONS),
      scheduledTo: now + 0.3,
      lastMelody: 2,
    };
  }
  private note(step: number, octave: number, piece: NonNullable<MusicDirector['piece']>) {
    const n = piece.scale.length;
    const wrapped = ((step % n) + n) % n;
    const lift = Math.floor(step / n);
    return piece.root + piece.scale[wrapped]! + 12 * (octave + lift);
  }
  private scheduleBar(piece: NonNullable<MusicDirector['piece']>) {
    const t = piece.scheduledTo;
    const barIndex = Math.round((t - piece.start) / (piece.beat * 4));
    const chord = piece.progression[Math.floor(barIndex / 2) % piece.progression.length]!;
    const lastBars = (piece.end - 6 - t) / (piece.beat * 4) < 1.01;
    // The pad holds the chord for the whole bar.
    if (barIndex % 2 === 0 && this.mood !== 'end')
      for (const s of [0, 2, 4])
        // Pads overlap the next chord a little, so the harmony never drops out between them.
        this.pad(midi(this.note(chord + s, 0, piece)), t, piece.beat * 9.5);
    // Left hand: root on the first beat, sometimes a fifth after.
    this.piano(midi(this.note(chord, -1, piece)), t, 0.32, 3.5);
    if (Math.random() < 0.5)
      this.piano(midi(this.note(chord + 4, -1, piece)), t + piece.beat * 2, 0.2, 2.5);
    // Right hand: a sparse melody walking near the last note, resting often.
    for (let b = 0; b < 8; b++) {
      const at = t + b * piece.beat * 0.5;
      const density = this.mood === 'end' ? 0.16 : barIndex < 2 ? 0.25 : 0.45;
      if (lastBars && b > 0) break;
      if (Math.random() > density && !(b === 0 && lastBars)) continue;
      const move = pick([-2, -1, -1, 0, 1, 1, 2, 3, -3]);
      piece.lastMelody = Math.max(-1, Math.min(9, piece.lastMelody + move));
      const onChord = b % 4 === 0;
      const step = onChord ? chord + pick([0, 2, 4]) : piece.lastMelody + chord;
      this.piano(
        midi(this.note(step, 1, piece)),
        at + rand(0, 0.03),
        rand(0.14, 0.26),
        rand(2.2, 3.4),
      );
    }
    piece.scheduledTo = t + piece.beat * 4;
  }
  /** A soft electric-piano tone: a few decaying partials with a gentle chorus. */
  private piano(f: number, t: number, velocity: number, decay: number) {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(velocity, t + 0.008);
    env.gain.exponentialRampToValueAtTime(velocity * 0.35, t + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(6000, f * 6), t);
    filter.frequency.exponentialRampToValueAtTime(Math.min(3000, f * 2.2), t + decay * 0.6);
    filter.connect(env);
    env.connect(this.out);
    const oscillators: OscillatorNode[] = [];
    const partials: [number, number, number][] = [
      [1, 1, 0],
      [1, 0.5, 6],
      [2, 0.28, -4],
      [3, 0.09, 3],
    ];
    const mix = ctx.createGain();
    mix.gain.value = 0.45;
    mix.connect(filter);
    for (const [ratio, gain, detune] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * ratio;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(mix);
      osc.start(t);
      osc.stop(t + decay + 0.05);
      oscillators.push(osc);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    }
    oscillators[0]!.addEventListener('ended', () => {
      mix.disconnect();
      filter.disconnect();
      env.disconnect();
    });
  }
  /** A warm pad: two detuned saws, softly filtered, swelling in and out. */
  private pad(f: number, t: number, length: number) {
    const ctx = this.ctx;
    const env = ctx.createGain();
    const peak = this.mood === 'nether' ? 0.04 : 0.028;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + length * 0.3);
    env.gain.setValueAtTime(peak, t + length * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.mood === 'nether' ? 500 : 900;
    filter.Q.value = 0.7;
    filter.connect(env);
    env.connect(this.out);
    const oscs = [-7, 7].map((detune) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.05);
      return osc;
    });
    oscs[0]!.onended = () => {
      for (const osc of oscs) osc.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }
}
