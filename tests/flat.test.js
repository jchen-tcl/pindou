const { test } = require('node:test')
const assert = require('node:assert/strict')
const { flattenColors, quantizeFlat } = require('../utils/flat')

const white = [255, 255, 255], black = [0, 0, 0]
const blue = [120, 164, 180], pink = [250, 185, 205]
const palette = [white, black, blue, pink].map((rgb, index) => ({ rgb, index }))
const key = rgb => rgb.join(',')

test('pastel body fills remain distinct from white at every grid and palette size', () => {
  const { getPalette } = require('../utils/colors')
  for (const grid of [32, 48, 64, 128]) {
    const width = grid * 3
    for (const version of ['221', '291']) {
      const beads = getPalette(version).map((c, index) => ({ ...c, index,
        rgb: c.code.slice(1).match(/../g).map(v => parseInt(v, 16)) }))
      const cream = beads.find(c => c.id === 'A1')
      const pixels = Array(width * width).fill(white)
      block(pixels, width, grid, grid, grid, cream.rgb)
      const result = quantizeFlat(pixels, width, grid, beads, 16)
      assert.equal(result[Math.floor(grid / 2) * grid + Math.floor(grid / 2)].id, 'A1')
      assert.equal(result[0].id, 'H2')
    }
  }
})

test('light pink and blue fills survive while near-white noise still merges', () => {
  for (const pastel of [[255, 220, 230], [210, 240, 255]]) {
    const pixels = Array(60 * 60).fill(white)
    block(pixels, 60, 20, 20, 20, pastel)
    block(pixels, 60, 2, 2, 6, [251, 252, 249])
    const result = flattenColors(pixels, 60)
    assert.equal(key(result[30 * 60 + 30]), key(pastel))
    assert.equal(key(result[3 * 60 + 3]), key(white))
    assert.equal(new Set(result.map(key)).size, 2)
  }
})
function block(pixels, width, x, y, size, rgb) {
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    pixels[(y + dy) * width + x + dx] = rgb
  }
}

test('flat fill merges near-color specks without changing the source or inventing colors', () => {
  const pixels = Array.from({ length: 900 }, (_, i) => i % 30 < 15 ? blue : white)
  pixels[306] = [125, 174, 180]
  pixels[336] = [125, 174, 180]
  const copy = pixels.map(rgb => rgb.slice())
  const result = flattenColors(pixels, 30)
  assert.equal(key(result[306]), key(blue))
  assert.deepEqual(new Set(result.map(key)), new Set([key(blue), key(white)]))
  assert.deepEqual(pixels, copy)
})

test('neutral antialiasing stays neutral beside a colored fill', () => {
  const pixels = Array.from({ length: 900 }, (_, i) => i % 30 < 10 ? black : i % 30 < 20 ? blue : white)
  for (let row = 0; row < 30; row++) pixels[row * 30 + 20] = [125, 125, 125]
  const result = flattenColors(pixels, 30)
  for (let row = 0; row < 30; row++) {
    assert.ok([key(white), key(black)].includes(key(result[row * 30 + 20])))
  }
})

test('rare one-bead colored accents survive even on a 128 grid', () => {
  const width = 384
  const pixels = Array(width * width).fill(white)
  block(pixels, width, 180, 180, 3, pink)
  const result = quantizeFlat(pixels, width, 128, palette, 16)
  assert.equal(result[60 * 128 + 60].index, 3)
  assert.equal(result.filter(c => c.index === 3).length, 1)
})

test('small dark eyes and white eye highlights survive cleanup', () => {
  const width = 30
  const pixels = Array(width * width).fill(white)
  block(pixels, width, 9, 9, 9, black)
  block(pixels, width, 12, 12, 3, white)
  block(pixels, width, 21, 21, 3, black)
  const result = quantizeFlat(pixels, width, 10, palette, 16)
  assert.equal(result[4 * 10 + 4].index, 0)
  assert.equal(result[3 * 10 + 3].index, 1)
  assert.equal(result[7 * 10 + 7].index, 1)
})

