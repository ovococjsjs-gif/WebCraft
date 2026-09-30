/**
 * Block models that are not full cubes: snow layers, slabs, stairs, fences, panes and doors.
 *
 * A block state stays a single number (the world format has no metadata): every orientation of
 * a stair or a door is its own state, the way later editions "flattened" their block states. The
 * model describes the geometry once, and the same boxes feed the mesher, the collision of the
 * player and the creatures, and the ray that picks the aimed block. Connecting models (fences
 * and panes) read their neighbours, so they need no extra states at all.
 */
export type Facing = 'north' | 'east' | 'south' | 'west';
export const FACINGS: readonly Facing[] = ['north', 'east', 'south', 'west'];
/** Unit vector of a facing on the horizontal plane; north is -z as in the reference. */
export const FACING_VECTOR: Record<Facing, readonly [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};
export function facingOfYaw(yaw: number): Facing {
  // Yaw 0 looks towards -z (north) in this engine; positive yaw turns towards -x (west).
  const turn = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  return (['north', 'west', 'south', 'east'] as const)[turn];
}
export function rotateFacing(facing: Facing, quarterTurnsClockwise: number): Facing {
  const index = FACINGS.indexOf(facing);
  return FACINGS[(((index + quarterTurnsClockwise) % 4) + 4) % 4];
}
export function oppositeFacing(facing: Facing): Facing {
  return rotateFacing(facing, 2);
}

export type BlockModel =
  /** A thin cover on the floor: snow layers. `height` is in blocks. */
  | { readonly kind: 'layer'; readonly height: number }
  | { readonly kind: 'slab'; readonly half: 'bottom' | 'top' }
  /** `facing` is the side of the tall back: a player walking that way climbs the stair. */
  | { readonly kind: 'stairs'; readonly facing: Facing; readonly half: 'bottom' | 'top' }
  | { readonly kind: 'fence' }
  | { readonly kind: 'pane' }
  /**
   * `facing` is the direction the player looked when placing. A closed door lies against the
   * far side of its cell; an open one swings to the side of its hinge.
   */
  /** Fixed boxes: trapdoors, gates, ladders, the cake. `collision` defaults to the boxes. */
  | {
      readonly kind: 'boxes';
      readonly boxes: readonly Box[];
      readonly collision?: readonly Box[];
    }
  /** Cobblestone walls: a thick post with low thick arms towards what they join. */
  | { readonly kind: 'wall' }
  | {
      readonly kind: 'door';
      readonly facing: Facing;
      readonly open: boolean;
      readonly upper: boolean;
    };

/** An axis-aligned box inside the cell, in blocks: [x0, y0, z0, x1, y1, z1]. */
export type Box = readonly [number, number, number, number, number, number];

/** What a connecting model may join. The caller answers for the neighbour on each side. */
export interface Neighbours {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}
const NONE: Neighbours = { north: false, east: false, south: false, west: false };

