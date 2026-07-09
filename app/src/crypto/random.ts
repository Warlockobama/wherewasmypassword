export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Uniform random integer in [0, maxExclusive) via rejection sampling —
 * a plain modulo would bias low values and shave entropy off the phrase.
 */
export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0 || maxExclusive > 0x100000000) {
    throw new RangeError(`maxExclusive out of range: ${maxExclusive}`)
  }
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % maxExclusive
  }
}
