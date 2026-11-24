// Run with: node --test
// Checks the engine's float16 conversions against the native Float16Array.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEngine() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ocr-engine.js'), 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx, { filename: 'ocr-engine.js' });
  return ctx.window.LoupeEngine._internal;
}

const engine = loadEngine();
const IMPLS = [
  ['default', engine.f16ToF32, engine.f32ToF16],
  ['soft fallback', engine.f16ToF32Soft, engine.f32ToF16Soft],
];

function bitsOf(f32) {
  return new Uint32Array(Float32Array.of(f32).buffer)[0];
}

for (const [name, f16ToF32, f32ToF16] of IMPLS) {

test(`${name}: f16ToF32 decodes every f16 bit pattern`, () => {
  const all = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) all[i] = i;
  const ref = new Float16Array(all.buffer);
  const got = f16ToF32(all);
  for (let i = 0; i < 65536; i++) {
    if (Number.isNaN(ref[i])) {
      assert.ok(Number.isNaN(got[i]), `0x${i.toString(16)} should be NaN`);
    } else {
      assert.strictEqual(bitsOf(got[i]), bitsOf(ref[i]),
        `0x${i.toString(16)}: got ${got[i]}, expected ${ref[i]}`);
    }
  }
});

test(`${name}: f16ToF32 respects the view offset`, () => {
  const buf = Uint16Array.of(0x3c00, 0x0001, 0xc000, 0x7bff);
  assert.deepStrictEqual(Array.from(f16ToF32(buf.subarray(1, 3))), [2 ** -24, -2]);
});

function checkEncode(values) {
  const f32 = Float32Array.from(values);
  const got = f32ToF16(f32);
  const ref = new Uint16Array(Float16Array.from(f32).buffer);
  for (let i = 0; i < f32.length; i++) {
    if (Number.isNaN(f32[i])) {
      assert.ok((got[i] & 0x7c00) === 0x7c00 && (got[i] & 0x3ff) !== 0, `NaN should stay NaN`);
    } else {
      assert.strictEqual(got[i], ref[i],
        `${f32[i]} (0x${bitsOf(f32[i]).toString(16)}): got 0x${got[i].toString(16)}, expected 0x${ref[i].toString(16)}`);
    }
  }
}

test(`${name}: f32ToF16 round-trips every f16 value`, () => {
  const all = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) all[i] = i;
  checkEncode(Array.from(new Float16Array(all.buffer)));
});

test(`${name}: f32ToF16 rounds to nearest even, including subnormals and overflow`, () => {
  const vals = [];
  // midpoints and near-midpoints between consecutive f16 values (covers ties and subnormals)
  const all = new Uint16Array(0x7c00);
  for (let i = 0; i < 0x7c00; i++) all[i] = i;
  const pos = new Float16Array(all.buffer);
  for (let i = 0; i + 1 < pos.length; i++) {
    const mid = (pos[i] + pos[i + 1]) / 2;
    const midF32 = Math.fround(mid);
    vals.push(midF32, -midF32);
    const b = bitsOf(midF32);
    for (const d of [-1, 1]) {
      const v = new Float32Array(new Uint32Array([b + d]).buffer)[0];
      vals.push(v, -v);
    }
  }
  // below the smallest subnormal, around the f16 max, beyond it
  vals.push(1e-10, 2 ** -25, 2 ** -25 * 1.0001, 2 ** -24 * 0.75, 65504, 65519.99, 65520, 1e6, Infinity, -Infinity, NaN, 0, -0);
  // random f32 values over a wide exponent range
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let i = 0; i < 200000; i++) vals.push((rnd() - 0.5) * 2 ** Math.floor(rnd() * 60 - 40));
  checkEncode(vals);
});

}
