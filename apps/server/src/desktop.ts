/**
 * Desktop mode (WebCraft.exe): the server opens the game in its own window, like an application.
 * Edge (present on every Windows 10/11) or Chrome runs in app mode with a separate profile, so
 * there is no address bar, and closing that window shuts the server down with the world saved.
 * Without such a browser the default one opens the page and the console window stays in charge.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function windowsBrowsers(): string[] {
  const roots = [
    process.env['PROGRAMFILES(X86)'],
    process.env.PROGRAMFILES,
    process.env.LOCALAPPDATA,
  ].filter((r): r is string => !!r);
  const apps = [
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Yandex', 'YandexBrowser', 'Application', 'browser.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ];
  return apps.flatMap((parts) => roots.map((root) => join(root, ...parts)));
}
const unixBrowsers = [
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** A Chromium-family browser that can open an application window, if one is installed. */
export function findAppBrowser(): string | null {
  const list = process.platform === 'win32' ? windowsBrowsers() : unixBrowsers;
  return list.find((file) => existsSync(file)) ?? null;
}

function openDefault(url: string) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args as string[], {
      stdio: 'ignore',
      detached: true,
      windowsVerbatimArguments: true,
    }).unref();
  } catch {
    /* the address is printed in the console anyway */
  }
}

/**
 * Opens the game window. `closed` is called when the player closes it — unless the browser
 * handed the window over to an instance that was already running (it then exits at once),
 * in which case the console window remains the way to stop the server.
 */
export function openGameWindow(
  url: string,
  profileDir: string,
  closed: () => void,
): 'app' | 'browser' {
  const browser = findAppBrowser();
  if (!browser) {
    openDefault(url);
    return 'browser';
  }
  mkdirSync(profileDir, { recursive: true });
  const started = Date.now();
  const child = spawn(
    browser,
    [
      `--app=${url}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--disable-features=Translate,msEdgeStartupBoost',
      '--window-size=1280,800',
    ],
    { stdio: 'ignore' },
  );
  child.on('error', () => openDefault(url));
  child.on('exit', () => {
    if (Date.now() - started > 4000) closed();
  });
  return 'app';
}

/** Keeps a double-clicked console open long enough to read what went wrong. */
export function waitForEnter(message: string): Promise<void> {
  console.log(`\n  ${message}`);
  if (!process.stdin.isTTY) return Promise.resolve();
  return new Promise((done) => {
    process.stdin.resume();
    process.stdin.once('data', () => done());
  });
}
