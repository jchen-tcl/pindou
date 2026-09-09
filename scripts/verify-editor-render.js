// Local canvas QA of the actual editor renderer, without a WeChat simulator.
// Usage: node scripts/verify-editor-render.js <canvas module path> <output folder>
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { createCanvas } = require(path.resolve(process.argv[2]))
const { EditSession } = require('../utils/editor')
const { fitView, zoomView } = require('../utils/editor-view')
const output = path.resolve(process.argv[3])
fs.mkdirSync(output, { recursive: true })
const file = path.resolve(__dirname, '../pages/editor/editor.js')
let page
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  require: createRequire(file), Page: p => { page = p }, setTimeout, clearTimeout,
  wx: { createOffscreenCanvas: ({ width, height }) => createCanvas(width, height) }
})
const palette = [
  { colorIndex: 1, code: '#FFFFFF', beadCode: 'H2' },
  { colorIndex: 2, code: '#000000', beadCode: 'H7' },
  { colorIndex: 3, code: '#67B4BE', beadCode: 'C22' },
  { colorIndex: 4, code: '#F9F0CD', beadCode: 'A1' }
]
for (const large of [false, true]) {
  const cols = large ? 1000 : 16, rows = large ? 1000 : 10
  const matrix = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    if (x < cols / 4) return (x + y) % 4 ? 0 : 1
    if (y < rows / 4) return 3
    if (x > cols * .8) return 2
    return 4
  }))
  page.session = new EditSession({ matrix, detail: palette })
  page.colors = Object.fromEntries(palette.map(c => [c.colorIndex, c]))
  page.view = fitView(480, 360, cols, rows)
  const canvas = createCanvas(480, 360)
  page.ctx = canvas.getContext('2d')
  page.overview = null
  page.draw()
  fs.writeFileSync(path.join(output, large ? 'million-overview.png' : 'rectangular-editor.png'), canvas.toBuffer('image/png'))
  if (large) {
    zoomView(page.view, 32 / page.view.cell, { x: 240, y: 180 })
    page.draw()
    fs.writeFileSync(path.join(output, 'million-zoom.png'), canvas.toBuffer('image/png'))
  }
}
console.log(`Editor renderer snapshots: ${output}`)
