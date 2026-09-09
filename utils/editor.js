const { APP_VERSION } = require('./version')
const MAX_HISTORY_STEPS = 20
const MAX_HISTORY_CHANGES = 2000000

class EditSession {
  constructor(plan) {
    const matrix = plan.matrix || []
    this.height = matrix.length
    this.width = matrix[0]?.length || 0
    if (!this.width || !this.height || this.width > 1000 || this.height > 1000 ||
        matrix.some(row => row.length !== this.width)) throw new Error('INVALID_EDIT_PLAN')
    this.plan = plan
    this.palette = plan.detail.map(color => ({ ...color }))
    this.allowed = new Set(this.palette.map(color => color.colorIndex))
    this.pixels = new Uint16Array(this.width * this.height)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const value = matrix[y][x]
        if (!Number.isInteger(value) || value < 0 || value > 65535 ||
            (value !== 0 && !this.allowed.has(value))) throw new Error('INVALID_EDIT_COLOR')
        this.pixels[y * this.width + x] = value
      }
    }
    this.undoStack = []
    this.redoStack = []
    this.historyChanges = 0
    this.dirtyCount = 0
    // One slot per cell avoids a million Map entries during a long stroke.
    this.slots = new Uint32Array(this.pixels.length)
    this.transaction = null
  }

  index(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 &&
      x < this.width && y < this.height ? y * this.width + x : -1
  }

  begin() {
    if (this.transaction) throw new Error('EDIT_IN_PROGRESS')
    this.transaction = { indices: [], before: [] }
  }

  assign(index, value) {
    const original = this.plan.matrix[Math.floor(index / this.width)][index % this.width]
    this.dirtyCount += Number(value !== original) - Number(this.pixels[index] !== original)
    this.pixels[index] = value
  }

  write(index, value) {
    if (!this.transaction) throw new Error('NO_EDIT_TRANSACTION')
    if (value !== 0 && !this.allowed.has(value)) throw new Error('INVALID_EDIT_COLOR')
    if (index < 0 || index >= this.pixels.length || this.pixels[index] === value) return
    if (!this.slots[index]) {
      this.transaction.indices.push(index)
      this.transaction.before.push(this.pixels[index])
      this.slots[index] = this.transaction.indices.length
    }
    this.assign(index, value)
  }

  line(from, to, value) {
    if (this.index(from.x, from.y) < 0 || this.index(to.x, to.y) < 0) return
    let x = from.x, y = from.y
    const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y)
    const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1
    let error = dx + dy
    while (true) {
      this.write(this.index(x, y), value)
      if (x === to.x && y === to.y) break
      const twice = error * 2
      if (twice >= dy) { error += dy; x += sx }
      if (twice <= dx) { error += dx; y += sy }
    }
  }

  fill(index, value, everywhere = false) {
    if (index < 0 || index >= this.pixels.length) return
    const source = this.pixels[index]
    if (source === value) return
    if (everywhere) {
      for (let i = 0; i < this.pixels.length; i++) if (this.pixels[i] === source) this.write(i, value)
      return
    }
    // Recolor on enqueue, so each cell is visited only once, without recursion.
    const queue = new Uint32Array(this.pixels.length)
    let read = 0, end = 1
    queue[0] = index
    this.write(index, value)
    const visit = next => {
      if (this.pixels[next] !== source) return
      this.write(next, value)
      queue[end++] = next
    }
    while (read < end) {
      const current = queue[read++], x = current % this.width
      if (x > 0) visit(current - 1)
      if (x + 1 < this.width) visit(current + 1)
      if (current >= this.width) visit(current - this.width)
      if (current + this.width < this.pixels.length) visit(current + this.width)
    }
  }

  cancel() {
    if (!this.transaction) return
    const { indices, before } = this.transaction
    indices.forEach((index, n) => { this.assign(index, before[n]); this.slots[index] = 0 })
    this.transaction = null
  }

  commit() {
    if (!this.transaction) return false
    const { indices, before } = this.transaction
    let count = 0
    indices.forEach((index, n) => {
      this.slots[index] = 0
      if (this.pixels[index] !== before[n]) count++
    })
    this.transaction = null
    if (!count) return false
    const change = { indices: new Uint32Array(count), before: new Uint16Array(count), after: new Uint16Array(count) }
    let cursor = 0
    indices.forEach((index, n) => {
      if (this.pixels[index] === before[n]) return
      change.indices[cursor] = index
      change.before[cursor] = before[n]
      change.after[cursor++] = this.pixels[index]
    })
    this.redoStack.forEach(item => { this.historyChanges -= item.indices.length })
    this.redoStack = []
    this.undoStack.push(change)
    this.historyChanges += count
    while (this.undoStack.length > MAX_HISTORY_STEPS || this.historyChanges > MAX_HISTORY_CHANGES) {
      this.historyChanges -= this.undoStack.shift().indices.length
    }
    return true
  }

  undo() {
    if (this.transaction) return false
    const change = this.undoStack.pop()
    if (!change) return false
    change.indices.forEach((index, n) => this.assign(index, change.before[n]))
    this.redoStack.push(change)
    return true
  }

  redo() {
    if (this.transaction) return false
    const change = this.redoStack.pop()
    if (!change) return false
    change.indices.forEach((index, n) => this.assign(index, change.after[n]))
    this.undoStack.push(change)
    return true
  }

  save() {
    if (this.transaction) throw new Error('EDIT_IN_PROGRESS')
    const matrix = [], counts = new Map(), cellsByColor = {}
    let total = 0
    for (let row = 0; row < this.height; row++) {
      const line = Array.from(this.pixels.subarray(row * this.width, (row + 1) * this.width))
      matrix.push(line)
      line.forEach((value, col) => {
        if (!value) return
        total++
        counts.set(value, (counts.get(value) || 0) + 1)
        if (!cellsByColor[value - 1]) cellsByColor[value - 1] = []
        cellsByColor[value - 1].push({ row: row + 1, col: col + 1 })
      })
    }
    if (!total) throw new Error('EMPTY_EDIT_PLAN')
    const detail = this.palette.filter(color => counts.has(color.colorIndex))
      .map(color => ({ ...color, count: counts.get(color.colorIndex) })).sort((a, b) => b.count - a.count)
    return { ...this.plan, matrix, detail, cellsByColor, total,
      gridWidth: this.width, gridHeight: this.height,
      emptyCells: this.pixels.length - total,
      manualEdited: true, editedAppVersion: APP_VERSION,
      editRevision: (this.plan.editRevision || 0) + 1,
      diagnostics: { ...this.plan.diagnostics, actualColorCount: detail.length, manualEdited: true } }
  }
}

module.exports = { EditSession, MAX_HISTORY_STEPS, MAX_HISTORY_CHANGES }
