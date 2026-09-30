import { resolve } from 'node:path';
/** Shared aliases for the dev server, worker build and Node regression tests. */
export const aliases = Object.fromEntries(
  ['core', 'content', 'renderer', 'network', 'ui', 'storage'].map((name) => [
    `@${name}`,
    resolve(`packages/${name}/src`),
  ]),
);
