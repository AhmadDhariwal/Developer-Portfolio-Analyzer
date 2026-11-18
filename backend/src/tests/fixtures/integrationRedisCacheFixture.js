'use strict';
// Small RESP transport fixture for the real node-redis/cache client. It models
// cache commands and failures only, not Redis admission or server performance.
const net = require('node:net');

function parse(buffer) {
  const line = (offset) => {
    const end = buffer.indexOf('\r\n', offset);
    return end < 0 ? null : { value: buffer.toString('utf8', offset, end), next: end + 2 };
  };
  const header = line(0);
  if (!header) return null;
  if (!header.value.startsWith('*')) throw Error('RESP array required');
  const count = Number(header.value.slice(1));
  let offset = header.next;
  const parts = [];
  for (let index = 0; index < count; index++) {
    const size = line(offset);
    if (!size) return null;
    if (!size.value.startsWith('$')) throw Error('RESP bulk string required');
    const length = Number(size.value.slice(1));
    if (buffer.length < size.next + length + 2) return null;
    parts.push(buffer.toString('utf8', size.next, size.next + length));
    offset = size.next + length + 2;
  }
  return { parts, bytes: offset };
}

async function start(mode = 'healthy') {
  const sockets = new Set();
  const values = new Map();
  const commands = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      try {
        let parsed;
        while ((parsed = parse(pending))) {
          pending = pending.subarray(parsed.bytes);
          const [command, key, value, ...options] = parsed.parts;
          const name = command.toUpperCase();
          // Keep the cache-only script distinct from unsupported admission scripts.
          const readWithTtl =
            name === 'EVAL' &&
            value === '1' &&
            key ===
              "local value = redis.call('GET', KEYS[1]); if not value then return {false, -2} end; return {value, redis.call('PTTL', KEYS[1])}";
          commands.push(readWithTtl ? 'EVAL_GET_PTTL' : name);
          if (mode === 'timeout' && !['CLIENT', 'PING', 'QUIT'].includes(name)) continue;
          if (mode === 'quota' && ['SET', 'DEL'].includes(name)) {
            socket.write('-ERR max requests limit exceeded\r\n');
            continue;
          }
          switch (name) {
            case 'CLIENT':
            case 'AUTH':
            case 'SELECT':
              socket.write('+OK\r\n');
              break;
            case 'PING':
              socket.write('+PONG\r\n');
              break;
            case 'SET': {
              const index = options.findIndex((part) => ['EX', 'PX'].includes(part.toUpperCase()));
              const ttl =
                index < 0
                  ? 60000
                  : Number(options[index + 1]) * (options[index].toUpperCase() === 'EX' ? 1000 : 1);
              values.set(key, { value, expiresAt: Date.now() + ttl });
              socket.write('+OK\r\n');
              break;
            }
            case 'GET': {
              const entry = values.get(key);
              socket.write(
                entry && entry.expiresAt > Date.now()
                  ? `$${Buffer.byteLength(entry.value)}\r\n${entry.value}\r\n`
                  : '$-1\r\n'
              );
              break;
            }
            case 'EVAL': {
              const redisKey = options[0];
              if (!readWithTtl) {
                socket.write('-ERR unsupported fixture script\r\n');
                break;
              }
              const entry = values.get(redisKey);
              const ttl = entry ? entry.expiresAt - Date.now() : -2;
              socket.write(
                ttl > 0
                  ? `*2\r\n$${Buffer.byteLength(entry.value)}\r\n${entry.value}\r\n:${ttl}\r\n`
                  : '*2\r\n$-1\r\n:-2\r\n'
              );
              break;
            }
            case 'DEL':
              socket.write(`:${Number(values.delete(key))}\r\n`);
              break;
            case 'QUIT':
              socket.end('+OK\r\n');
              break;
            default:
              socket.write('-ERR unsupported fixture command\r\n');
          }
        }
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `redis://127.0.0.1:${server.address().port}`,
    commands,
    async stop() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  };
}

module.exports = { start };
