import manifest from '../../../package.json' with { type: 'json' };
/** UI, release packaging and release tests read the same package version. */
export const APP_VERSION = manifest.version;
export const BUILD_LABEL = `BUILD ${String(Number(APP_VERSION.split('.')[1])).padStart(3, '0')}`;
