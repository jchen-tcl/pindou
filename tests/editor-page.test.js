const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { fitView } = require('../utils/editor-view')
const { FLAT_ALGORITHM_VERSION } = require('../utils/flat')

function fixture() {
  return { imagePath: 'source.png', grid: '10x10', sizeLabel: '5 × 4 cm', plan: {
    matrix: Array.from({ length: 8 }, () => Array(10).fill(1)),
    gridWidth: 10, gridHeight: 8, total: 80,
    appVersion: 'v1.0.11', algorithmVersion: FLAT_ALGORITHM_VERSION,
    detail: [{ colorIndex: 1, beadCode: 'H2', code: '#FFFFFF', count: 80 },
      { colorIndex: 2, beadCode: 'H7', code: '#000000', count: 0 }]
  } }
}

function loadPage(name, app, extraWx = {}) {
  const file = path.resolve(__dirname, `../pages/${name}/${name}.js`)
  const events = { toasts: [], back: 0 }
  let page
  const wx = { showToast: v => events.toasts.push(v.title), showLoading() {}, hideLoading() {},
    showModal: v => { events.modal = v }, navigateBack: () => { events.back++ },
    navigateTo: v => { events.navigation = v; v.complete?.() }, redirectTo: v => { events.redirect = v.url }, ...extraWx }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Page: p => { page = p }, getApp: () => app,
    wx, setTimeout, clearTimeout, console
  }, { filename: file })
  page.setData = (update, callback) => { Object.assign(page.data, update); callback?.() }
  page.onLoad()
  return { page, events }
}

function editor() {
  const app = { globalData: { taskData: fixture() } }
  const result = loadPage('editor', app)
  const page = result.page
  page.view = fitView(200, 160, 10, 8)
  page.rect = { left: 0, top: 0 }
  page.scheduleDraw = () => {}
  page.setData({ ready: true, selectedColor: 2 })
  return { ...result, app }
}
const point = (x, y) => ({ x, y })
const start = (page, x, y) => page.touchStart({ touches: [point(x, y)] })
const end = (page, x, y) => page.touchEnd({ touches: [], changedTouches: [point(x, y)] })

test('single-pixel tool changes exactly one bead, rejects drags and supports undo', () => {
  const { page } = editor()
  assert.equal(page.data.tool, 'single')
  assert.equal(page.data.tools.map(tool => tool.id).join(','), 'move,single')
  page.selectTool({ currentTarget: { dataset: { tool: 'fill' } } })
  assert.equal(page.data.tool, 'single')
  page.selectTool({ currentTarget: { dataset: { tool: 'single' } } })
  start(page, 50, 50); end(page, 50, 50)
  assert.equal(page.session.dirtyCount, 1)
  assert.equal(page.session.pixels[22], 2)
  assert.equal(page.session.undoStack[0].indices.length, 1)
  assert.match(page.data.positionLabel, /第 3 行 · 第 3 列 · H7/)
  start(page, 10, 10); page.touchMove({ touches: [point(90, 10)] }); end(page, 90, 10)
  assert.equal(page.session.dirtyCount, 1)
  start(page, 19, 10); end(page, 21, 10)
  assert.equal(page.session.dirtyCount, 1, 'crossing even a nearby grid boundary is not a single-cell tap')
  start(page, 30, 30)
  page.touchStart({ touches: [point(30, 30), point(80, 80)] })
  end(page, 30, 30)
  assert.equal(page.session.dirtyCount, 1)
  page.undo()
  assert.equal(page.session.pixels[22], 1)
  assert.equal(page.session.dirtyCount, 0)
  page.redo()
  assert.equal(page.session.pixels[22], 2)
})

