/**
 * Procedural sound palette of WebCraft. Every sound is built from a handful of WebAudio nodes at
 * the moment it plays: filtered noise grains for footsteps and digging, resonant knocks for wood
 * and stone, inharmonic partials for glass and metal, and a small formant voice for creatures.
 * No samples are shipped, so the standalone release stays a single offline HTML file.
 */
import { registry, type BlockDefinition } from '@content/blocks';

export type Material =
  | 'grass'
  | 'dirt'
  | 'gravel'
  | 'sand'
  | 'snow'
  | 'stone'
  | 'wood'
  | 'glass'
  | 'metal'
  | 'cloth'
  | 'leaves'
  | 'plant'
  | 'water';

const materialCache = new Map<number, Material>();
/** What a block sounds like when it is walked on, dug, broken or placed. */
export function materialOf(state: number): Material {
  const cached = materialCache.get(state);
  if (cached) return cached;
  let def: BlockDefinition | undefined;
  try {
    def = registry.get(state);
  } catch {
    def = undefined;
  }
  const material = def ? classify(def) : 'stone';
  materialCache.set(state, material);
  return material;
}
function classify(def: BlockDefinition): Material {
  const key = def.key;
  if (def.fluid) return 'water';
  if (/glass|ice|glowstone|end_portal_frame|sea_lantern|beacon/.test(key)) return 'glass';
  if (/wool|bed|carpet|cactus|sponge|cake/.test(key)) return 'cloth';
  if (/leaves/.test(key)) return 'leaves';
  if (/iron_block|gold_block|anvil|hopper|rail|cauldron|brewing_stand/.test(key)) return 'metal';
  if (/snow/.test(key)) return 'snow';
  if (/gravel|clay|soul_sand|farmland/.test(key)) return 'gravel';
  if (/sand/.test(key) && !/sandstone/.test(key)) return 'sand';
  if (/grass|podzol|mycelium|hay/.test(key) && !def.shape) return 'grass';
  if (/dirt|coarse/.test(key)) return 'dirt';
  if (
    def.shape === 'cross' ||
    /sapling|flower|tulip|orchid|allium|poppy|dandelion|daisy|fern|bush|wart|reed|cane|lily/.test(
      key,
    )
  )
    return 'plant';
  if (
    def.tool === 'axe' ||
    /log|planks|wood|door|fence|chest|table|bookshelf|ladder|sign|pumpkin|melon|mushroom_(stem|block)|torch/.test(
      key,
    )
  )
    return 'wood';
  if (def.tool === 'shovel') return 'dirt';
  return 'stone';
}

export type Action = 'step' | 'dig' | 'break' | 'place' | 'land';

/** Formants (Hz) of the vowels the creature voices glide between. */
const VOWELS = {
  u: [320, 800, 2240],
  o: [470, 820, 2600],
  a: [720, 1100, 2450],
  e: [520, 1800, 2500],
  i: [300, 2200, 2950],
  m: [260, 600, 2000],
} as const;
type Vowel = keyof typeof VOWELS;

