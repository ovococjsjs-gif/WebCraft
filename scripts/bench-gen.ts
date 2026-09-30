import { GeneratorV5 } from '../packages/core/src/worldgen/generator-v5';
import { generateColumn } from '../packages/core/src/terrain';

const now = () => performance.now();
function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    mean: +(sum / s.length).toFixed(1),
    p50: +s[s.length >> 1].toFixed(1),
    p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  };
}
// warm-up (JIT)
const warm = new GeneratorV5('warm', 'overworld');
for (let i = 0; i < 6; i++) warm.chunk(i, i);

const g = new GeneratorV5('bench-seed', 'overworld');
const tBase: number[] = [],
  tFull: number[] = [];
const R = 6;
for (let cx = -R; cx <= R; cx++)
  for (let cz = -R; cz <= R; cz++) {
    let t = now();
    g.base(cx, cz);
    tBase.push(now() - t);
    t = now();
    g.chunk(cx, cz);
    tFull.push(now() - t);
  }
console.log('GeneratorV5.base  (density+caves+ravines), ms/chunk', JSON.stringify(stats(tBase)));
console.log(
  'GeneratorV5.chunk (base cached + features/structures), ms/chunk',
  JSON.stringify(stats(tFull)),
);
const tCol: number[] = [];
for (let cx = 20; cx < 30; cx++)
  for (let cz = 20; cz < 30; cz++) {
    const t = now();
    generateColumn(cx, cz, 'bench-seed2', 'overworld', 5);
    tCol.push(now() - t);
  }
console.log(
  'generateColumn v5 (cold, what the worker calls), ms/chunk',
  JSON.stringify(stats(tCol)),
);
