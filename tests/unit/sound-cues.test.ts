import { describe, it, expect } from 'vitest';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { BLOCK } from '../../packages/content/src/blocks';
import { materialOf } from '../../apps/browser/src/sound/synth';
import { registry } from '../../packages/content/src/blocks';

function setup() {
  const world = new VoxelWorld('test');
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, 'test', 'flat'));
  const sim = new Simulation(world, spawnPoint('test', 'flat'));
  for (let i = 0; i < 5; i++) sim.step();
  return sim;
}
function stateOf(key: string): number {
  for (let id = 0; id < 4096; id++) {
    try {
      if (registry.get(id).key === key) return id;
    } catch {
      break;
    }
  }
  throw new Error(key);
}
const cues = (sim: Simulation) =>
  sim
    .snapshot()
    .visualEvents.filter((e) => e.kind === 'sound')
    .map((e) => e.sound);

describe('sound cues from the simulation', () => {
  it('hears doors, switches, fire and buckets change state', () => {
    const sim = setup();
    sim.setBlockState(3, 9, 3, stateOf('lab:oak_door'));
    sim.setBlockState(3, 10, 3, stateOf('lab:oak_door_north_closed_upper'));
    sim.setBlockState(3, 9, 3, stateOf('lab:oak_door_north_open_lower'));
    sim.setBlockState(3, 10, 3, stateOf('lab:oak_door_north_open_upper'));
    sim.setBlockState(5, 9, 5, BLOCK.LEVER_OFF);
    sim.setBlockState(5, 9, 5, BLOCK.LEVER_ON);
    sim.setBlockState(7, 9, 7, BLOCK.FIRE);
    sim.setBlockState(-3, 9, -3, BLOCK.WATER);
    sim.setBlockState(-3, 9, -3, BLOCK.AIR);
    const heard = cues(sim);
    // One door sound for the pair of halves, not two.
    expect(heard.filter((s) => s === 'door_open')).toHaveLength(1);
    expect(heard).toContain('click_on');
    expect(heard).toContain('ignite');
    expect(heard).toContain('bucket_water');
    expect(heard).toContain('fill_water');
  });
  it('hears a charge being lit once', () => {
    const sim = setup();
    sim.setBlockState(4, 9, 4, BLOCK.TNT);
    sim.blockSim.prime(4, 9, 4);
    sim.blockSim.prime(4, 9, 4);
    expect(cues(sim).filter((s) => s === 'fuse')).toHaveLength(1);
  });
  it('tells the sound engine what surrounds the player', () => {
    const sim = setup();
    const snap = sim.snapshot();
    expect(snap.hearing.sky).toBe(15);
    expect(snap.hearing.lava).toBeNull();
    expect(snap.ground).toBe(BLOCK.GRASS);
    const p = sim.player.position;
    sim.setBlockState(Math.floor(p.x) + 2, Math.floor(p.y), Math.floor(p.z), BLOCK.LAVA);
    for (let i = 0; i < 11; i++) sim.step();
    expect(sim.snapshot().hearing.lava).not.toBeNull();
  });
});

describe('block materials', () => {
  const of = (key: string) => materialOf(stateOf(key));
  it('sorts blocks into the materials they sound like', () => {
    expect(of('lab:grass')).toBe('grass');
    expect(of('lab:stone')).toBe('stone');
    expect(of('lab:cobblestone')).toBe('stone');
    expect(of('lab:oak_planks')).toBe('wood');
    expect(of('lab:oak_log')).toBe('wood');
    expect(of('lab:sand')).toBe('sand');
    expect(of('lab:sandstone')).toBe('stone');
    expect(of('lab:gravel')).toBe('gravel');
    expect(of('lab:glass')).toBe('glass');
    expect(of('lab:oak_leaves')).toBe('leaves');
    expect(of('lab:poppy')).toBe('plant');
    expect(of('lab:snow')).toBe('snow');
    expect(of('lab:iron_block')).toBe('metal');
    expect(of('lab:dirt')).toBe('dirt');
  });
});
