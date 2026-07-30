/**
 * Generates the extension icon set into public/icons/ with no image
 * dependencies: shapes are rasterised by point-sampling and PNGs are written
 * with Node's own zlib. Re-run with `npm run icons` after changing the mark;
 * the output is deterministic, so a no-op change produces no diff.
 *
 * The mark is the front door of the memory house: an amber arch with a
 * keyhole, on the app's ink background. Chrome uses 16/32 in the toolbar and
 * omnibox, 48 on the extensions page, and 128 in the store listing.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const INK = [0x2b, 0x23, 0x37]
const AMBER = [0xe8, 0xa0, 0x3d]
const PARCHMENT = [0xf6, 0xef, 0xe3]

const SAMPLES = 4 // per axis, so 16 samples per pixel

/** Icon geometry in a 0..1 square, so every size renders identically. */
function colorAt(x, y, { rounded }) {
  // Rounded-square backdrop. Maskable/apple icons are full-bleed instead.
  if (rounded && outsideRoundedSquare(x, y, 0.18)) return null

  // Doorway: arch (half circle) on top of a rectangle.
  const doorLeft = 0.28
  const doorRight = 0.72
  const doorBottom = 0.82
  const archCenterY = 0.42
  const archRadius = (doorRight - doorLeft) / 2
  const inArch = dist(x, y, 0.5, archCenterY) <= archRadius && y <= archCenterY
  const inShaft = x >= doorLeft && x <= doorRight && y >= archCenterY && y <= doorBottom

  if (inArch || inShaft) {
    // Keyhole: a circle with a tapered stem below it.
    const inKeyCircle = dist(x, y, 0.5, 0.5) <= 0.072
    const stemTop = 0.5
    const stemBottom = 0.68
    const stemHalf = 0.028 + 0.036 * ((y - stemTop) / (stemBottom - stemTop))
    const inStem = y >= stemTop && y <= stemBottom && Math.abs(x - 0.5) <= stemHalf
    if (inKeyCircle || inStem) return INK

    // Threshold line at the foot of the door, in parchment.
    if (y >= 0.775 && y <= doorBottom) return PARCHMENT
    return AMBER
  }

  return INK
}

function dist(x, y, cx, cy) {
  return Math.hypot(x - cx, y - cy)
}

function outsideRoundedSquare(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r))
  const dy = Math.max(r - y, 0, y - (1 - r))
  return Math.hypot(dx, dy) > r
}

function render(size, opts) {
  // RGBA, top-down, one filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let py = 0; py < size; py++) {
    const rowStart = py * (size * 4 + 1)
    raw[rowStart] = 0
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size
          const y = (py + (sy + 0.5) / SAMPLES) / size
          const c = colorAt(x, y, opts)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            hits++
          }
        }
      }
      const total = SAMPLES * SAMPLES
      const alpha = Math.round((hits / total) * 255)
      const o = rowStart + 1 + px * 4
      // Premultiplied averaging over covered samples keeps edges clean.
      raw[o] = hits ? Math.round(r / hits) : 0
      raw[o + 1] = hits ? Math.round(g / hits) : 0
      raw[o + 2] = hits ? Math.round(b / hits) : 0
      raw[o + 3] = alpha
    }
  }
  return encodePng(size, size, raw)
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const targets = [
  // At 16px the rounded corners just eat pixels, so the small sizes are square.
  { file: 'icon-16.png', size: 16, rounded: false },
  { file: 'icon-32.png', size: 32, rounded: false },
  { file: 'icon-48.png', size: 48, rounded: true },
  { file: 'icon-128.png', size: 128, rounded: true },
]

for (const { file, size, rounded } of targets) {
  writeFileSync(join(outDir, file), render(size, { rounded }))
  console.log(`wrote ${file} (${size}x${size})`)
}