function stairsBoxes(facing: Facing, half: 'bottom' | 'top'): Box[] {
  const base: Box = half === 'bottom' ? [0, 0, 0, 1, 0.5, 1] : [0, 0.5, 0, 1, 1, 1];
  const y0 = half === 'bottom' ? 0.5 : 0,
    y1 = half === 'bottom' ? 1 : 0.5;
  const step: Box =
    facing === 'north'
      ? [0, y0, 0, 1, y1, 0.5]
      : facing === 'south'
        ? [0, y0, 0.5, 1, y1, 1]
        : facing === 'east'
          ? [0.5, y0, 0, 1, y1, 1]
          : [0, y0, 0, 0.5, y1, 1];
  return [base, step];
}
const DOOR = 3 / 16;
function doorBox(model: Extract<BlockModel, { kind: 'door' }>): Box {
  // Closed: against the far side of the cell, seen from where the player stood.
  // Open: turned a quarter clockwise, flat against the hinge side.
  const side = model.open ? rotateFacing(model.facing, 1) : model.facing;
  switch (side) {
    case 'north':
      return [0, 0, 0, 1, 1, DOOR];
    case 'south':
      return [0, 0, 1 - DOOR, 1, 1, 1];
    case 'east':
      return [1 - DOOR, 0, 0, 1, 1, 1];
    case 'west':
      return [0, 0, 0, DOOR, 1, 1];
  }
}
function connectorBoxes(
  post: number,
  arm: number,
  armLow: number,
  armHigh: number,
  top: number,
  n: Neighbours,
): Box[] {
  const a = 0.5 - post / 2,
    b = 0.5 + post / 2;
  const boxes: Box[] = [[a, 0, a, b, top, b]];
  const c = 0.5 - arm / 2,
    d = 0.5 + arm / 2;
  for (const [low, high] of [[armLow, armHigh]] as const) {
    if (n.north) boxes.push([c, low, 0, d, high, a]);
    if (n.south) boxes.push([c, low, b, d, high, 1]);
    if (n.west) boxes.push([0, low, c, a, high, d]);
    if (n.east) boxes.push([b, low, c, 1, high, d]);
  }
  return boxes;
}
/** Boxes that are drawn. Fences draw two rails per side; panes one thin sheet. */
export function renderBoxes(model: BlockModel, n: Neighbours = NONE): Box[] {
  switch (model.kind) {
    case 'layer':
      return [[0, 0, 0, 1, model.height, 1]];
    case 'slab':
      return [model.half === 'bottom' ? [0, 0, 0, 1, 0.5, 1] : [0, 0.5, 0, 1, 1, 1]];
    case 'stairs':
      return stairsBoxes(model.facing, model.half);
    case 'fence': {
      const boxes = connectorBoxes(0.25, 0.125, 0.75, 0.9375, 1, NONE);
      const rail = (low: number, high: number) => connectorBoxes(0.25, 0.125, low, high, 1, n);
      boxes.push(...rail(0.375, 0.5625).slice(1), ...rail(0.75, 0.9375).slice(1));
      return boxes;
    }
    case 'pane': {
      const any = n.north || n.south || n.east || n.west;
      if (!any)
        return connectorBoxes(0.125, 0.125, 0, 1, 1, {
          north: true,
          east: true,
          south: true,
          west: true,
        });
      return connectorBoxes(0.125, 0.125, 0, 1, 1, n);
    }
    case 'door':
      return [doorBox(model)];
    case 'boxes':
      return [...model.boxes];
    case 'wall': {
      const straight =
        (n.north && n.south && !n.east && !n.west) || (n.east && n.west && !n.north && !n.south);
      const arms = connectorBoxes(0.5, 0.375, 0, 0.8125, 1, n);
      // A straight run of wall has no post, as in the reference.
      if (straight) return connectorBoxes(0.375, 0.375, 0, 0.8125, 0.8125, n);
      return arms;
    }
  }
}
/**
 * Boxes that stop a body. Fences are one and a half blocks tall, like the reference, so a
 * creature cannot hop over them; a thin snow layer is walked through.
 */
export function collisionBoxes(model: BlockModel, n: Neighbours = NONE): Box[] {
  switch (model.kind) {
    case 'layer':
      // The reference gives a one-layer snow cover no collision height at all.
      return model.height <= 0.125 ? [] : [[0, 0, 0, 1, model.height - 0.125, 1]];
    case 'fence': {
      const a = 0.375,
        b = 0.625;
      const boxes: Box[] = [[a, 0, a, b, 1.5, b]];
      if (n.north) boxes.push([a, 0, 0, b, 1.5, a]);
      if (n.south) boxes.push([a, 0, b, b, 1.5, 1]);
      if (n.west) boxes.push([0, 0, a, a, 1.5, b]);
      if (n.east) boxes.push([b, 0, a, 1, 1.5, b]);
      return boxes;
    }
    case 'boxes':
      return [...(model.collision ?? model.boxes)];
    case 'wall': {
      const a = 0.25,
        b = 0.75,
        c = 0.3125,
        d = 0.6875;
      const boxes: Box[] = [[a, 0, a, b, 1.5, b]];
      if (n.north) boxes.push([c, 0, 0, d, 1.5, a]);
      if (n.south) boxes.push([c, 0, b, d, 1.5, 1]);
      if (n.west) boxes.push([0, 0, c, a, 1.5, d]);
      if (n.east) boxes.push([b, 0, c, 1, 1.5, d]);
      return boxes;
    }
    default:
      return renderBoxes(model, n);
  }
}
/** Tallest point of the collision, used to widen the collision query below the body. */
export const MAX_COLLISION_HEIGHT = 1.5;
