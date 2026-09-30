import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * A small RFC 6455 WebSocket endpoint: text messages, fragmentation, ping/pong and close. Enough
 * for the game protocol without a dependency, so the server stays one file that Node runs as is.
 */
export class WsConnection {
  onmessage?: (text: string) => void;
  onclose?: () => void;
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private closed = false;

  constructor(
    private readonly socket: Duplex,
    private readonly maxMessage: number,
  ) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  get open() {
    return !this.closed;
  }
  send(text: string) {
    if (this.closed) return;
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.frame(0x8, body);
    this.socket.end();
    this.finish();
  }
  /** Bytes queued in the socket but not yet sent: a slow client is dropped, not buffered forever. */
  get backlog() {
    return (this.socket as unknown as { writableLength?: number }).writableLength ?? 0;
  }

  private finish() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onclose?.();
  }
  private frame(opcode: number, payload: Buffer) {
    const length = payload.length;
    const head =
      length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    if (length < 126) head[1] = length;
    else if (length < 65536) {
      head[1] = 126;
      head.writeUInt16BE(length, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }
  private receive(chunk: Buffer) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let length = b[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxMessage)) return this.close(1009, 'too big');
        length = Number(big);
        offset = 10;
      }
      // Browsers always mask what they send; an unmasked client frame is a protocol error.
      if (!masked) return this.close(1002, 'mask');
      if (length > this.maxMessage || this.fragmentBytes + length > this.maxMessage)
        return this.close(1009, 'too big');
      if (b.length < offset + 4 + length) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(offset + 4 + length);
      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        this.fragments.push(payload);
        this.fragmentBytes += payload.length;
        if (fin) {
          const whole = Buffer.concat(this.fragments);
          this.fragments = [];
          this.fragmentBytes = 0;
          this.onmessage?.(whole.toString('utf8'));
        }
        continue;
      }
      return this.close(1003, 'opcode');
    }
  }
}

/** Completes the HTTP upgrade handshake; returns null (and answers 400) for a bad request. */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  maxMessage: number,
): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WsConnection(socket, maxMessage);
}