test('subcell ink strokes remain connected, while corner specks do not grow', () => {
  const width = 30
  const pixels = Array(width * width).fill(white)
  for (let y = 0; y < width; y++) pixels[y * width + 13] = black
  pixels[22 * width + 22] = black
  const result = quantizeFlat(pixels, width, 10, palette, 16)
  for (let y = 0; y < 10; y++) assert.equal(result[y * 10 + 4].index, 1)
  assert.equal(result[7 * 10 + 7].index, 0)
})

test('thin-stroke protection does not fill a partially covered eye highlight', () => {
  const width = 30
  const pixels = Array(width * width).fill(white)
  block(pixels, width, 9, 9, 9, black)
  for (let y = 12; y < 15; y++) for (let x = 12; x < 14; x++) pixels[y * width + x] = white
  const result = quantizeFlat(pixels, width, 10, palette, 16)
  assert.equal(result[4 * 10 + 4].index, 0)
})

test('all grids return valid bead assignments within the requested color limit', () => {
  for (const grid of [32, 48, 64, 128]) {
    const width = grid * 3
    const pixels = Array.from({ length: width * width }, (_, i) => palette[Math.floor(i / width / (width / 4))].rgb)
    for (const limit of [1, 2, 4, 16]) {
      const result = quantizeFlat(pixels, width, grid, palette, limit)
      assert.equal(result.length, grid * grid)
      assert.ok(new Set(result.map(c => c.index)).size <= limit)
      assert.ok(result.every(c => palette.includes(c)))
    }
  }
})

test('invalid sampling dimensions fail explicitly', () => {
  assert.throws(() => flattenColors([], 0), /INVALID_SAMPLE_GRID/)
  assert.throws(() => quantizeFlat(Array(9).fill(white), 3, 2, palette, 4), /INVALID_SAMPLE_GRID/)
})

test('the same antialiased boundary does not gain a gray anchor at 128', () => {
  for (const width of [192, 384]) {
    const band = width / 192
    const pixels = Array.from({ length: width * width }, (_, i) => {
      const x = i % width
      return x < width / 2 ? black : x < width / 2 + band ? [125, 125, 125] : white
    })
    const diagnostics = {}
    const result = flattenColors(pixels, width, diagnostics)
    assert.deepEqual(new Set(result.map(key)), new Set([key(black), key(white)]))
    assert.equal(diagnostics.anchorColorCount, 2)
    if (width === 384) assert.equal(diagnostics.rejectedTransitionBins, 1)
  }
})

test('128 keeps intentional gray areas and thin saturated colored lines', () => {
  const width = 384, gray = [125, 125, 125], red = [240, 20, 30]
  const pixels = Array(width * width).fill(white)
  block(pixels, width, 30, 30, 60, gray)
  for (let y = 0; y < width; y++) {
    pixels[y * width + 180] = red
    pixels[y * width + 181] = red
  }
  const result = flattenColors(pixels, width)
  assert.equal(key(result[40 * width + 40]), key(gray))
  assert.equal(key(result[100 * width + 180]), key(red))
})

test('switching 221 and 291 does not change shared source colors or recolor existing plans', () => {
  const { getPalette } = require('../utils/colors')
  const rgbPalette = version => getPalette(version).map((c, index) => ({ ...c, index,
    rgb: c.code.slice(1).match(/../g).map(v => parseInt(v, 16)) }))
  for (const grid of [64, 128]) {
    const width = grid * 3
    const colors = rgbPalette('221').filter(c => ['H2', 'H7', 'C22', 'F24'].includes(c.id))
    const pixels = Array.from({ length: width * width }, (_, i) => colors[Math.floor((i % width) / (width / 4))].rgb)
    let saved
    for (const version of ['221', '291', '221']) {
      const diagnostics = {}
      const result = quantizeFlat(pixels, width, grid, rgbPalette(version), Number(version), diagnostics)
      assert.equal(diagnostics.colorMatches.length, 4)
      diagnostics.colorMatches.forEach(match => assert.deepEqual(match.beadRgb, match.sourceRgb))
      const codes = result.map(c => c.id)
      if (saved) assert.deepEqual(codes, saved)
      else saved = codes.slice()
    }
  }
})