export interface VoiceOptions {
  /** Pitch contour: [time 0..1, frequency] points. */
  pitch: readonly (readonly [number, number])[];
  vowels: readonly Vowel[];
  duration: number;
  gain?: number;
  wave?: OscillatorType;
  vibrato?: number;
  vibratoDepth?: number;
  /** Amplitude tremolo, as the bleat of a sheep. */
  tremolo?: number;
  tremoloDepth?: number;
  /** Breath noise mixed into the voice. */
  breath?: number;
  /** Harsh edge through a waveshaper, for the undead. */
  rough?: number;
  attack?: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Synth {
  readonly ctx: AudioContext;
  private noise: AudioBuffer;
  private shaper: Float32Array<ArrayBuffer>;
  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    // White noise, one second: grains start at random offsets so they never sound alike.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.shaper = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      this.shaper[i] = Math.tanh(x * 3.2) * 0.8;
    }
  }
  /** A gain envelope: fast attack, exponential decay to silence. */
  private envelope(out: AudioNode, t: number, peak: number, attack: number, duration: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.005, duration));
    g.connect(out);
    return g;
  }
  private cleanup(source: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
    source.onended = () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }
  /** One burst of filtered noise. */
  noiseBurst(
    out: AudioNode,
    t: number,
    duration: number,
    options: {
      type?: BiquadFilterType;
      freq: number;
      q?: number;
      gain: number;
      attack?: number;
      sweepTo?: number;
      rate?: number;
    },
  ) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = options.rate ?? 1;
    const filter = this.ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(options.freq, t);
    if (options.sweepTo)
      filter.frequency.exponentialRampToValueAtTime(options.sweepTo, t + duration);
    filter.Q.value = options.q ?? 1;
    const env = this.envelope(out, t, options.gain, options.attack ?? 0.003, duration);
    source.connect(filter);
    filter.connect(env);
    this.cleanup(source, filter, env);
    source.start(t, Math.random() * 0.7);
    source.stop(t + duration + 0.02);
  }
  /** One pitched tone with an optional glide. */
  tone(
    out: AudioNode,
    t: number,
    duration: number,
    options: {
      wave?: OscillatorType;
      f0: number;
      f1?: number;
      gain: number;
      attack?: number;
      detune?: number;
    },
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = options.wave ?? 'sine';
    osc.frequency.setValueAtTime(options.f0, t);
    if (options.f1) osc.frequency.exponentialRampToValueAtTime(options.f1, t + duration);
    if (options.detune) osc.detune.value = options.detune;
    const env = this.envelope(out, t, options.gain, options.attack ?? 0.004, duration);
    osc.connect(env);
    this.cleanup(osc, env);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
  /** Several short grains scattered over `span`: crunching gravel, rustling grass. */
  grains(
    out: AudioNode,
    t: number,
    count: number,
    span: number,
    freq: [number, number],
    q: number,
    gain: number,
    grain = 0.03,
  ) {
    for (let i = 0; i < count; i++)
      this.noiseBurst(out, t + Math.random() * span, grain * rand(0.6, 1.4), {
        freq: rand(freq[0], freq[1]),
        q,
        gain: gain * rand(0.45, 1),
      });
  }
  /** Inharmonic ringing partials: glass shards and struck metal. */
  partials(
    out: AudioNode,
    t: number,
    base: number,
    ratios: readonly number[],
    decay: number,
    gain: number,
  ) {
    ratios.forEach((ratio, i) =>
      this.tone(out, t + Math.random() * 0.004, (decay * rand(0.6, 1.1)) / (1 + i * 0.35), {
        f0: base * ratio * rand(0.985, 1.015),
        gain: gain / (1 + i * 0.6),
        attack: 0.002,
      }),
    );
  }

  /** Footsteps, digging, breaking, placing and landing for every material. */
  material(out: AudioNode, t: number, material: Material, action: Action, strength = 1) {
    const loud = { step: 0.3, dig: 0.4, break: 0.9, place: 0.7, land: 0.8 }[action] * strength;
    const long = { step: 1, dig: 0.8, break: 1.7, place: 1.1, land: 1.3 }[action];
    const low = action === 'place' ? 0.82 : action === 'break' ? 0.92 : 1;
    const p = rand(0.9, 1.1) * low;
    switch (material) {
      case 'grass':
      case 'leaves':
      case 'plant': {
        const hi = material === 'grass' ? [2200, 4200] : [3200, 6500];
        this.grains(
          out,
          t,
          Math.round(4 * long + 2),
          0.07 * long,
          [hi[0] * p, hi[1] * p],
          1.2,
          loud * 0.9,
          0.035,
        );
        if (material === 'grass')
          this.noiseBurst(out, t, 0.06 * long, {
            type: 'lowpass',
            freq: 520 * p,
            gain: loud * 0.7,
          });
        break;
      }
      case 'dirt':
        this.grains(
          out,
          t,
          Math.round(3 * long + 2),
          0.06 * long,
          [700 * p, 1600 * p],
          1.4,
          loud * 0.9,
          0.04,
        );
        this.noiseBurst(out, t, 0.07 * long, { type: 'lowpass', freq: 380 * p, gain: loud });
        break;
      case 'gravel':
        this.grains(
          out,
          t,
          Math.round(7 * long + 3),
          0.11 * long,
          [1300 * p, 3300 * p],
          2.2,
          loud,
          0.025,
        );
        this.noiseBurst(out, t, 0.08 * long, { type: 'lowpass', freq: 450 * p, gain: loud * 0.6 });
        break;
      case 'sand':
        this.noiseBurst(out, t, 0.13 * long, {
          type: 'lowpass',
          freq: 1700 * p,
          gain: loud * 0.8,
          attack: 0.02,
        });
        this.grains(
          out,
          t + 0.01,
          Math.round(3 * long),
          0.1 * long,
          [2500 * p, 5000 * p],
          0.8,
          loud * 0.35,
        );
        break;
      case 'snow':
        this.noiseBurst(out, t, 0.14 * long, {
          freq: 1150 * p,
          q: 2.5,
          gain: loud * 1.1,
          attack: 0.025,
        });
        this.tone(out, t + 0.02, 0.09 * long, {
          wave: 'triangle',
          f0: 900 * p,
          f1: 640 * p,
          gain: loud * 0.08,
        });
        break;
      case 'cloth':
        this.noiseBurst(out, t, 0.1 * long, {
          type: 'lowpass',
          freq: 700 * p,
          gain: loud,
          attack: 0.015,
        });
        break;
      case 'wood': {
        const f = rand(330, 470) * p;
        this.noiseBurst(out, t, 0.012, { type: 'highpass', freq: 2500, gain: loud * 0.7 });
        this.noiseBurst(out, t, 0.11 * long, { freq: f * 1.6, q: 9, gain: loud * 1.3 });
        this.tone(out, t, 0.09 * long, {
          wave: 'triangle',
          f0: f * 0.55,
          f1: f * 0.45,
          gain: loud * 0.55,
        });
        if (action === 'break')
          this.grains(out, t + 0.03, 5, 0.12, [900, 2200], 3, loud * 0.5, 0.03);
        break;
      }
      case 'stone': {
        const f = rand(700, 1100) * p;
        this.noiseBurst(out, t, 0.01, { type: 'highpass', freq: 3200, gain: loud * 0.8 });
        this.noiseBurst(out, t, 0.05 * long, { freq: f, q: 6, gain: loud * 1.2 });
        this.tone(out, t, 0.045 * long, { f0: 140 * p, f1: 90 * p, gain: loud * 0.6 });
        if (action === 'break' || action === 'land')
          this.grains(out, t + 0.02, 6, 0.14, [1200, 3200], 2.5, loud * 0.55, 0.025);
        break;
      }
      case 'glass':
        if (action === 'break') {
          this.noiseBurst(out, t, 0.18, { type: 'highpass', freq: 3500, gain: loud * 0.8 });
          for (let i = 0; i < 12; i++)
            this.tone(out, t + Math.random() * 0.25, rand(0.05, 0.16), {
              f0: rand(2200, 7200),
              gain: loud * rand(0.08, 0.2),
              attack: 0.001,
            });
        } else {
          this.noiseBurst(out, t, 0.01, { type: 'highpass', freq: 4000, gain: loud * 0.6 });
          this.noiseBurst(out, t, 0.05 * long, { freq: 2100 * p, q: 10, gain: loud * 0.9 });
        }
        break;
      case 'metal':
        this.noiseBurst(out, t, 0.012, { type: 'highpass', freq: 3000, gain: loud * 0.7 });
        this.partials(
          out,
          t,
          520 * p,
          [1, 2.76, 5.4, 8.93],
          (action === 'step' ? 0.12 : 0.45) * long,
          loud * 0.35,
        );
        break;
      case 'water':
        this.splash(out, t, strength * (action === 'step' ? 0.4 : 0.8));
        break;
    }
  }
  /** A body entering water, or a swimming stroke when `strength` is small. */
  splash(out: AudioNode, t: number, strength = 1) {
    const g = Math.min(1.4, 0.35 + strength * 0.35);
    this.noiseBurst(out, t, 0.28 + strength * 0.1, {
      freq: 500,
      sweepTo: 1400,
      q: 0.8,
      gain: g,
      attack: 0.02,
    });
    this.noiseBurst(out, t + 0.05, 0.35, {
      type: 'lowpass',
      freq: 900,
      sweepTo: 300,
      gain: g * 0.6,
    });
    this.bubbles(out, t + 0.08, Math.round(3 + strength * 3), g * 0.3);
  }
  bubbles(out: AudioNode, t: number, count: number, gain: number) {
    for (let i = 0; i < count; i++) {
      const f = rand(500, 1300);
      this.tone(out, t + Math.random() * 0.35, rand(0.03, 0.06), {
        f0: f,
        f1: f * 1.8,
        gain: gain * rand(0.5, 1),
      });
    }
  }

  /** A little formant voice: a buzzing source through three vowel filters. */
  voice(out: AudioNode, t: number, o: VoiceOptions) {
    const ctx = this.ctx;
    const d = o.duration;
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sawtooth';
    const first = o.pitch[0]![1];
    osc.frequency.setValueAtTime(first, t);
    for (const [at, f] of o.pitch.slice(1)) osc.frequency.linearRampToValueAtTime(f, t + at * d);
    const nodes: AudioNode[] = [];
    let lfo: OscillatorNode | null = null;
    if (o.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibrato;
      const depth = ctx.createGain();
      depth.gain.value = first * (o.vibratoDepth ?? 0.03);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      nodes.push(depth);
    }
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(o.gain ?? 0.5, t + (o.attack ?? 0.04));
    amp.gain.setValueAtTime(o.gain ?? 0.5, t + d * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + d);
    amp.connect(out);
    let trem: OscillatorNode | null = null;
    let input: AudioNode = amp;
    if (o.tremolo) {
      const tremGain = ctx.createGain();
      tremGain.gain.value = 1 - (o.tremoloDepth ?? 0.6) / 2;
      trem = ctx.createOscillator();
      trem.frequency.value = o.tremolo;
      const tremDepth = ctx.createGain();
      tremDepth.gain.value = (o.tremoloDepth ?? 0.6) / 2;
      trem.connect(tremDepth);
      tremDepth.connect(tremGain.gain);
      tremGain.connect(amp);
      input = tremGain;
      nodes.push(tremGain, tremDepth);
    }
    let source: AudioNode = osc;
    if (o.rough) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.shaper;
      const pre = ctx.createGain();
      pre.gain.value = 1 + o.rough * 3;
      osc.connect(pre);
      pre.connect(shaper);
      source = shaper;
      nodes.push(pre, shaper);
    }
    const formantGains = [1, 0.55, 0.22];
    for (let f = 0; f < 3; f++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = f === 0 ? 5 : 8;
      const steps = o.vowels;
      filter.frequency.setValueAtTime(VOWELS[steps[0]!][f]!, t);
      steps.forEach((v, i) => {
        if (i > 0)
          filter.frequency.linearRampToValueAtTime(VOWELS[v][f]!, t + (i / (steps.length - 1)) * d);
      });
      const g = ctx.createGain();
      g.gain.value = formantGains[f]! * 2.2;
      source.connect(filter);
      filter.connect(g);
      g.connect(input);
      nodes.push(filter, g);
    }
    if (o.breath)
      this.noiseBurst(input, t, d, {
        freq: VOWELS[o.vowels[0]!][1]!,
        q: 1.2,
        gain: o.breath,
        attack: d * 0.3,
      });
    osc.onended = () => {
      osc.disconnect();
      lfo?.disconnect();
      trem?.disconnect();
      amp.disconnect();
      for (const node of nodes) node.disconnect();
    };
    osc.start(t);
    osc.stop(t + d + 0.03);
    lfo?.start(t);
    lfo?.stop(t + d + 0.03);
    trem?.start(t);
    trem?.stop(t + d + 0.03);
  }

  /**
   * Creature sounds. `mood` is what happened: an idle call, a hit or the last breath. Pitch is
   * shifted a little each time, as the reference does, so a herd never sounds like a loop.
   */
  creature(out: AudioNode, t: number, kind: string, mood: 'say' | 'hurt' | 'death', baby = false) {
    const k = kind.replace(/^lab:/, '');
    const shift =
      rand(0.92, 1.08) * (baby ? 1.45 : 1) * (mood === 'hurt' ? 1.2 : mood === 'death' ? 0.85 : 1);
    const len = mood === 'hurt' ? 0.45 : mood === 'death' ? 1.35 : 1;
    const P = (points: [number, number][]) => points.map(([a, f]) => [a, f * shift] as const);
    switch (k) {
      case 'villager':
        // The villager's nasal "hmm": a closed-mouth hum that rises, or falls when it refuses.
        this.voice(out, t, {
          pitch: P(
            mood === 'hurt'
              ? [
                  [0, 230],
                  [0.5, 190],
                  [1, 150],
                ]
              : [
                  [0, 170],
                  [0.45, 205],
                  [1, 185],
                ],
          ),
          vowels: ['m', 'm', 'u', 'm'],
          duration: 0.55 * (mood === 'death' ? 1.8 : 1),
          gain: 0.5,
          vibrato: 6,
          vibratoDepth: 0.03,
          breath: 0.06,
          attack: 0.04,
        });
        break;
      case 'cow':
        this.voice(out, t, {
          pitch: P([
            [0, 118],
            [0.3, 132],
            [0.8, 112],
            [1, 96],
          ]),
          vowels: ['m', 'u', 'o', 'u'],
          duration: 1.05 * len,
          gain: 0.55,
          vibrato: 5.5,
          vibratoDepth: 0.02,
          breath: 0.05,
          attack: 0.12 * len,
        });
        break;
      case 'pig': {
        const grunts = mood === 'say' ? 2 : 1;
        for (let i = 0; i < grunts; i++)
          this.voice(out, t + i * 0.19, {
            pitch: P([
              [0, 240],
              [0.4, 200],
              [1, 150],
            ]),
            vowels: ['o', 'u'],
            duration: 0.14 * (mood === 'death' ? 2.2 : 1),
            gain: 0.5,
            wave: 'square',
            tremolo: 55,
            tremoloDepth: 0.8,
            breath: 0.12,
            attack: 0.015,
          });
        break;
      }
      case 'sheep':
        this.voice(out, t, {
          pitch: P([
            [0, 330],
            [0.2, 345],
            [1, 290],
          ]),
          vowels: ['m', 'e', 'a', 'a'],
          duration: 0.75 * len,
          gain: 0.45,
          tremolo: 23,
          tremoloDepth: 0.75,
          breath: 0.04,
          attack: 0.05,
        });
        break;
      case 'chicken': {
        const clucks = mood === 'say' ? 2 + Math.floor(Math.random() * 3) : 1;
        for (let i = 0; i < clucks; i++)
          this.voice(out, t + i * rand(0.09, 0.14), {
            pitch: P([
              [0, rand(620, 760)],
              [1, rand(520, 600)],
            ]),
            vowels: ['a', 'o'],
            duration: (mood === 'death' ? 0.3 : 0.07) * rand(0.9, 1.2),
            gain: 0.35,
            attack: 0.006,
          });
        break;
      }
      case 'zombie':
      case 'walker':
        this.voice(out, t, {
          pitch: P(
            mood === 'hurt'
              ? [
                  [0, 120],
                  [1, 90],
                ]
              : [
                  [0, 92],
                  [0.4, 100],
                  [1, 70],
                ],
          ),
          vowels: mood === 'hurt' ? ['a', 'u'] : ['u', 'o', 'a', 'u'],
          duration: (mood === 'hurt' ? 0.55 : 1.4) * (mood === 'death' ? 1.3 : 1),
          gain: 0.55,
          rough: 0.8,
          vibrato: 7,
          vibratoDepth: 0.04,
          breath: 0.08,
          attack: 0.1,
        });
        break;
      case 'skeleton':
      case 'wither_skeleton': {
        const low = k === 'wither_skeleton' ? 0.7 : 1;
        const clicks = mood === 'death' ? 14 : mood === 'hurt' ? 5 : 7;
        for (let i = 0; i < clicks; i++) {
          const at = t + i * rand(0.035, 0.075);
          this.noiseBurst(out, at, 0.025, {
            freq: rand(1400, 2600) * low * shift,
            q: 5,
            gain: 0.5,
          });
          this.tone(out, at, 0.03, {
            wave: 'triangle',
            f0: rand(380, 520) * low * shift,
            gain: 0.18,
          });
        }
        break;
      }
      case 'spider': {
        const d = mood === 'death' ? 0.9 : 0.5;
        const hiss = this.ctx.createGain();
        hiss.gain.value = 1;
        hiss.connect(out);
        const amp = this.ctx.createOscillator();
        amp.type = 'square';
        amp.frequency.value = rand(32, 44);
        const depth = this.ctx.createGain();
        depth.gain.value = 0.5;
        amp.connect(depth);
        depth.connect(hiss.gain);
        amp.onended = () => {
          amp.disconnect();
          depth.disconnect();
          hiss.disconnect();
        };
        amp.start(t);
        amp.stop(t + d + 0.05);
        this.noiseBurst(hiss, t, d, { freq: 3400 * shift, q: 2, gain: 0.45, attack: 0.05 });
        this.noiseBurst(hiss, t, d * 0.6, { type: 'lowpass', freq: 500, gain: 0.25 });
        break;
      }
      case 'creeper':
        // Creepers are silent until they die: then only a puff.
        if (mood !== 'say') this.poof(out, t, 0.5);
        break;
      case 'enderman':
        this.voice(out, t, {
          pitch: P([
            [0, 420],
            [0.5, 260],
            [1, 180],
          ]),
          vowels: ['i', 'o', 'u'],
          duration: 0.9 * len,
          gain: 0.4,
          wave: 'triangle',
          vibrato: 28,
          vibratoDepth: 0.08,
          attack: 0.05,
        });
        break;
      case 'slime':
      case 'slime_medium':
      case 'slime_small':
      case 'magma_cube':
      case 'magma_cube_medium':
      case 'magma_cube_small': {
        // Slimes have no voice: every call is a wet squelch, deeper for the big ones.
        const size = k.endsWith('small') ? 1 : k.endsWith('medium') ? 2 : 4;
        this.squish(out, t, size, k.startsWith('magma'), mood === 'death' ? 1.3 : 1);
        if (mood === 'death') this.squish(out, t + 0.12, size, k.startsWith('magma'), 0.8);
        break;
      }
      case 'ghast':
        if (mood === 'say') {
          // A lost child's moan, high and wavering, far across the lava.
          this.voice(out, t, {
            pitch: P([
              [0, 560],
              [0.35, 640],
              [0.7, 520],
              [1, 430],
            ]),
            vowels: ['u', 'o', 'u'],
            duration: 1.5,
            gain: 0.35,
            wave: 'triangle',
            vibrato: 6,
            vibratoDepth: 0.05,
            breath: 0.1,
            attack: 0.2,
          });
        } else {
          // Hurt: a sharp shriek; dying: a long falling wail.
          this.voice(out, t, {
            pitch: P(
              mood === 'hurt'
                ? [
                    [0, 900],
                    [0.3, 1150],
                    [1, 760],
                  ]
                : [
                    [0, 800],
                    [0.3, 900],
                    [1, 260],
                  ],
            ),
            vowels: ['i', 'a', 'o'],
            duration: mood === 'hurt' ? 0.5 : 1.6,
            gain: 0.42,
            wave: 'sawtooth',
            vibrato: 11,
            vibratoDepth: 0.06,
            breath: 0.15,
            attack: 0.03,
          });
        }
        break;
      case 'blaze': {
        const d = mood === 'death' ? 1.2 : 0.8;
        this.noiseBurst(out, t, d, {
          type: 'lowpass',
          freq: 900 * shift,
          gain: 0.5,
          attack: d * 0.4,
        });
        this.grains(out, t, 10, d, [1800, 4200], 3, 0.35, 0.02);
        break;
      }
      default:
        this.voice(out, t, {
          pitch: P([
            [0, 200],
            [1, 160],
          ]),
          vowels: ['a', 'o'],
          duration: 0.4 * len,
          gain: 0.35,
        });
    }
    if (mood === 'death' && k !== 'creeper') this.poof(out, t + 0.35, 0.35);
  }
  /** The puff of smoke a creature leaves when it dies. */
  poof(out: AudioNode, t: number, gain: number) {
    this.noiseBurst(out, t, 0.35, {
      type: 'lowpass',
      freq: 1800,
      sweepTo: 250,
      gain,
      attack: 0.01,
    });
  }
  /** The player's own grunt when hurt. */
  playerHurt(out: AudioNode, t: number, heavy = false) {
    this.voice(out, t, {
      pitch: [
        [0, heavy ? 190 : 220],
        [1, heavy ? 120 : 150],
      ],
      vowels: ['u', 'o'],
      duration: heavy ? 0.28 : 0.18,
      gain: 0.5,
      attack: 0.01,
      breath: 0.1,
    });
    this.tone(out, t, 0.08, { f0: 110, f1: 60, gain: 0.35 });
  }
  /** Melee swing landing on a creature; a critical hit cracks brighter. */
  punch(out: AudioNode, t: number, critical: boolean) {
    this.noiseBurst(out, t, 0.07, { type: 'lowpass', freq: 900, gain: 0.7 });
    this.tone(out, t, 0.07, { f0: 170, f1: 80, gain: 0.45 });
    if (critical) this.noiseBurst(out, t + 0.01, 0.06, { type: 'highpass', freq: 2600, gain: 0.5 });
  }
  explosion(out: AudioNode, t: number, strength = 1) {
    const g = Math.min(1.6, 0.8 + strength * 0.2);
    this.noiseBurst(out, t, 2.2, {
      type: 'lowpass',
      freq: 1400,
      sweepTo: 90,
      gain: g,
      attack: 0.005,
      rate: 0.6,
    });
    this.noiseBurst(out, t, 0.25, { type: 'highpass', freq: 1500, gain: g * 0.5 });
    this.tone(out, t, 0.9, { f0: 70, f1: 28, gain: g * 0.9, attack: 0.005 });
    this.grains(out, t + 0.1, 16, 1.2, [800, 3000], 2, g * 0.25, 0.03);
  }
  fuse(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 1.6, {
      type: 'highpass',
      freq: 3000,
      sweepTo: 5000,
      gain: 0.35,
      attack: 0.3,
    });
    this.grains(out, t, 12, 1.5, [3000, 6000], 3, 0.18, 0.015);
  }
  click(out: AudioNode, t: number, on: boolean) {
    this.noiseBurst(out, t, 0.012, { type: 'highpass', freq: 3000, gain: 0.5 });
    this.tone(out, t, 0.04, {
      wave: 'square',
      f0: on ? 1000 : 780,
      f1: on ? 900 : 700,
      gain: 0.12,
    });
  }
  door(out: AudioNode, t: number, open: boolean) {
    // A short creak of the hinge, then the knock of the leaf.
    this.voice(out, t, {
      pitch: [
        [0, open ? 110 : 150],
        [1, open ? 160 : 100],
      ],
      vowels: ['o', 'e'],
      duration: 0.22,
      gain: 0.18,
      rough: 0.4,
      attack: 0.02,
    });
    this.material(out, t + (open ? 0.2 : 0.16), 'wood', 'place', open ? 0.6 : 1);
  }
  chest(out: AudioNode, t: number, open: boolean) {
    this.voice(out, t, {
      pitch: [
        [0, open ? 90 : 130],
        [1, open ? 140 : 85],
      ],
      vowels: ['o', 'a'],
      duration: 0.35,
      gain: 0.16,
      rough: 0.5,
      attack: 0.03,
    });
    if (!open) this.material(out, t + 0.3, 'wood', 'place', 1.1);
  }
  piston(out: AudioNode, t: number, extend: boolean) {
    this.noiseBurst(out, t, 0.15, {
      freq: extend ? 500 : 700,
      sweepTo: extend ? 900 : 400,
      q: 1.5,
      gain: 0.5,
    });
    this.tone(out, t + (extend ? 0.1 : 0.05), 0.08, { f0: 120, f1: 70, gain: 0.4 });
  }
  ignite(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.08, { type: 'highpass', freq: 3500, gain: 0.45 });
    this.noiseBurst(out, t + 0.05, 0.45, {
      type: 'lowpass',
      freq: 400,
      sweepTo: 1600,
      gain: 0.35,
      attack: 0.1,
    });
  }
  /** An enderman blinks away: a warbling downward whoosh. */
  teleport(out: AudioNode, t: number) {
    for (const detune of [-30, 25])
      this.tone(out, t, 0.42, { wave: 'triangle', f0: 980, f1: 170, gain: 0.16, detune });
    this.noiseBurst(out, t, 0.4, { freq: 3200, sweepTo: 420, q: 3, gain: 0.22, attack: 0.01 });
  }
  /** The stare: a torn, glitching shriek. */
  scream(out: AudioNode, t: number) {
    this.voice(out, t, {
      pitch: [
        [0, 430],
        [0.25, 780],
        [0.5, 360],
        [0.75, 690],
        [1, 300],
      ],
      vowels: ['a', 'e', 'i', 'a'],
      duration: 1.2,
      gain: 0.38,
      vibrato: 23,
      vibratoDepth: 0.14,
      rough: 0.8,
      breath: 0.2,
      attack: 0.02,
    });
    this.noiseBurst(out, t, 1.1, { freq: 1800, sweepTo: 900, q: 6, gain: 0.12, attack: 0.05 });
  }
  /** A sheep tearing and munching grass. */
  graze(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.12, { type: 'highpass', freq: 2600, gain: 0.25 });
    for (let i = 0; i < 4; i++) this.grains(out, t + 0.15 + i * 0.16, 3, 0.06, [350, 900], 2, 0.3);
  }
  /** An egg laid, or one breaking on the ground. */
  egg(out: AudioNode, t: number) {
    this.tone(out, t, 0.09, { f0: 620, f1: 190, gain: 0.3 });
    this.noiseBurst(out, t + 0.01, 0.07, { freq: 1600, q: 2, gain: 0.18 });
  }
  /** A spider springs: a sharp hiss. */
  leap(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.28, { type: 'highpass', freq: 2800, sweepTo: 5200, gain: 0.3 });
    this.grains(out, t, 5, 0.12, [1800, 3200], 4, 0.12, 0.015);
  }
  /** A blaze throws a fireball: breathy roar opening into a whoosh. */
  blazeShoot(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.4, {
      type: 'lowpass',
      freq: 300,
      sweepTo: 2600,
      gain: 0.45,
      attack: 0.02,
    });
    this.tone(out, t, 0.3, { wave: 'sawtooth', f0: 95, f1: 55, gain: 0.12 });
  }
  /** A slime lands or leaps: a low wet slap, with a sizzle for a magma cube. */
  squish(out: AudioNode, t: number, size: number, magma = false, gain = 1) {
    const low = 1 / Math.sqrt(size);
    this.noiseBurst(out, t, 0.12 + size * 0.03, {
      type: 'lowpass',
      freq: 900 * low,
      sweepTo: 180 * low,
      gain: 0.45 * gain,
      attack: 0.005,
    });
    this.tone(out, t, 0.1 + size * 0.02, {
      f0: 260 * low * rand(0.9, 1.1),
      f1: 90 * low,
      gain: 0.22 * gain,
    });
    if (magma) this.grains(out, t + 0.03, 6, 0.25, [2500, 6000], 3, 0.1 * gain, 0.015);
  }
  /** A ghast about to fire: a quick rising screech. */
  ghastWarn(out: AudioNode, t: number) {
    this.voice(out, t, {
      pitch: [
        [0, 700],
        [0.6, 1200],
        [1, 1000],
      ],
      vowels: ['a', 'i'],
      duration: 0.45,
      gain: 0.4,
      wave: 'sawtooth',
      vibrato: 14,
      vibratoDepth: 0.05,
      breath: 0.12,
      attack: 0.02,
    });
  }
  /** A ghast spits its fireball: a deep whoosh. */
  ghastShoot(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.6, {
      type: 'lowpass',
      freq: 180,
      sweepTo: 1800,
      gain: 0.55,
      attack: 0.03,
    });
    this.tone(out, t, 0.45, { wave: 'sawtooth', f0: 70, f1: 38, gain: 0.16 });
  }
  /** A blaze drawing breath before a burst: crackles over a low rumble. */
  blazeCharge(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.9, { type: 'lowpass', freq: 220, gain: 0.3, attack: 0.25 });
    this.grains(out, t, 14, 0.8, [2000, 6000], 3, 0.14, 0.012);
  }
  /** Two quick snips of the shears. */
  shear(out: AudioNode, t: number) {
    for (const dt of [0, 0.13]) {
      this.partials(out, t + dt, 2300, [1, 2.76, 5.4], 0.07, 0.12);
      this.noiseBurst(out, t + dt, 0.05, { type: 'highpass', freq: 4000, gain: 0.25 });
    }
  }
  /** Something small thrown from the hand. */
  throw(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.2, { freq: 700, sweepTo: 2200, q: 1.5, gain: 0.22, attack: 0.03 });
  }
  extinguish(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.55, {
      type: 'highpass',
      freq: 4200,
      sweepTo: 2000,
      gain: 0.3,
      attack: 0.02,
    });
  }
  bucket(out: AudioNode, t: number, lava: boolean, fill: boolean) {
    if (lava) {
      this.noiseBurst(out, t, 0.5, {
        type: 'lowpass',
        freq: fill ? 700 : 400,
        sweepTo: fill ? 300 : 900,
        gain: 0.55,
        attack: 0.04,
      });
      this.tone(out, t + 0.1, 0.12, { f0: 180, f1: 90, gain: 0.3 });
    } else {
      this.noiseBurst(out, t, 0.4, {
        freq: fill ? 1400 : 700,
        sweepTo: fill ? 600 : 1500,
        q: 0.9,
        gain: 0.45,
        attack: 0.03,
      });
      this.bubbles(out, t + 0.05, 5, 0.12);
    }
    this.partials(out, t, 900, [1, 2.4], 0.12, 0.08);
  }
  bow(out: AudioNode, t: number, power: number) {
    this.tone(out, t, 0.18, {
      wave: 'triangle',
      f0: 190 + power * 40,
      f1: 110,
      gain: 0.35,
      attack: 0.002,
    });
    this.noiseBurst(out, t + 0.01, 0.3, {
      type: 'highpass',
      freq: 2500,
      sweepTo: 800,
      gain: 0.25 + power * 0.15,
      attack: 0.03,
    });
  }
  arrowHit(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.015, { type: 'highpass', freq: 2500, gain: 0.35 });
    this.tone(out, t, 0.08, { wave: 'triangle', f0: 320, f1: 200, gain: 0.3 });
  }
  pickup(out: AudioNode, t: number) {
    const f = rand(420, 620);
    this.tone(out, t, 0.07, { f0: f, f1: f * 2.1, gain: 0.25, attack: 0.003 });
  }
  orb(out: AudioNode, t: number) {
    const f = rand(1100, 2200);
    this.tone(out, t, 0.25, { f0: f, gain: 0.14, attack: 0.002 });
    this.tone(out, t, 0.18, { f0: f * 2.01, gain: 0.05, attack: 0.002 });
  }
  levelUp(out: AudioNode, t: number, big: boolean) {
    const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 783.99, 987.77];
    notes.forEach((f, i) => {
      this.tone(out, t + i * 0.09, 0.9, { wave: 'triangle', f0: f, gain: 0.16, attack: 0.004 });
      this.tone(out, t + i * 0.09, 0.6, { f0: f * 2, gain: 0.05, attack: 0.004 });
    });
  }
  crunch(out: AudioNode, t: number) {
    this.grains(out, t, 5, 0.08, [900, 2600], 2, 0.4, 0.03);
    this.noiseBurst(out, t, 0.06, { type: 'lowpass', freq: 500, gain: 0.3 });
  }
  burp(out: AudioNode, t: number) {
    this.voice(out, t, {
      pitch: [
        [0, 95],
        [1, 80],
      ],
      vowels: ['o', 'a', 'o'],
      duration: 0.32,
      gain: 0.3,
      rough: 0.3,
      tremolo: 30,
      tremoloDepth: 0.6,
      attack: 0.02,
    });
  }
  gulp(out: AudioNode, t: number) {
    this.tone(out, t, 0.09, { f0: 260, f1: 480, gain: 0.3 });
    this.noiseBurst(out, t, 0.08, { type: 'lowpass', freq: 600, gain: 0.25 });
  }
  enchant(out: AudioNode, t: number) {
    for (let i = 0; i < 9; i++)
      this.tone(out, t + i * 0.06, 0.6, {
        wave: 'sine',
        f0: 700 * Math.pow(1.122, i + rand(-0.2, 0.2)),
        gain: 0.07,
        attack: 0.02,
      });
  }
  anvil(out: AudioNode, t: number) {
    this.noiseBurst(out, t, 0.015, { type: 'highpass', freq: 2500, gain: 0.7 });
    this.partials(out, t, 780, [1, 2.4, 3.9, 6.1], 0.9, 0.3);
  }
  portal(out: AudioNode, t: number) {
    for (let i = 0; i < 4; i++)
      this.tone(out, t, 1.6, {
        f0: 180 * (1 + i * 0.5),
        f1: 90 * (1 + i * 0.5),
        gain: 0.08,
        attack: 0.4,
        detune: rand(-15, 15),
      });
    this.noiseBurst(out, t, 1.5, { freq: 600, sweepTo: 2400, q: 3, gain: 0.25, attack: 0.5 });
  }
  crystal(out: AudioNode, t: number) {
    this.partials(out, t, 1300, [1, 1.5, 2.25, 3.4], 0.8, 0.18);
  }
  ui(out: AudioNode, t: number) {
    this.tone(out, t, 0.035, { wave: 'square', f0: 1200, f1: 900, gain: 0.08, attack: 0.002 });
  }
  craft(out: AudioNode, t: number) {
    this.material(out, t, 'wood', 'place', 0.7);
    this.tone(out, t + 0.05, 0.12, { wave: 'triangle', f0: 620, f1: 900, gain: 0.08 });
  }
  /** Bird calls: a few quick whistles. */
  bird(out: AudioNode, t: number) {
    const base = rand(2400, 3800);
    const notes = 2 + Math.floor(Math.random() * 4);
    const falling = Math.random() < 0.5;
    for (let i = 0; i < notes; i++) {
      const f = base * (falling ? 1 - i * 0.06 : 1 + i * 0.04);
      this.tone(out, t + i * rand(0.07, 0.12), rand(0.05, 0.09), {
        f0: f,
        f1: f * rand(1.1, 1.35),
        gain: rand(0.05, 0.1),
        attack: 0.008,
      });
    }
  }
  /** A cricket's trill at night. */
  cricket(out: AudioNode, t: number) {
    const f = rand(4200, 4900);
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++)
      this.tone(out, t + i * 0.045, 0.028, { f0: f, gain: 0.035, attack: 0.004 });
  }
  /** Water dripping somewhere in a cave. */
  drip(out: AudioNode, t: number) {
    const f = rand(1100, 2000);
    this.tone(out, t, 0.06, { f0: f, f1: f * 1.9, gain: 0.08, attack: 0.002 });
  }
  /** A low, uneasy swell from the depths, as the reference's cave sounds. */
  cave(out: AudioNode, t: number) {
    const f = rand(55, 85);
    const d = rand(3, 5);
    this.tone(out, t, d, {
      wave: 'sawtooth',
      f0: f,
      f1: f * rand(0.8, 1.1),
      gain: 0.05,
      attack: d * 0.45,
    });
    this.tone(out, t, d, { f0: f * 1.5, f1: f * 1.4, gain: 0.05, attack: d * 0.5, detune: 8 });
    this.noiseBurst(out, t, d, {
      freq: rand(250, 500),
      sweepTo: rand(150, 900),
      q: 4,
      gain: 0.12,
      attack: d * 0.4,
    });
  }
  lavaPop(out: AudioNode, t: number) {
    this.tone(out, t, 0.05, { f0: rand(90, 160), f1: 50, gain: 0.25 });
    this.noiseBurst(out, t, 0.08, { type: 'lowpass', freq: 800, gain: 0.2 });
  }
  roar(out: AudioNode, t: number, kind: string) {
    const dragon = kind.includes('dragon');
    this.voice(out, t, {
      pitch: dragon
        ? [
            [0, 70],
            [0.3, 95],
            [1, 55],
          ]
        : [
            [0, 110],
            [1, 70],
          ],
      vowels: ['a', 'o', 'u'],
      duration: dragon ? 2.2 : 1.4,
      gain: 0.6,
      rough: 1,
      vibrato: 9,
      vibratoDepth: 0.05,
      breath: 0.2,
      attack: 0.2,
    });
  }
}