test('tap, drag, cancel and pinch never leak draft changes or accidental multi-touch ink', () => {
  const { page, app } = editor()
  page.setData({ tool: 'brush' })
  start(page, 10, 10); end(page, 10, 10)
  assert.equal(page.session.pixels[0], 2)
  assert.equal(app.globalData.taskData.plan.matrix[0][0], 1)
  start(page, 30, 10)
  page.touchMove({ touches: [point(90, 10)] })
  assert.equal(page.session.pixels[4], 2)
  page.touchStart({ touches: [point(90, 10), point(120, 60)] })
  assert.equal(page.session.pixels[4], 1, 'pinch rolls back the entire unfinished stroke')
  page.touchMove({ touches: [point(80, 10), point(130, 60)] })
  page.touchEnd({ touches: [point(80, 10)] })
  page.touchMove({ touches: [point(20, 20)] })
  end(page, 20, 20)
  assert.equal(page.session.undoStack.length, 1)
  assert.equal(page.session.dirtyCount, 1)
  page.fit()
  start(page, 30, 10); page.touchMove({ touches: [point(110, 10)] }); end(page, 110, 10)
  assert.equal(page.session.undoStack.length, 2)
  assert.ok(page.session.pixels.slice(0, 6).every(v => v === 2))
  page.undo()
  assert.equal(page.session.pixels[5], 1)
  page.redo()
  assert.equal(page.session.pixels[5], 2)
  start(page, 150, 10); page.touchMove({ touches: [point(170, 10)] }); page.touchCancel()
  assert.equal(page.session.pixels[8], 1)
})

test('low zoom rejects edits and move mode never paints; position uses row/column', () => {
  const { page, events } = editor()
  page.view = fitView(50, 40, 10, 8)
  page.setData({ tool: 'erase' })
  start(page, 10, 10); end(page, 10, 10)
  assert.equal(page.session.dirtyCount, 0)
  assert.match(events.toasts[0], /放大/)
  page.editZoom()
  assert.equal(page.view.cell, 20)
  page.setData({ tool: 'move' })
  start(page, 10, 10); page.touchMove({ touches: [point(15, 15)] }); end(page, 15, 15)
  assert.equal(page.session.dirtyCount, 0)
  assert.match(page.data.positionLabel, /第 \d+ 行 · 第 \d+ 列 · H2/)
})

test('fill and replacement are one action; dragging a fill tool is not a tap', async () => {
  const { page } = editor()
  page.setData({ tool: 'fill' })
  start(page, 10, 10); end(page, 150, 10)
  assert.equal(page.data.busy, false)
  assert.equal(page.session.dirtyCount, 0)
  start(page, 10, 10); end(page, 10, 10)
  assert.equal(page.data.busy, true)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(page.data.busy, false)
  assert.ok(page.session.pixels.every(v => v === 2))
  assert.equal(page.session.undoStack.length, 1)
  page.setData({ tool: 'replace', selectedColor: 1 })
  start(page, 10, 10); end(page, 10, 10)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(page.session.dirtyCount, 0)
  assert.equal(page.session.undoStack.length, 2)
})

test('save updates the shared plan; cancel and native back can discard without mutation', () => {
  const { page, app, events } = editor()
  const original = app.globalData.taskData.plan
  page.setData({ tool: 'erase' })
  start(page, 10, 10); end(page, 10, 10)
  assert.equal(page.data.guardOpen, true)
  page.saveEdit()
  page.guardLeave()
  assert.equal(events.back, 1)
  assert.notEqual(app.globalData.taskData.plan, original)
  assert.equal(app.globalData.taskData.plan.total, 79)
  assert.equal(app.globalData.taskData.plan.matrix[0][0], 0)
  assert.equal(original.total, 80)
  for (const nativeBack of [false, true]) {
    const f = editor(), before = f.app.globalData.taskData.plan
    f.page.setData({ tool: 'brush' }); start(f.page, 10, 10); end(f.page, 10, 10)
    if (nativeBack) f.page.guardLeave()
    else f.page.cancelEdit()
    assert.equal(f.events.modal.confirmText, '保存修改')
    assert.equal(f.events.modal.cancelText, '放弃修改')
    f.events.modal.success({ cancel: true })
    f.page.guardLeave()
    assert.equal(f.events.back, 1)
    assert.equal(f.app.globalData.taskData.plan, before)
    assert.equal(before.matrix[0][0], 1)
  }
})

