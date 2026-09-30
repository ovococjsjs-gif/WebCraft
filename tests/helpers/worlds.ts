import { WorldSession } from '../../packages/core/src/session';
import { defaultClient, type WorldPayload } from '../../packages/storage/src/format';
import { BLOCK } from '../../packages/content/src/blocks';
export function payload(name = 'Test world'): WorldPayload {
  const session = new WorldSession('fixture-save-01', 'flat');
  session.loadColumn(0, 0);
  session.loadColumn(-1, 0);
  session.world.setBlock(-1, 11, 3, BLOCK.GLASS);
  session.world.setBlock(4, 8, 6, BLOCK.AIR);
  session.world.tick = 17;
  session.world.scheduler.schedule(40, 'test:event', { x: -1, key: 'value' });
  return {
    name,
    createdAt: 1700000000000,
    savedAt: 1700000005000,
    core: session.checkpoint(),
    client: defaultClient(2),
  };
}
