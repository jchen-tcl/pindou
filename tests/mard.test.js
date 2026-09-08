const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PALETTE, ALL_COLORS, getPalette } = require('../utils/colors')
const { cleanAssignments } = require('../utils/cleanup')

test('MARD versions have the expected unique references and valid RGB values', () => {
  assert.equal(PALETTE.length, 221)
  assert.equal(ALL_COLORS.length, 291)
  assert.equal(new Set(ALL_COLORS.map(c => c.id)).size, 291)
  assert.ok(PALETTE.every(c => /^[A-HM]\d+$/.test(c.id)))
  assert.ok(ALL_COLORS.every(c => /^#[0-9A-F]{6}$/.test(c.code)))
  assert.equal(getPalette('291'), ALL_COLORS)
  assert.equal(getPalette('invalid'), PALETTE)
  assert.equal(PALETTE.find(c => c.id === 'H7').code, '#000000')
  const counts = {}
  ALL_COLORS.forEach(c => { const group = c.id.match(/^[A-Z]+/)[0]; counts[group] = (counts[group] || 0) + 1 })
  assert.deepEqual(counts, { A:26, B:32, C:29, D:26, E:24, F:25, G:21, H:23, M:15, P:23, Q:5, R:28, T:1, Y:5, ZG:8 })
})

test('cleanup removes close-color specks but preserves high-contrast eyes and lines', () => {
  const background = { index: 0, rgb: [180, 180, 180] }
  const speck = { index: 1, rgb: [187, 187, 187] }
  const black = { index: 2, rgb: [0, 0, 0] }
  const pixels = Array(81).fill(background)
  pixels[10] = speck
  pixels[13] = speck
  pixels[14] = speck
  pixels[40] = black
  pixels[55] = speck
  pixels[56] = speck
  pixels[57] = speck
  const result = cleanAssignments(pixels, 9)
  for (const index of [10, 13, 14]) assert.equal(result[index], background)
  for (const index of [55, 56, 57]) assert.equal(result[index], speck)
  assert.equal(result[40], black)
  assert.equal(pixels[10], speck, 'input must not be mutated')
  assert.equal(result.length, pixels.length)
})

test('cleanup preserves a uniform field', () => {
  const pixels = Array(1024).fill({ index: 0, rgb: [100, 120, 130] })
  assert.deepEqual(cleanAssignments(pixels, 32), pixels)
})
