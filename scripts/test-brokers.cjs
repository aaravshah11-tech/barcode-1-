// Two local MQTT-over-WebSocket relays for the browser tests (quick-link sync uses two relays).
// Usage: node scripts/test-brokers.cjs 8888 8889
const ws = require('websocket-stream');
const ports = process.argv.slice(2).map(Number).filter(Boolean);
for (const port of ports.length ? ports : [8888, 8889]) {
  const aedes = require('aedes')();
  ws.createServer({ host: '127.0.0.1', port }, aedes.handle);
  console.log(`test relay on ws://127.0.0.1:${port}`);
}
