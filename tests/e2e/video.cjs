// Makes small fake-camera videos (.y4m) for Chromium's --use-file-for-fake-video-capture.
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = 320, H = 240, FPS = 10;

function y4m(name, seconds, draw) {
  const file = path.join(os.tmpdir(), `sentinel-${name}.y4m`);
  if (fs.existsSync(file)) return file;
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  const y = Buffer.alloc(W * H), uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  for (let f = 0; f < seconds * FPS; f++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) y[j * W + i] = draw(f, i, j);
    fs.writeSync(fd, 'FRAME\n'); fs.writeSync(fd, y); fs.writeSync(fd, uv);
  }
  fs.closeSync(fd);
  return file;
}
const texture = (i, j) => 80 + ((i * 7 + j * 13) % 23);
exports.still = () => y4m('still', 3, (f, i, j) => texture(i, j));
// A bright "person" walking left↔right across the middle of the room.
exports.moving = () => y4m('moving', 6, (f, i, j) => { const x = 20 + Math.abs(((f * 12) % 520) - 260); return i > x && i < x + 50 && j > 70 && j < 200 ? 235 : texture(i, j); });
// Lights off for 3 s, on for 3 s.
exports.lights = () => y4m('lights', 6, (f, i, j) => (f < 30 ? 18 : 205) + ((i + j) % 9));

// A loud steady 440 Hz tone (.wav) for --use-file-for-fake-audio-capture (Chromium loops it).
exports.tone = () => {
  const file = path.join(os.tmpdir(), 'sentinel-tone.wav');
  const rate = 16000, n = rate * 2, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 20000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
};
