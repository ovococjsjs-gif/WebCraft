import { VoxelWorld } from './world';
import { generateColumn, spawnPoint } from './terrain';
import { Simulation } from './simulation';
import { EMPTY_INPUT } from './player';
import { BLOCK } from '../../content/src/blocks';
import { seedHash } from './random';
export function runCoreFixture() {
  const world = new VoxelWorld('fixture-01');
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, world.seed, 'flat'));
  world.setBlock(-1, 9, -1, BLOCK.LOG);
  world.setBlock(-16, 10, 0, BLOCK.GLASS);
  const sim = new Simulation(world, spawnPoint(world.seed, 'flat'));
  for (let i = 0; i < 120; i++) {
    sim.setInput({
      ...EMPTY_INPUT,
      forward: i < 60 ? 1 : 0,
      strafe: i >= 60 && i < 85 ? -1 : 0,
      jump: i === 15,
      yaw: 0.2,
    });
    sim.step();
  }
  const state = {
    tick: world.tick,
    position: Object.fromEntries(
      Object.entries(sim.player.position).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]),
    ),
    boundary: [world.getBlock(-1, 9, -1), world.getBlock(-16, 10, 0), world.getBlock(0, 8, 0)],
    columns: world.columns.size,
  };
  return { ...state, digest: seedHash(JSON.stringify(state)).toString(16).padStart(8, '0') };
}
