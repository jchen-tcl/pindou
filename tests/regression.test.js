const assert = require('node:assert/strict')
const { test } = require('node:test')
const { generateBeadPlan } = require('../utils/bead')
const { PALETTE } = require('../utils/colors')
const { getPalette } = require('../utils/colors')
const { buildPrintText, buildXlsxBuffer } = require('../utils/exporter')

function mockImage({ width = 100, height = 100, colors = [[0, 0, 0]], failOriginal = false } = {}) {
  const calls = { compress: [], draws: [] }
  global.wx = {
    getImageInfo: ({ success }) => success({ width, height }),
    compressImage: ({ quality, success }) => {
      calls.compress.push(quality)
      success({ tempFilePath: 'converted' })
    },
    createOffscreenCanvas: () => {
      let rect
      return { getContext: () => ({
        clearRect() { rect = null },
        drawImage(path, sx, sy, sw, sh, dx, dy, dw, dh) {
          if (failOriginal && path === 'original') throw new Error('decode')
          rect = { dx, dy, dw, dh }
          calls.draws.push([sx, sy, sw, sh, dx, dy, dw, dh])
        },
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(w * h * 4)
          for (let row = 0; row < h; row++) {
            for (let col = 0; col < w; col++) {
              if (!rect || col + 0.5 < rect.dx || col + 0.5 >= rect.dx + rect.dw ||
                  row + 0.5 < rect.dy || row + 0.5 >= rect.dy + rect.dh) continue
              const rgb = colors[(row * w + col) % colors.length]
              data.set([...rgb, 255], (row * w + col) * 4)
            }
          }
          return { data }
        }
      }) }
    }
  }
  return calls
}

const convert = (options = {}) => generateBeadPlan({
  imagePath: 'original', grid: '32x32', colorCount: 16, styleMode: 'restore', ...options
})

test('large and custom clean plans retain every cell and correct totals', async () => {
  for (const size of [256, 512, 777, 1000]) {
    mockImage({ width: 200, height: 100, colors: [[249, 240, 205]] })
    const plan = await generateBeadPlan({ imagePath: 'original', grid: `${size}x${size}` })
    assert.equal(plan.gridSize, size)
    assert.equal(plan.total, size * size)
    assert.equal(plan.matrix.length, size)
    assert.ok(plan.matrix.every(row => row.length === size))
    assert.equal(plan.detail.reduce((sum, c) => sum + c.count, 0), size * size)
    assert.ok(plan.detail.some(c => c.beadCode === 'A1'))
    assert.ok(plan.detail.some(c => c.beadCode === 'H2'))
    assert.ok(plan.diagnostics.sampleSize <= 1000)
  }
  await assert.rejects(generateBeadPlan({ imagePath: 'original', grid: '1001x1001' }), /INVALID_GRID_SIZE/)
})

test('default palette keeps exact black and avoids unnecessary compression', async () => {
  const calls = mockImage()
  const plan = await convert()
  assert.deepEqual(plan.detail.map(c => [c.code, c.count, c.beadCode]), [['#000000', 1024, 'H7']])
  assert.deepEqual(calls.compress, [])
})

test('uncropped landscape and portrait keep the full source and account for background', async () => {
  for (const [width, height, expected] of [
    [200, 100, [0, 0, 200, 100, 0, 8, 32, 16]],
    [100, 200, [0, 0, 100, 200, 8, 0, 16, 32]]
  ]) {
    const calls = mockImage({ width, height })
    const plan = await convert()
    assert.deepEqual(calls.draws[0], expected)
    assert.equal(plan.detail.find(c => c.beadCode === 'H7').count, 512)
    assert.equal(plan.detail.reduce((n, c) => n + c.count, 0), plan.total)
  }
})

test('explicit square crop still crops the center', async () => {
  const calls = mockImage({ width: 200, height: 100 })
  await convert({ cropRatio: '1:1' })
  assert.deepEqual(calls.draws[0], [50, 0, 100, 100, 0, 0, 32, 32])
})

test('compression starts only after decoding fails and stops at first success', async () => {
  const calls = mockImage({ failOriginal: true })
  await convert()
  assert.deepEqual(calls.compress, [82])
})

test('color limit and matrix statistics remain consistent across all grids', async () => {
  const colors = PALETTE.map(c => c.code.slice(1).match(/../g).map(v => parseInt(v, 16)))
  for (const grid of ['32x32', '48x48', '64x64', '128x128']) {
    mockImage({ colors })
    const plan = await convert({ grid, colorCount: 8 })
    assert.equal(plan.gridSize, Number(grid.split('x')[0]))
    assert.ok(plan.detail.length <= 8)
    const counts = new Map()
    plan.matrix.flat().forEach(i => counts.set(i, (counts.get(i) || 0) + 1))
    assert.equal(plan.matrix.flat().length, plan.total)
    plan.detail.forEach(c => assert.equal(counts.get(c.colorIndex), c.count))
  }
})

