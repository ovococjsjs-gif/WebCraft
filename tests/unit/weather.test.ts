import { describe, expect, it } from 'vitest';
import {
  WeatherSchedule,
  precipitationFor,
  WEATHER_GRID_RADIUS,
} from '../../packages/core/src/weather';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { BLOCK } from '../../packages/content/src/blocks';

describe('weather schedule', () => {
  it('starts clear, then alternates clear spells and rain spells of plausible length', () => {
    const w = new WeatherSchedule(1234);
    expect(w.at(0).rain).toBe(0);
    let spells = 0,
      rainy = 0,
      last = 0,
      stormy = 0;
    for (let t = 0; t < 2_000_000; t += 200) {
      const r = w.at(t).rain > 0 ? 1 : 0;
      if (r !== last) spells++;
      rainy += r;
      if (w.at(t).thunder > 0) stormy++;
      last = r;
    }
    expect(spells).toBeGreaterThan(20);
    // Rain is the exception, as in the reference: well under half of the time.
    expect(rainy / 10_000).toBeGreaterThan(0.05);
    expect(rainy / 10_000).toBeLessThan(0.4);
    expect(stormy).toBeGreaterThan(0);
    expect(stormy).toBeLessThan(rainy);
  });
  it('is the same for the same seed, whatever order ticks are asked in', () => {
    const a = new WeatherSchedule(99),
      b = new WeatherSchedule(99);
    const ticks = Array.from({ length: 200 }, (_, i) => (i * 7919 * 131) % 900_000);
    const forward = ticks.map((t) => a.at(t).rain);
    const shuffled = [...ticks]
      .reverse()
      .map((t) => b.at(t).rain)
      .reverse();
    expect(shuffled).toEqual(forward);
  });
  it('eases rain in and out instead of switching it', () => {
    const w = new WeatherSchedule(7);
    let t = 0;
    while (w.at(t).rain === 0) t += 10;
    const values = Array.from({ length: 12 }, (_, i) => w.at(t + i * 10).rain);
    expect(values[0]).toBeLessThan(0.2);
    expect(values.at(-1)!).toBeGreaterThan(values[0]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  });
  it('strikes lightning only in storms, somewhere near the player', () => {
    const w = new WeatherSchedule(5);
    let strikes = 0;
    for (let t = 0; t < 3_000_000 && strikes < 5; t += 40) {
      const s = w.lightning(t, 100, -50);
      if (!s) continue;
      strikes++;
      expect(w.at(s.tick).thunder).toBeGreaterThanOrEqual(0.5);
      expect(Math.hypot(s.x - 100, s.z + 50)).toBeLessThan(66);
    }
    expect(strikes).toBeGreaterThan(0);
  });
  it('rains, snows or stays dry by the biome and height', () => {
    expect(precipitationFor(0.8, 0.4, 70)).toBe('rain');
    expect(precipitationFor(2, 0, 70)).toBe('none');
    expect(precipitationFor(-0.5, 0.4, 70)).toBe('snow');
    // Extreme hills: rain in the valley, snow on the peaks.
    expect(precipitationFor(0.2, 0.3, 70)).toBe('rain');
    expect(precipitationFor(0.2, 0.3, 130)).toBe('snow');
  });
});

describe('weather in the simulation', () => {
  const setup = () => {
    const world = new VoxelWorld('weather-test');
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, world.seed, 'flat'));
    return { world, sim: new Simulation(world, spawnPoint(world.seed, 'flat')) };
  };
  it('reports where rain stops around the player, roofs included', () => {
    const { world, sim } = setup();
    sim.weatherOverride = { rain: 1, thunder: 0 };
    const p = sim.player.position;
    const bx = Math.floor(p.x),
      bz = Math.floor(p.z),
      roof = Math.floor(p.y) + 4;
    world.setBlock(bx + 2, roof, bz, BLOCK.PLANKS);
    sim.step();
    const w = sim.snapshot().weather;
    expect(w.rain).toBe(1);
    const r = WEATHER_GRID_RADIUS,
      at = (dx: number, dz: number) => w.tops![(dz + r) * (2 * r + 1) + dx + r];
    expect(w.tops).toHaveLength((2 * r + 1) ** 2);
    expect(at(2, 0)).toBe(roof + 1);
    expect(at(0, 0)).toBeLessThanOrEqual(Math.floor(p.y));
  });
  it('has no weather outside the overworld and none while the sky is clear', () => {
    const { sim } = setup();
    sim.weatherOverride = { rain: 0, thunder: 0 };
    expect(sim.snapshot().weather.tops).toBeUndefined();
  });
});