test('all-empty save keeps editor open; undoing everything does not open a leave modal', () => {
  const { page, events } = editor()
  page.session.begin(); page.session.fill(0, 0, true); page.session.commit(); page.syncState()
  page.saveEdit()
  assert.match(events.toasts[0], /至少保留一颗/)
  assert.equal(events.back, 0)
  page.undo()
  page.guardLeave()
  assert.equal(events.modal, undefined)
  assert.equal(page.data.dirty, false)
})

test('editor renderer visits the viewport only and labels white but not empty cells', () => {
  const { page } = editor()
  const labels = [], colors = []
  page.view = fitView(200, 160, 10, 8)
  page.view.cell = 40; page.view.left = -160; page.view.top = -80
  page.session.pixels[24] = 0
  page.ctx = { fillRect() { colors.push(this.fillStyle) }, fillText(v) { labels.push(v) },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }
  page.draw()
  assert.equal(labels.length, 19, 'only 5 by 4 visible cells, one of them empty')
  assert.ok(labels.every(label => label === 'H2'))
  assert.ok(colors.includes('#FFFFFF'))
  assert.ok(colors.includes('#e8edf2'))
  assert.ok(colors.length < 30)
})

test('result refreshes edited data and caches, and does not cache an outdated render', async () => {
  const app = { globalData: { taskData: fixture() } }
  const { page } = loadPage('result', app)
  page.effectImagePath = 'old-effect.png'; page.effectCodeImagePath = 'old-code.png'
  const oldPlan = app.globalData.taskData.plan
  app.globalData.taskData = { ...app.globalData.taskData,
    plan: { ...oldPlan, total: 79, emptyCells: 1, manualEdited: true, editedAppVersion: 'v1.0.12' } }
  page.onShow()
  assert.equal(page.data.total, 79)
  assert.match(page.data.editedLabel, /手动调整/)
  assert.equal(page.effectImagePath, '')
  assert.equal(page.effectCodeImagePath, '')
  const fills = [], text = []
  const ctx = { clearRect() {}, fillRect(...args) { fills.push({ color: this.fillStyle, args }) },
    fillText(label) { text.push(label) }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }
  page.taskData.plan.matrix = [[0, 1]]
  page.getCanvasNode = async () => ({ canvas: { getContext: () => ctx }, width: 100, height: 100 })
  let complete
  page.canvasToImagePath = () => new Promise(resolve => { complete = resolve })
  const rendering = page.drawEffectCodeImage()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(fills.some(fill => fill.color === '#FFFFFF'))
  assert.ok(fills.some(fill => fill.color === '#e8edf2'))
  assert.deepEqual(text, ['H2'])
  page.renderEpoch++
  complete('stale.png')
  assert.equal(await rendering, undefined)
  assert.equal(page.effectCodeImagePath, '')
})

test('round preview draws beads only for occupied cells and saves the active preview', async () => {
  const app = { globalData: { taskData: fixture() } }
  app.globalData.taskData.plan.matrix = [[1, 0, 2]]
  const { page } = loadPage('result', app)
  const arcs = [], labels = []
  const ctx = { clearRect() {}, fillRect() {}, beginPath() {}, arc(...v) { arcs.push(v) },
    fill() {}, stroke() {}, fillText(v) { labels.push(v) } }
  page.getCanvasNode = async selector => {
    assert.equal(selector, '#roundCanvas')
    return { canvas: { getContext: () => ctx }, width: 300, height: 200 }
  }
  page.canvasToImagePath = async () => 'round.png'
  page.data.previewMode = 'round'
  const snapshot = JSON.stringify(app.globalData.taskData.plan)
  const first = page.renderRoundImage()
  assert.equal(first, page.renderRoundImage())
  assert.equal(await first, 'round.png')
  assert.equal(arcs.length, 8, 'each bead has shadow, rim, highlight and hole; empty has none')
  assert.equal(labels.length, 0)
  assert.equal(await page.ensureEffectReady(), 'round.png')
  assert.equal(JSON.stringify(app.globalData.taskData.plan), snapshot)
  page.loadTask(app.globalData.taskData)
  assert.equal(page.roundImagePath, '')
})