test('exports preserve stable color numbers and actual color count', async () => {
  mockImage()
  const plan = await convert()
  const task = { plan, colorCount: 16, grid: '32x32', sizeLabel: '16 cm' }
  assert.match(buildPrintText(task), /颜色数量：1色/)
  assert.match(buildPrintText(task), /H7\. MARD H7/)
  const xlsx = Buffer.from(buildXlsxBuffer(task))
  assert.equal(xlsx.readUInt32LE(0), 0x04034b50)
  assert.ok(xlsx.includes(Buffer.from('<t>H7</t>')))
})

test('both MARD versions produce valid labels and cleanup keeps statistics consistent', async () => {
  for (const paletteVersion of ['221', '291']) {
    const colors = getPalette(paletteVersion).map(c => c.code.slice(1).match(/../g).map(v => parseInt(v, 16)))
    mockImage({ colors })
    const plan = await convert({ paletteVersion, styleMode: 'clean', colorCount: 8 })
    assert.equal(plan.paletteVersion, paletteVersion)
    const valid = new Set(getPalette(paletteVersion).map(c => c.id))
    const counts = new Map()
    plan.matrix.flat().forEach(i => counts.set(i, (counts.get(i) || 0) + 1))
    plan.detail.forEach(c => {
      assert.ok(valid.has(c.beadCode))
      assert.equal(c.count, counts.get(c.colorIndex))
      assert.equal(plan.cellsByColor[c.colorIndex - 1].length, c.count)
    })
    assert.equal(plan.detail.reduce((n, c) => n + c.count, 0), plan.total)
    assert.ok(plan.detail.length <= 8)
    const xlsx = Buffer.from(buildXlsxBuffer({ plan }))
    assert.ok(xlsx.includes(Buffer.from(`MARD ${paletteVersion}`)))
    plan.detail.forEach(c => assert.ok(xlsx.includes(Buffer.from(`<t>${c.beadCode}</t>`))))
  }
})

test('estimated dimensions follow grid selection', () => {
  let page
  global.Page = value => { page = value }
  require('../pages/params/params')
  assert.match(page.getSizeLabel('32x32'), /16 × 16 cm/)
  assert.match(page.getSizeLabel('64x64'), /32 × 32 cm/)
  assert.match(page.getSizeLabel('128x128'), /64 × 64 cm/)
})

test('concurrent preview requests share rendering and failures allow retry', async () => {
  let page
  global.Page = value => { page = value }
  require('../pages/result/result')
  let complete
  let calls = 0
  page.drawEffectImage = () => {
    calls++
    return new Promise(resolve => { complete = resolve })
  }
  const first = page.renderEffectImage()
  assert.equal(page.renderEffectImage(), first)
  assert.equal(calls, 1)
  complete('preview.png')
  assert.equal(await first, 'preview.png')
  page.drawEffectImage = () => Promise.reject(new Error('render failed'))
  await assert.rejects(page.renderEffectImage(), /render failed/)
  assert.equal(page.effectRenderPromise, null)
  page.drawEffectImage = () => Promise.resolve('retry.png')
  assert.equal(await page.renderEffectImage(), 'retry.png')
})

test('default conversion supersamples without brightening and keeps full image bounds', async () => {
  const calls = mockImage({ width: 200, height: 100, colors: [[100, 160, 180]] })
  const clean = await generateBeadPlan({ imagePath: 'original', grid: '32x32', colorCount: 16 })
  assert.deepEqual(calls.draws[0], [0, 0, 200, 100, 0, 24, 96, 48])
  const restore = await convert()
  assert.deepEqual(clean.detail, restore.detail)
  assert.equal(clean.matrix.flat().length, 1024)
  assert.equal(clean.algorithmVersion, 'flat-v3')
  assert.equal(clean.diagnostics.sampleSize, 96)
  assert.equal(clean.diagnostics.anchorColorCount, 2)
  assert.equal(clean.diagnostics.flatFallback, false)
  assert.equal(clean.diagnostics.actualColorCount, clean.detail.length)
  assert.deepEqual(calls.compress, [])
})

test('parameter page actually uses the clean pipeline and saves matching statistics', async () => {
  const calls = mockImage()
  const app = { globalData: { taskData: { imagePath: 'original' } } }
  global.getApp = () => app
  Object.assign(global.wx, { showLoading() {}, hideLoading() {}, showToast() {}, navigateTo() {} })
  let page
  global.Page = value => { page = value }
  delete require.cache[require.resolve('../pages/params/params')]
  require('../pages/params/params')
  page.data = { ...page.data, imagePath: 'original', grid: '32x32' }
  await page.startConvert()
  assert.equal(app.globalData.taskData.styleMode, 'clean')
  assert.equal(calls.draws[0][6], 96)
  assert.equal(app.globalData.taskData.plan.detail[0].count, 1024)
  assert.equal(page.converting, false)
})

test('decodable WebP input is kept original rather than recompressed', async () => {
  const calls = mockImage()
  let page
  global.Page = value => { page = value }
  require('../pages/index/index')
  assert.equal(await page.normalizeImage('original.webp'), 'original.webp')
  assert.deepEqual(calls.compress, [])
})
