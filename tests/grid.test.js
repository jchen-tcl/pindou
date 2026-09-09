const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseGridSize, getSampleSize } = require('../utils/grid')

test('custom grids validate bounds without silently falling back', () => {
  for (const size of [1, 37, 256, 512, 999, 1000]) assert.equal(parseGridSize(`${size}x${size}`), size)
  for (const invalid of ['', '0x0', '1001x1001', '32x48', '-1x-1', '1.5x1.5', 'NaNxNaN']) {
    assert.throws(() => parseGridSize(invalid), /INVALID_GRID_SIZE/)
  }
  for (let size = 1; size <= 1000; size++) {
    const sample = getSampleSize(size, 'clean')
    assert.ok(sample <= 1000 && sample >= size)
    assert.equal(sample % size, 0)
  }
})

test('parameter page handles presets, custom edits, validation and restored values', async () => {
  let page
  global.Page = value => { page = value }
  require('../pages/params/params')
  page.data = { ...page.data }
  page.setData = update => Object.assign(page.data, update)
  global.getApp = () => ({ globalData: { taskData: { imagePath: 'source', grid: '777x777' } } })
  page.onLoad()
  assert.equal(page.data.customGrid, true)
  assert.equal(page.data.customSize, '777')
  page.setGrid({ currentTarget: { dataset: { value: '512x512' } } })
  assert.equal(page.data.customGrid, false)
  assert.equal(page.data.grid, '512x512')
  page.setGrid({ currentTarget: { dataset: { value: 'custom' } } })
  page.setCustomSize({ detail: { value: '1000' } })
  assert.equal(page.data.grid, '1000x1000')
  assert.match(page.data.sizeLabel, /500 × 500/)
  for (const value of ['', '1001', '2.5']) {
    page.setCustomSize({ detail: { value } })
    let toast
    global.wx = { showToast: options => { toast = options.title } }
    await page.startConvert()
    assert.match(toast, /1～1000/)
    assert.ok(!page.converting)
  }
})
