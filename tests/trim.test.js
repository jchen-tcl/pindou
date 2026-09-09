const { test } = require('node:test')
const assert = require('node:assert/strict')
const { whiteBounds } = require('../utils/trim')
const white = { rgb: [255, 255, 255] }
const black = { rgb: [0, 0, 0] }

test('white margins crop to all subject details without removing interior white', () => {
  const colors = Array(100).fill(white)
  for (let y = 2; y <= 7; y++) for (let x = 3; x <= 6; x++) {
    if (y === 2 || y === 7 || x === 3 || x === 6) colors[y * 10 + x] = black
  }
  assert.deepEqual(whiteBounds(colors, 10), { left: 3, top: 2, width: 4, height: 6 })
  assert.equal(colors[44], white)
  colors[91] = black
  assert.deepEqual(whiteBounds(colors, 10), { left: 1, top: 2, width: 6, height: 8 })
})

test('cream fill and boundary details survive; entirely white images remain valid', () => {
  const colors = Array(100).fill(white)
  assert.deepEqual(whiteBounds(colors, 10), { left: 0, top: 0, width: 10, height: 10 })
  colors[45] = { rgb: [249, 240, 205] }
  assert.deepEqual(whiteBounds(colors, 10), { left: 5, top: 4, width: 1, height: 1 })
  colors[0] = black
  colors[99] = black
  assert.deepEqual(whiteBounds(colors, 10), { left: 0, top: 0, width: 10, height: 10 })
})
