import {
  MP_PROTOCOL,
  type NetPlayer,
  type NetPose,
  type ServerMessage,
} from '@network/multiplayer';
import type { CoreCheckpoint, SavedOverride } from '@core/persistence';
import { APP_VERSION } from '@content/version';

export type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
export interface OnlineEvents {
  edits(edits: SavedOverride[]): void;
  players(list: NetPlayer[]): void;
  chat(from: string, text: string, system: boolean): void;
  time(time: number): void;
  closed(reason: string): void;
}

/** One connection to a WebCraft server: the handshake, then messages both ways. */
export class OnlineClient {
  private closedByUs = false;
  private rejectReason = '';
  private constructor(
    private readonly ws: WebSocket,
    readonly welcome: Welcome,
    readonly address: string,
  ) {}

  static connect(
    url: string,
    name: string,
    skin: number,
    events: OnlineEvents,
    timeoutMs = 12000,
  ): Promise<OnlineClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('Неверный адрес сервера.'));
        return;
      }
      let client: OnlineClient | null = null;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        reject(new Error(message));
      };
      const timer = setTimeout(
        () => fail('Сервер не ответил. Проверь IP, порт и что сервер запущен.'),
        timeoutMs,
      );
      ws.onopen = () =>
        ws.send(
          JSON.stringify({ t: 'hello', protocol: MP_PROTOCOL, version: APP_VERSION, name, skin }),
        );
      ws.onerror = () =>
        fail(
          'Не удалось подключиться. Проверь адрес, что сервер запущен и что вы в одной сети (Radmin VPN / Hamachi).',
        );
      ws.onclose = () => {
        if (!settled) fail('Сервер закрыл соединение.');
        else if (client && !client.closedByUs)
          events.closed(client.rejectReason || 'Соединение с сервером потеряно.');
      };
      ws.onmessage = (event) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!client) {
          if (m.t === 'reject') return fail(m.reason);
          if (m.t !== 'welcome') return;
          settled = true;
          clearTimeout(timer);
          client = new OnlineClient(ws, m, url);
          resolve(client);
          return;
        }
        switch (m.t) {
          case 'edits':
            events.edits(m.edits);
            break;
          case 'players':
            events.players(m.list);
            break;
          case 'chat':
            events.chat(m.from, m.text, !!m.system);
            break;
          case 'time':
            events.time(m.time);
            break;
          case 'join':
          case 'leave':
            break;
          case 'reject':
            client.rejectReason = m.reason;
            break;
        }
      };
    });
  }

  get id() {
    return this.welcome.id;
  }
  get open() {
    return this.ws.readyState === WebSocket.OPEN;
  }
  private post(message: object) {
    if (this.open) this.ws.send(JSON.stringify(message));
  }
  pose(pose: NetPose) {
    this.post({ t: 'pose', ...pose });
  }
  edits(edits: SavedOverride[]) {
    for (let i = 0; i < edits.length; i += 4096)
      this.post({ t: 'edits', edits: edits.slice(i, i + 4096) });
  }
  chat(text: string) {
    this.post({ t: 'chat', text });
  }
  /** The player's own state; the shared blocks are the server's, so they are left out. */
  save(checkpoint: CoreCheckpoint) {
    this.post({ t: 'save', checkpoint: { ...checkpoint, overrides: [] } });
  }
  close() {
    this.closedByUs = true;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
