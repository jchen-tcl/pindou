const { test } = require('node:test')
const assert = require('node:assert/strict')
const { quantize, toOklab, distance, normalizeStyle } = require('../utils/quantize')
const { PALETTE } = require('../utils/colors')
const palette = PALETTE.map((c, index) => ({ ...c, index, rgb: c.code.slice(1).match(/../g).map(v => parseInt(v, 16)) }))

function frequencyBaseline(pixels, colors, count) {
  const labs = colors.map(c => toOklab(c.rgb))
  const nearest = (rgb, ids) => ids.reduce((best, id) => distance(toOklab(rgb), labs[id]) < distance(toOklab(rgb), labs[best]) ? id : best, ids[0])
  const all = colors.map((_, i) => i)
  const usage = colors.map(() => 0)
  pixels.forEach(rgb => usage[nearest(rgb, all)]++)
  const selected = all.sort((a, b) => usage[b] - usage[a] || a - b).slice(0, count)
  return pixels.map(rgb => colors[nearest(rgb, selected)])
}

function error(pixels, result) {
  return pixels.reduce((sum, rgb, i) => sum + distance(toOklab(rgb), toOklab(result[i].rgb)), 0)
}

test('Oklab reference endpoints and red primary', () => {
  assert.deepEqual(toOklab([0, 0, 0]), [0, 0, 0])
  const white = toOklab([255, 255, 255])
  assert.ok(Math.abs(white[0] - 1) < 1e-6)
  assert.ok(Math.abs(white[1]) < 1e-6 && Math.abs(white[2]) < 1e-6)
  const red = toOklab([255, 0, 0])
  ;[0.627955, 0.224863, 0.125846].forEach((v, i) => assert.ok(Math.abs(red[i] - v) < 1e-6))
})

test('rare black details survive instead of redundant light background colors', () => {
  const colors = [[255,255,255],[183,183,195],[211,216,225],[43,43,53]].map((rgb,index) => ({rgb,index}))
  const pixels = [
    ...Array(480).fill(colors[1].rgb), ...Array(480).fill(colors[2].rgb), ...Array(40).fill(colors[3].rgb)
  ]
  const baseline = frequencyBaseline(pixels, colors, 2)
  const result = quantize(pixels, colors, 2)
  assert.equal(baseline.filter(c => c.index === 3).length, 0)
  assert.equal(result.filter(c => c.index === 3).length, 40)
  assert.ok(error(pixels, result) < error(pixels, baseline))
})

test('full palette round trips every bead color exactly', () => {
  assert.deepEqual(quantize(palette.map(c => c.rgb), palette, palette.length).map(c => c.rgb), palette.map(c => c.rgb))
})

test('limited-color error never exceeds frequency baseline on deterministic samples', () => {
  let seed = 12345
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24 }
  const pixels = Array.from({ length: 512 }, () => [random(), random(), random()])
  for (const count of [1, 8, 16, 24]) {
    const result = quantize(pixels, palette, count)
    assert.ok(new Set(result.map(c => c.index)).size <= count)
    assert.ok(error(pixels, result) <= error(pixels, frequencyBaseline(pixels, palette, count)) + 1e-9)
    assert.deepEqual(quantize(pixels.slice().reverse(), palette, count).reverse(), result)
  }
})

test('cute mode preserves dark outlines and restore mode is unchanged', () => {
  assert.deepEqual(normalizeStyle(43, 43, 53, 'cute'), [43, 43, 53])
  assert.deepEqual(normalizeStyle(20, 160, 240, 'restore'), [20, 160, 240])
  assert.ok(normalizeStyle(150, 150, 150, 'cute')[0] > 150)
})
