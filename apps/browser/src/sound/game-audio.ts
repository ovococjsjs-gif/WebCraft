import type { SimulationSnapshot } from '@core/simulation';
import { itemRegistry } from '@content/items';
import { Synth, materialOf } from './synth';
import { MusicDirector } from './music';

export type GameSound =
  | 'step'
  | 'break'
  | 'place'
  | 'pickup'
  | 'hurt'
  | 'craft'
  | 'portal'
  | 'ui'
  | 'bow'
  | 'eat'
  | 'enchant'
  | 'anvil'
  | 'chest_open'
  | 'chest_close';

type Vec = { x: number; y: number; z: number };
/** Beyond this distance a world sound is not played at all, as in the reference (16 blocks). */
const HEARING = 20;
const MAX_VOICES = 48;

/**
 * The WebCraft sound engine. Everything is synthesised (see `synth.ts`), positioned in 3D around
 * the camera, sent through a shared reverb that grows in caves, and muffled under water. The
 * engine only listens to snapshots: it compares each one with the previous and plays what changed.
 * No assets, downloads or autoplay: the context starts on the first gesture.
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Everything in the world passes this filter: it closes under water. */
  private world: BiquadFilterNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private synth: Synth | null = null;
  private music: MusicDirector | null = null;
  private longNoise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode } | null =
    null;
  private rain: { gain: GainNode; source: AudioBufferSourceNode; filter: BiquadFilterNode } | null =
    null;
  private drone: { gain: GainNode; oscs: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private active = 0;
  private lastState: SimulationSnapshot | null = null;
  private lastEvent = 0;
  private stepDistance = 0;
  private swimDistance = 0;
  private nextSay = new Map<number, number>();
  private mobHurt = new Map<number, boolean>();
  private mobFuse = new Map<number, number>();
  private bossHurt = new Map<number, boolean>();
  private nextAmbient = { bird: 0, cricket: 0, drip: 0, cave: 0, lava: 0, boss: 0 };
  private lastDig = -1;
  private arrowLast = new Map<number, { x: number; y: number; z: number; moving: boolean }>();
  private lastCrunch = -1;
  volume = 0.35;
  musicVolume = 0.5;
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume * 0.5;
  }
  setMusicVolume(volume: number) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume * 1.1;
  }
  async unlock() {
    try {
      if (!this.context) this.build();
      if (this.context!.state === 'suspended') await this.context!.resume();
    } catch {
      /* Sound must never prevent playing or saving. */
    }
  }
  private build() {
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.5;
    // A gentle limiter keeps an explosion next to a herd of cows from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.world = ctx.createBiquadFilter();
    this.world.type = 'lowpass';
    this.world.frequency.value = 20000;
    this.world.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.world);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.9;
    this.ambience.connect(this.world);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 1.1;
    this.musicBus.connect(this.master);
    // Shared reverb: a synthetic room, bigger than it sounds. Music always uses a little,
    // the world more the deeper underground the player is.
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    reverb.connect(wet);
    wet.connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.08;
    this.sfx.connect(this.reverbSend);
    this.ambience.connect(this.reverbSend);
    this.reverbSend.connect(reverb);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.45;
    this.musicBus.connect(musicSend);
    musicSend.connect(reverb);
    this.synth = new Synth(ctx);
    this.music = new MusicDirector(ctx, this.musicBus);
    this.longNoise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const long = this.longNoise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < long.length; i++) {
      last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;
      long[i] = last * 1.2;
    }
  }
  private impulse(ctx: AudioContext, seconds: number) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Early reflections, then a smooth exponential tail.
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 0.8 : 0;
        data[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) + early) * 0.55;
      }
    }
    return buffer;
  }
  private get ready() {
    return (
      !!this.context &&
      this.context.state === 'running' &&
      !!this.synth &&
      !!this.sfx &&
      this.volume > 0
    );
  }
  /**
   * A destination for one sound: straight to the bus for the player's own sounds, through a
   * panner for anything placed in the world. Returns null when it is out of earshot.
   */
  private at(position: Vec | null, gain = 1, bus: AudioNode | null = this.sfx): AudioNode | null {
    const ctx = this.context;
    if (!ctx || !bus || this.active >= MAX_VOICES) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (position) {
      const listener = this.lastState?.player.position;
      if (listener) {
        const d = Math.hypot(
          position.x - listener.x,
          position.y - (listener.y + 1.62),
          position.z - listener.z,
        );
        if (d > HEARING) return null;
      }
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = 1.5;
      panner.maxDistance = HEARING;
      panner.rolloffFactor = 1;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      g.connect(panner);
      panner.connect(bus);
      this.release(g, panner);
    } else {
      g.connect(bus);
      this.release(g);
    }
    return g;
  }
  /** Voices are counted and their routing nodes torn down once every sound in them is over. */
  private release(...nodes: AudioNode[]) {
    this.active++;
    window.setTimeout(() => {
      for (const node of nodes) node.disconnect();
      this.active--;
    }, 3000);
  }
  private get now() {
    return this.context!.currentTime + 0.01;
  }
  /** Interface and one-shot sounds requested by the page. */
  play(kind: GameSound) {
    if (!this.ready) return;
    const s = this.synth!;
    const out = this.at(null);
    if (!out) return;
    const t = this.now;
    switch (kind) {
      case 'step':
        s.material(out, t, 'stone', 'step');
        break;
      case 'break':
        s.material(out, t, 'stone', 'break');
        break;
      case 'place':
        s.material(out, t, 'wood', 'place', 0.6);
        break;
      case 'pickup':
        s.pickup(out, t);
        break;
      case 'hurt':
        s.playerHurt(out, t);
        break;
      case 'craft':
        s.craft(out, t);
        break;
      case 'portal':
        s.portal(out, t);
        break;
      case 'ui':
        s.ui(out, t);
        break;
      case 'bow':
        s.bow(out, t, 1);
        break;
      case 'eat':
        s.crunch(out, t);
        break;
      case 'enchant':
        s.enchant(out, t);
        break;
      case 'anvil':
        s.anvil(out, t);
        break;
      case 'chest_open':
      case 'chest_close':
        s.chest(out, t, kind === 'chest_open');
        break;
    }
  }
  /** Thunder after a strike: the farther, the later, softer and deeper it rolls in. */
  thunder(distance: number) {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.longNoise || !this.ambience) return;
    const start = ctx.currentTime + Math.min(1.6, distance / 45);
    const loud = Math.max(0.25, 1 - distance / 90);
    if (distance < 30)
      this.synth!.noiseBurst(this.ambience, start, 0.25, {
        type: 'highpass',
        freq: 1800,
        gain: loud * 0.8,
      });
    const source = ctx.createBufferSource();
    source.buffer = this.longNoise;
    source.loop = true;
    source.playbackRate.value = 0.55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(distance < 30 ? 900 : 420, start);
    filter.frequency.exponentialRampToValueAtTime(140, start + 2.6);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(1.3 * loud, start + (distance < 30 ? 0.03 : 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.5 * loud, start + 0.9);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 3.6);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.ambience);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    source.start(start);
    source.stop(start + 3.7);
  }
  /** Keeps the listener at the camera, looking where the player looks. */
  private placeListener(state: SimulationSnapshot) {
    const listener = this.context!.listener;
    const p = state.player.position;
    const yaw = state.look.yaw,
      pitch = state.look.pitch;
    const fx = -Math.sin(yaw) * Math.cos(pitch),
      fy = Math.sin(pitch),
      fz = -Math.cos(yaw) * Math.cos(pitch);
    if (listener.positionX) {
      listener.positionX.value = p.x;
      listener.positionY.value = p.y + 1.62;
      listener.positionZ.value = p.z;
      listener.forwardX.value = fx;
      listener.forwardY.value = fy;
      listener.forwardZ.value = fz;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      listener.setPosition(p.x, p.y + 1.62, p.z);
      listener.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }
  /** A looped noise bed (wind, rain) that fades in and out with `level`. */
  private bed(
    current: { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode } | null,
    level: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
  ) {
    const ctx = this.context!;
    if (!current && level > 0.001) {
      const source = ctx.createBufferSource();
      source.buffer = this.longNoise;
      source.loop = true;
      source.loopStart = Math.random();
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      filter.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambience!);
      source.start();
      current = { gain, source, filter };
    }
    if (!current) return null;
    const now = ctx.currentTime;
    current.filter.frequency.setTargetAtTime(freq, now, 0.4);
    current.gain.gain.setTargetAtTime(Math.max(0.0001, level), now, 0.8);
    if (level <= 0.001 && current.gain.gain.value < 0.002) {
      current.source.stop();
      current.source.disconnect();
      current.filter.disconnect();
      current.gain.disconnect();
      return null;
    }
    return current;
  }
  /** The steady air of a dimension: a low hum in the Nether, a hollow wind in the End. */
  private updateDrone(state: SimulationSnapshot, playing: boolean) {
    const ctx = this.context!;
    const dimension = state.dimension;
    const level = !playing ? 0 : dimension === 'nether' ? 0.09 : dimension === 'end' ? 0.05 : 0;
    if (!this.drone && level > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = dimension === 'nether' ? 260 : 600;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      filter.connect(gain);
      gain.connect(this.ambience!);
      const base = dimension === 'nether' ? 41 : 58;
      const oscs = [1, 1.5, 2.01].map((ratio, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sawtooth' : 'sine';
        osc.frequency.value = base * ratio;
        osc.detune.value = (i - 1) * 6;
        osc.connect(filter);
        osc.start();
        return osc;
      });
      this.drone = { gain, oscs, filter };
    }
    if (!this.drone) return;
    this.drone.gain.gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 1.5);
    if (level === 0 && this.drone.gain.gain.value < 0.002) {
      for (const osc of this.drone.oscs) {
        osc.stop();
        osc.disconnect();
      }
      this.drone.filter.disconnect();
      this.drone.gain.disconnect();
      this.drone = null;
    }
  }
  observe(state: SimulationSnapshot, playing: boolean): GameSound | null {
    const old = this.lastState;
    this.lastState = state;
    if (!this.context || !this.synth || !this.world || !this.reverbSend) return null;
    const ctx = this.context;
    const now = ctx.currentTime;
    this.placeListener(state);
    // Under water everything is dull and near; in a cave everything rings.
    const medium = state.cameraMedium;
    this.world.frequency.setTargetAtTime(
      medium === 'water' ? 650 : medium === 'lava' ? 300 : 20000,
      now,
      0.08,
    );
    const hearing = state.hearing;
    const eyeY = state.player.position.y + 1.62;
    const underground = hearing ? hearing.sky <= 2 && eyeY < 62 : false;
    const enclosed = hearing ? hearing.sky < 10 : false;
    this.reverbSend.gain.setTargetAtTime(
      state.dimension !== 'overworld' ? 0.3 : underground ? 0.45 : enclosed ? 0.18 : 0.06,
      now,
      0.6,
    );
    this.updateRain(state, playing);
    const open = playing && state.dimension === 'overworld' && !underground && medium === 'air';
    const altitude = Math.max(0, Math.min(1, (eyeY - 70) / 60));
    const storm = state.weather ? state.weather.rain * 0.5 + state.weather.thunder * 0.5 : 0;
    const windLevel = open
      ? (hearing?.sky ?? 15) >= 14
        ? 0.05 + altitude * 0.16 + storm * 0.08
        : 0.02
      : 0;
    this.wind = this.bed(
      this.wind,
      windLevel,
      'bandpass',
      380 + altitude * 300 + Math.sin(now * 0.13) * 90,
      0.6,
    );
    this.updateDrone(state, playing);
    const musicMood =
      state.dimension === 'nether'
        ? 'nether'
        : state.dimension === 'end'
          ? 'end'
          : medium === 'water'
            ? 'water'
            : state.night
              ? 'night'
              : 'overworld';
    this.music?.update(musicMood, playing && this.musicVolume > 0 && this.volume > 0);
    if (!old || !playing || !this.ready) {
      this.lastEvent = Math.max(this.lastEvent, ...state.visualEvents.map((e) => e.id), 0);
      return null;
    }
    let effect: GameSound | null = null;
    const s = this.synth;
    const t = this.now;
    const me = state.player.position;
    // --- world events from the simulation
    for (const e of state.visualEvents) {
      if (e.id <= this.lastEvent) continue;
      this.lastEvent = e.id;
      if (state.tick - e.tick > 10) continue;
      const pos = { x: e.x, y: e.y, z: e.z };
      switch (e.kind) {
        case 'break': {
          const out = this.at(pos);
          if (out && e.block !== undefined) s.material(out, t, materialOf(e.block), 'break');
          break;
        }
        case 'place': {
          const out = this.at(pos);
          if (out && e.block !== undefined) s.material(out, t, materialOf(e.block), 'place');
          break;
        }
        case 'land': {
          const out = this.at(null);
          if (out)
            s.material(out, t, materialOf(e.block ?? 3), 'land', Math.min(1.5, e.strength / 2));
          break;
        }
        case 'splash': {
          const out = this.at(pos);
          if (out) s.splash(out, t, e.strength);
          break;
        }
        case 'explosion': {
          const out = this.at(pos, 1.3);
          if (out) s.explosion(out, t, e.strength);
          break;
        }
        case 'crystal': {
          const out = this.at(pos);
          if (out) s.crystal(out, t);
          break;
        }
        case 'pickup': {
          const out = this.at(pos, 0.8);
          if (out) s.pickup(out, t);
          effect = 'pickup';
          break;
        }
        case 'hit': {
          // The player's own blow; the creature answers through its hurt flag below.
          if (e.sound) {
            const out = this.at(pos);
            if (out) s.punch(out, t, e.strength > 1.5);
          }
          break;
        }
        case 'death': {
          const out = this.at(pos);
          if (out && e.sound) s.creature(out, t, e.sound, 'death');
          break;
        }
        case 'sound':
          this.cue(e.sound ?? '', pos, e.block);
          break;
      }
    }
    // --- the player
    if (state.survival.health < old.survival.health && !state.survival.dead) {
      const out = this.at(null);
      if (out) s.playerHurt(out, t, old.survival.health - state.survival.health >= 4);
      effect = effect ?? 'hurt';
    }
    if (old.dimension !== state.dimension) {
      const out = this.at(null);
      if (out) s.portal(out, t);
      effect = 'portal';
    }
    if (state.edits > old.edits && old.mining) effect = effect ?? 'break';
    const moved = Math.hypot(me.x - old.player.position.x, me.z - old.player.position.z);
    if (moved < 3) {
      if (state.player.inWater && !state.player.onGround) {
        this.swimDistance += moved;
        if (this.swimDistance > 1.6) {
          this.swimDistance = 0;
          const out = this.at(null, 0.5);
          if (out) s.splash(out, t, 0.15);
        }
      } else if (state.player.onGround && !state.player.flying) {
        this.stepDistance += moved * (state.hearing?.crouch ? 0.6 : 1);
        if (this.stepDistance > 1.55) {
          this.stepDistance = 0;
          const out = this.at(null, state.hearing?.crouch ? 0.45 : 1);
          if (out) s.material(out, t, materialOf(state.ground ?? 1), 'step');
        }
      }
    }
    if (
      state.player.onGround &&
      !old.player.onGround &&
      !state.player.flying &&
      !state.player.inWater
    ) {
      const out = this.at(null, 0.7);
      if (out) s.material(out, t, materialOf(state.ground ?? 1), 'step');
    }
    // Digging: a knock every four ticks, as the reference does.
    const mining = state.mining;
    if (mining && mining.ticks > 1 && mining.progress > 0) {
      const beat = Math.floor(mining.progress / 4);
      if (beat !== this.lastDig) {
        this.lastDig = beat;
        const out = this.at({ x: mining.x + 0.5, y: mining.y + 0.5, z: mining.z + 0.5 }, 0.8);
        if (out) s.material(out, t, materialOf(mining.state), 'dig');
      }
    } else this.lastDig = -1;
    // Eating and drinking: bites while the meal lasts, a burp or a sigh at the end.
    const heldKey = state.inventory[state.selected]?.[0];
    const held = heldKey ? itemRegistry.find(heldKey) : undefined;
    const drinking = !!held?.potion || heldKey?.startsWith('lab:potion');
    if (state.use.eating && state.use.ticks > 4) {
      const bite = Math.floor(state.use.ticks / 4);
      if (bite !== this.lastCrunch) {
        this.lastCrunch = bite;
        const out = this.at(null, 0.8);
        if (out) (drinking ? s.gulp : s.crunch).call(s, out, t);
      }
    } else this.lastCrunch = -1;
    if (old.use.eating && !state.use.eating && state.survival.food > old.survival.food) {
      const out = this.at(null);
      if (out && !drinking) s.burp(out, t + 0.05);
      effect = effect ?? 'eat';
    }
    if (
      old.use.bowCharge > 3 &&
      state.use.bowCharge === 0 &&
      state.arrows.length > old.arrows.length
    ) {
      const out = this.at(null);
      if (out) s.bow(out, t, Math.min(1, old.use.bowCharge / old.use.bowTotal));
    }
    // An arrow that stops moving has hit something.
    for (const arrow of state.arrows) {
      const last = this.arrowLast.get(arrow.id);
      const moving =
        !last || Math.hypot(arrow.x - last.x, arrow.y - last.y, arrow.z - last.z) > 0.01;
      if (last && last.moving && !moving) {
        const out = this.at(arrow);
        if (out) s.arrowHit(out, t);
      }
      this.arrowLast.set(arrow.id, { x: arrow.x, y: arrow.y, z: arrow.z, moving });
    }
    if (this.arrowLast.size > state.arrows.length)
      for (const id of this.arrowLast.keys())
        if (!state.arrows.some((a) => a.id === id)) this.arrowLast.delete(id);
    if (state.survival.level > old.survival.level) {
      const out = this.at(null);
      if (out) s.levelUp(out, t, state.survival.level % 5 === 0);
    } else if (state.survival.xp > old.survival.xp) {
      const out = this.at(null, 0.8);
      if (out) s.orb(out, t);
    }
    // Chests creak open and thump shut.
    const wasChest = old.container?.kind === 'chest';
    const isChest = state.container?.kind === 'chest';
    if (wasChest !== isChest) {
      const out = this.at(null, 0.9);
      if (out) s.chest(out, t, isChest);
    }
    this.creatures(state, old, t);
    this.ambient(state, open, underground, t);
    return effect;
  }
  /** Named cues sent by the simulation for things only it can see. */
  private cue(name: string, pos: Vec, block?: number) {
    const s = this.synth!;
    const t = this.now;
    const out = this.at(pos);
    if (!out) return;
    switch (name) {
      case 'door_open':
      case 'door_close':
        s.door(out, t, name === 'door_open');
        break;
      case 'click_on':
      case 'click_off':
        s.click(out, t, name === 'click_on');
        break;
      case 'piston_out':
      case 'piston_in':
        s.piston(out, t, name === 'piston_out');
        break;
      case 'ignite':
        s.ignite(out, t);
        break;
      case 'extinguish':
        s.extinguish(out, t);
        break;
      case 'fuse':
        s.fuse(out, t);
        break;
      case 'mob_teleport':
        s.teleport(out, t);
        break;
      case 'enderman_scream':
        s.scream(out, t);
        break;
      case 'mob_graze':
        s.graze(out, t);
        break;
      case 'mob_egg':
        s.egg(out, t);
        break;
      case 'mob_leap':
        s.leap(out, t);
        break;
      case 'blaze_shoot':
        s.blazeShoot(out, t);
        break;
      case 'blaze_charge':
        s.blazeCharge(out, t);
        break;
      case 'slime_jump':
      case 'slime_land':
        s.squish(out, t, 2, false, name === 'slime_jump' ? 0.6 : 0.9);
        break;
      case 'ghast_warn':
        s.ghastWarn(out, t);
        break;
      case 'ghast_shoot':
        s.ghastShoot(out, t);
        break;
      case 'shear':
        s.shear(out, t);
        break;
      case 'villager':
      case 'villager_yes':
        s.creature(out, t, 'lab:villager', 'say');
        break;
      case 'villager_no':
        s.creature(out, t, 'lab:villager', 'hurt');
        break;
      case 'milk':
        s.bucket(out, t, false, true);
        break;
      case 'throw':
        s.throw(out, t);
        break;
      case 'bucket_water':
      case 'bucket_lava':
      case 'fill_water':
      case 'fill_lava':
        s.bucket(out, t, name.endsWith('lava'), name.startsWith('fill'));
        break;
      default:
        if (block !== undefined) s.material(out, t, materialOf(block), 'place');
    }
  }
  /** Idle calls, hurt cries and creeper fuses of the creatures around the player. */
  private creatures(state: SimulationSnapshot, old: SimulationSnapshot, t: number) {
    const s = this.synth!;
    const me = state.player.position;
    const perf = performance.now();
    const alive = new Set<number>();
    for (const mob of state.mobs) {
      alive.add(mob.id);
      const d = Math.hypot(mob.x - me.x, mob.y - me.y, mob.z - me.z);
      const head = { x: mob.x, y: mob.y + 1.2, z: mob.z };
      const wasHurt = this.mobHurt.get(mob.id) ?? false;
      if (mob.hurt && !wasHurt && mob.health > 0) {
        const out = this.at(head);
        if (out) s.creature(out, t, mob.kind, 'hurt', mob.baby);
      }
      this.mobHurt.set(mob.id, mob.hurt);
      const fuse = this.mobFuse.get(mob.id) ?? 0;
      if (mob.fuse > 0 && fuse === 0) {
        const out = this.at(head);
        if (out) s.fuse(out, t);
      }
      this.mobFuse.set(mob.id, mob.fuse);
      // A ghast's moan carries across the Nether; everything else is heard up close.
      if (d > (mob.kind === 'lab:ghast' ? 64 : 16)) continue;
      const next = this.nextSay.get(mob.id);
      const hostile = /zombie|skeleton|spider|enderman|blaze|walker|slime|magma|ghast/.test(
        mob.kind,
      );
      if (next === undefined) this.nextSay.set(mob.id, perf + 2000 + Math.random() * 9000);
      else if (perf >= next) {
        this.nextSay.set(mob.id, perf + (hostile ? 5000 : 7000) + Math.random() * 11000);
        const out = this.at(head, 0.85);
        if (out) s.creature(out, t + Math.random() * 0.2, mob.kind, 'say', mob.baby);
      }
    }
    for (const id of this.nextSay.keys()) if (!alive.has(id)) this.nextSay.delete(id);
    for (const id of this.mobHurt.keys()) if (!alive.has(id)) this.mobHurt.delete(id);
    for (const id of this.mobFuse.keys()) if (!alive.has(id)) this.mobFuse.delete(id);
    // Bosses roar when hit and now and then on their own.
    for (const boss of state.bosses) {
      const was = this.bossHurt.get(boss.id) ?? false;
      const at = { x: boss.x, y: boss.y + 2, z: boss.z };
      if ((boss.hurt && !was) || perf > this.nextAmbient.boss) {
        this.nextAmbient.boss = perf + 9000 + Math.random() * 9000;
        const out = this.at(at, 1.2);
        if (out) s.roar(out, t, boss.kind);
      }
      this.bossHurt.set(boss.id, boss.hurt);
    }
    void old;
  }
  /** Birds by day, crickets by night, drips and low swells in caves, lava pops nearby. */
  private ambient(state: SimulationSnapshot, open: boolean, underground: boolean, t: number) {
    const s = this.synth!;
    const perf = performance.now();
    const me = state.player.position;
    const around = (min: number, max: number, dy = 4) => {
      const angle = Math.random() * Math.PI * 2;
      const r = min + Math.random() * (max - min);
      return {
        x: me.x + Math.cos(angle) * r,
        y: me.y + 1.6 + Math.random() * dy,
        z: me.z + Math.sin(angle) * r,
      };
    };
    const raining = (state.weather?.rain ?? 0) > 0.2;
    const hour = ((state.time % 24000) + 24000) % 24000;
    const dawnDusk = hour < 2000 || (hour > 11000 && hour < 13000);
    if (open && !state.night && !raining && perf > this.nextAmbient.bird) {
      this.nextAmbient.bird = perf + (dawnDusk ? 2500 : 5000) + Math.random() * 9000;
      const out = this.at(around(6, 16, 6), 0.9, this.ambience);
      if (out) s.bird(out, t);
      // A second bird sometimes answers.
      if (Math.random() < 0.4) {
        const reply = this.at(around(8, 18, 6), 0.7, this.ambience);
        if (reply) s.bird(reply, t + 0.6 + Math.random() * 0.8);
      }
    }
    if (open && state.night && !raining && perf > this.nextAmbient.cricket) {
      this.nextAmbient.cricket = perf + 900 + Math.random() * 2600;
      const out = this.at(around(4, 14, 0), 0.9, this.ambience);
      if (out) {
        s.cricket(out, t);
        if (Math.random() < 0.6) s.cricket(out, t + 0.35);
      }
    }
    if (underground && state.dimension === 'overworld') {
      if (perf > this.nextAmbient.drip) {
        this.nextAmbient.drip = perf + 2500 + Math.random() * 7000;
        const out = this.at(around(3, 12, 3), 1, this.ambience);
        if (out) s.drip(out, t);
      }
      if (perf > this.nextAmbient.cave) {
        this.nextAmbient.cave = perf + 45000 + Math.random() * 90000;
        const out = this.at(around(6, 14, 2), 1, this.ambience);
        if (out) s.cave(out, t);
      }
    } else this.nextAmbient.cave = Math.max(this.nextAmbient.cave, perf + 20000);
    const lava = state.hearing?.lava;
    if (lava && perf > this.nextAmbient.lava) {
      this.nextAmbient.lava = perf + 700 + Math.random() * 2600;
      const out = this.at(
        { x: lava.x + 0.5, y: lava.y + 0.9, z: lava.z + 0.5 },
        0.8,
        this.ambience,
      );
      if (out) s.lavaPop(out, t);
    }
  }
  /** The hiss of rain: loud in the open, muffled under a roof, silent in snow or deep indoors. */
  private updateRain(state: SimulationSnapshot, playing: boolean) {
    const ctx = this.context;
    if (!ctx || !this.ambience || !this.longNoise) return;
    const w = state.weather;
    let level = 0,
      muffled = false;
    if (playing && w && w.rain > 0 && w.kind === 'rain' && state.dimension === 'overworld') {
      const eye = Math.floor(state.player.position.y + 1.6);
      const r = 10,
        top = w.tops?.[r * (2 * r + 1) + r];
      muffled = top !== undefined && top > eye;
      const depth = top !== undefined ? top - eye : 0;
      level = w.rain * (muffled ? (depth > 12 ? 0 : 0.35) : 1) * (0.8 + w.thunder * 0.3);
    }
    this.rain = this.bed(this.rain, level * 0.3, 'bandpass', muffled ? 500 : 2600, 0.6);
  }
  /** Starts a piece of music now; for the debug API. */
  musicNow() {
    this.music?.startSoon();
  }
  get status() {
    return {
      unlocked: !!this.context,
      running: this.context?.state === 'running',
      volume: this.volume,
      music: this.musicVolume,
      musicPlaying: this.music?.playing ?? false,
      active: this.active,
    };
  }
  dispose() {
    this.rain = null;
    this.wind = null;
    this.drone = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.synth = null;
    this.music = null;
    this.longNoise = null;
  }
}
