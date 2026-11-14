(() => {
'use strict';
// Liten QR-kodare utan beroenden: byte-läge, felkorrigering M, version 1–10 (räcker för en LAN-adress).
// Per version: [EC-kodord per block, antal block grupp 1, dataord grupp 1, antal block grupp 2, dataord grupp 2]
const EC = [null,[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]];
const ALIGN = [null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); } g = next; } return g; }
function rsEncode(data, n) { const g = rsGen(n), rem = new Array(n).fill(0); for (const d of data) { const f = d ^ rem.shift(); rem.push(0); for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f); } return rem; }
function codewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  for (; v <= 10; v++) { const [, b1, d1, b2, d2] = EC[v]; if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= (b1 * d1 + b2 * d2) * 8) break; }
  if (v > 10) throw Error('Texten är för lång för QR-koden.');
  const [ec, b1, d1, b2, d2] = EC[v], cap = b1 * d1 + b2 * d2, bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let p = 0; data.length < cap; p++) data.push(p % 2 ? 0x11 : 0xEC);
  const blocks = []; let k = 0;
  for (let i = 0; i < b1 + b2; i++) { const d = data.slice(k, k += i < b1 ? d1 : d2); blocks.push({ d, e: rsEncode(d, ec) }); }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return { v, out };
}
const MASKS = [(r,c) => (r + c) % 2 === 0, r => r % 2 === 0, (r,c) => c % 3 === 0, (r,c) => (r + c) % 3 === 0, (r,c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r,c) => (r * c) % 2 + (r * c) % 3 === 0, (r,c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r,c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
function penalty(m) {
  const n = m.length; let score = 0, dark = 0;
  const lines = []; for (let i = 0; i < n; i++) { lines.push(m[i]); lines.push(m.map(row => row[i])); }
  const finderA = [1,0,1,1,1,0,1,0,0,0,0], finderB = [0,0,0,0,1,0,1,1,1,0,1];
  for (const line of lines) {
    for (let i = 0, run = 1; i < n; i++) { if (i > 0 && line[i] === line[i - 1]) run++; else run = 1; if (run === 5) score += 3; else if (run > 5) score++; }
    for (let i = 0; i + 11 <= n; i++) for (const pat of [finderA, finderB]) if (pat.every((b, j) => +line[i + j] === b)) score += 40;
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  for (const row of m) for (const x of row) if (x) dark++;
  return score + 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
}
function matrix(text) {
  const { v, out } = codewords(text), n = 17 + 4 * v;
  const m = [...Array(n)].map(() => new Array(n).fill(false)), fn = [...Array(n)].map(() => new Array(n).fill(false));
  const set = (r, c, val) => { m[r][c] = val; fn[r][c] = true; };
  const finder = (r0, c0) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const r = r0 + i, c = c0 + j; if (r < 0 || c < 0 || r >= n || c >= n) continue; const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3)); set(r, c, ring !== 2 && ring !== 4); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v], last = al[al.length - 1];
  for (const r of al) for (const c of al) { if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }
  for (let i = 0; i < 9; i++) if (i !== 6) { set(8, i, false); set(i, 8, false); } // rad/kolumn 6 är tidsmönster
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i, false); set(n - 1 - i, 8, false); }
  set(n - 8, 8, true);
  if (v >= 7) { let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25); const bits = (v << 12) | rem; for (let i = 0; i < 18; i++) { const bit = ((bits >>> i) & 1) === 1, a = n - 11 + i % 3, b = Math.floor(i / 3); set(b, a, bit); set(a, b, bit); } }
  const total = out.length * 8; let idx = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const c = right - j, r = upward ? n - 1 - vert : vert;
      if (fn[r][c]) continue;
      m[r][c] = idx < total && ((out[idx >> 3] >>> (7 - (idx & 7))) & 1) === 1; idx++;
    }
  }
  const withMask = mask => {
    const q = m.map((row, r) => row.map((x, c) => fn[r][c] ? x : x !== MASKS[mask](r, c)));
    const data = mask; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412, bit = i => ((bits >>> i) & 1) === 1; // nivå M = 00
    for (let i = 0; i <= 5; i++) q[i][8] = bit(i);
    q[7][8] = bit(6); q[8][8] = bit(7); q[8][7] = bit(8);
    for (let i = 9; i < 15; i++) q[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) q[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) q[n - 15 + i][8] = bit(i);
    q[n - 8][8] = true;
    return q;
  };
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) { const q = withMask(mask), s = penalty(q); if (s < bestScore) { best = q; bestScore = s; } }
  return best;
}
function svg(text) {
  const m = matrix(text), n = m.length, pad = 4, size = n + pad * 2; let d = '';
  m.forEach((row, r) => row.forEach((x, c) => { if (x) d += `M${c + pad} ${r + pad}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-kod"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
const api = { matrix, svg };
if (typeof window !== 'undefined') window.QR = api;
if (typeof module !== 'undefined') module.exports = api;
})();
