const { EditSession } = require('../../utils/editor')
const { MIN_EDIT_CELL, fitView, clampView, zoomView, cellAt, visibleCells } = require('../../utils/editor-view')

const TOOLS = [
  { id: 'move', label: '移动', hint: '单指拖动查看，双指缩放；切换“单格”后改色。' },
  { id: 'single', label: '单格', hint: '1 格就是 1 个像素、1 颗豆子。选色后轻点格子，只修改这一格；拖动不改色。' }
]

Page({
  data: { tools: TOOLS, tool: 'single', toolHint: TOOLS[1].hint, palette: [], selectedColor: 0,
    selectedLabel: '', rows: 0, cols: 0, ready: false, busy: false, dirty: false,
    canUndo: false, canRedo: false, guardOpen: false, editable: false, zoomLabel: '全图' },

  onLoad() {
    const task = getApp().globalData.taskData
    if (!task?.plan?.matrix?.length) {
      wx.redirectTo({ url: '/pages/index/index' })
      return
    }
    try {
      this.session = new EditSession(task.plan)
      this.colors = Object.fromEntries(this.session.palette.map(c => [c.colorIndex, c]))
      const first = this.session.palette[0]
      this.setData({ palette: this.session.palette, rows: this.session.height, cols: this.session.width,
        selectedColor: first?.colorIndex || 0, selectedLabel: first?.beadCode || '' })
    } catch (_) {
      wx.showToast({ title: '图纸无法编辑，请重新生成', icon: 'none' })
      wx.navigateBack()
    }
  },

  onReady() {
    if (!this.session) return
    wx.createSelectorQuery().in(this).select('#editCanvas')
      .fields({ node: true, size: true, rect: true }, res => {
        if (this.destroyed) return
        if (!res?.node || !res.width || !res.height) {
          this.setData({ canvasError: true })
          return
        }
        this.canvas = res.node
        this.rect = res
        this.ctx = this.canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio || 1
        this.canvas.width = Math.round(res.width * dpr)
        this.canvas.height = Math.round(res.height * dpr)
        this.ctx.scale(dpr, dpr)
        this.view = fitView(res.width, res.height, this.session.width, this.session.height)
        this.setData({ ready: true })
        this.updateView()
      }).exec()
  },

  onHide() { this.touchCancel() },
  onUnload() {
    this.destroyed = true
    if (this.data.busy) wx.hideLoading()
    clearTimeout(this.drawTimer)
    clearTimeout(this.workTimer)
    if (this.session) this.session.cancel()
    this.session = null
    this.overview = null
    this.ctx = null
    this.canvas = null
  },

  selectTool(e) {
    if (this.data.busy || this.gesture) return
    const tool = TOOLS.find(t => t.id === e.currentTarget.dataset.tool)
    if (tool) this.setData({ tool: tool.id, toolHint: tool.hint })
  },
  selectColor(e) {
    if (this.data.busy || this.gesture) return
    const selectedColor = Number(e.currentTarget.dataset.color)
    if (this.colors[selectedColor]) this.setData({ selectedColor, selectedLabel: this.colors[selectedColor].beadCode })
  },

  updateView() {
    this.setData({ editable: this.view.cell >= MIN_EDIT_CELL,
      zoomLabel: `${Math.round(this.view.cell / this.view.minCell * 100)}%` })
    this.scheduleDraw()
  },
  zoom(factor) {
    if (!this.view || this.data.busy || this.gesture) return
    zoomView(this.view, factor, { x: this.view.width / 2, y: this.view.height / 2 })
    this.updateView()
  },
  zoomIn() { this.zoom(1.6) },
  zoomOut() { this.zoom(1 / 1.6) },
  editZoom() { if (this.view) this.zoom(Math.max(1, 20 / this.view.cell)) },
  fit() {
    if (!this.view || this.data.busy || this.gesture) return
    this.view = fitView(this.view.width, this.view.height, this.session.width, this.session.height)
    this.updateView()
  },

  point(touch) {
    return { x: touch.x ?? touch.clientX - this.rect.left,
      y: touch.y ?? touch.clientY - this.rect.top }
  },
  pinch(touches) {
    const a = this.point(touches[0]), b = this.point(touches[1])
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  },
  showPosition(cell) {
    if (!cell) return
    this.positionCell = cell
    const value = this.session.pixels[this.session.index(cell.x, cell.y)]
    this.setData({ positionLabel: `第 ${cell.y + 1} 行 · 第 ${cell.x + 1} 列 · ${value ? this.colors[value]?.beadCode : '空格'}` })
  },

  touchStart(e) {
    if (!this.view || this.data.busy || this.leaving) return
    if (e.touches.length >= 2) {
      this.session.cancel()
      this.overview = null
      this.gesture = { mode: 'pinch', pinch: this.pinch(e.touches) }
      this.syncState()
      return
    }
    if (this.gesture || !e.touches.length) return
    const point = this.point(e.touches[0]), cell = cellAt(this.view, point)
    this.showPosition(cell)
    const mode = this.data.tool
    if (mode !== 'move' && this.view.cell < MIN_EDIT_CELL) {
      wx.showToast({ title: '请先放大到能看清格子', icon: 'none' })
      return
    }
    this.gesture = { mode, start: point, last: point, firstCell: cell, lastCell: cell, moved: false }
    if (mode === 'brush' || mode === 'erase') this.session.begin()
  },

  touchMove(e) {
    if (!this.gesture || this.data.busy) return
    if (e.touches.length >= 2) {
      if (this.gesture.mode !== 'pinch') { this.touchStart(e); return }
      const next = this.pinch(e.touches), previous = this.gesture.pinch
      zoomView(this.view, next.distance / previous.distance, previous.center)
      this.view.left += next.center.x - previous.center.x
      this.view.top += next.center.y - previous.center.y
      clampView(this.view)
      this.gesture.pinch = next
      this.updateView()
      return
    }
    // After a pinch, ignore a remaining single finger until all fingers lift.
    if (this.gesture.mode === 'pinch' || !e.touches.length) return
    const point = this.point(e.touches[0]), g = this.gesture
    g.moved = g.moved || Math.hypot(point.x - g.start.x, point.y - g.start.y) > 8
    if (g.mode === 'move') {
      this.view.left += point.x - g.last.x
      this.view.top += point.y - g.last.y
      clampView(this.view)
      this.scheduleDraw()
    } else if (g.mode === 'brush' || g.mode === 'erase') {
      const cell = cellAt(this.view, point)
      if (cell) {
        this.session.line(g.lastCell || cell, cell, g.mode === 'erase' ? 0 : this.data.selectedColor)
        this.showPosition(cell)
        this.overview = null
        this.scheduleDraw()
      }
      g.lastCell = cell
    }
    g.last = point
  },

  touchEnd(e) {
    if (!this.gesture || this.data.busy) return
    if (e.touches?.length) return
    const g = this.gesture
    this.gesture = null
    if (g.mode === 'brush' || g.mode === 'erase') {
      const point = e.changedTouches?.length ? this.point(e.changedTouches[0]) : g.last
      const cell = cellAt(this.view, point)
      if (cell) this.session.line(g.lastCell || cell, cell, g.mode === 'erase' ? 0 : this.data.selectedColor)
      this.session.commit()
      this.showPosition(cell)
      this.overview = null
      this.syncState()
    } else if (g.mode === 'single' && !g.moved && g.firstCell) {
      const point = e.changedTouches?.length ? this.point(e.changedTouches[0]) : g.last
      const cell = cellAt(this.view, point)
      if (cell && cell.x === g.firstCell.x && cell.y === g.firstCell.y &&
          Math.hypot(point.x - g.start.x, point.y - g.start.y) <= 8) {
        this.session.begin()
        this.session.write(this.session.index(cell.x, cell.y), this.data.selectedColor)
        this.session.commit()
        this.showPosition(cell)
        this.overview = null
        this.syncState()
      }
    } else if ((g.mode === 'fill' || g.mode === 'replace') && !g.moved && g.firstCell) {
      const point = e.changedTouches?.length ? this.point(e.changedTouches[0]) : g.last
      if (Math.hypot(point.x - g.start.x, point.y - g.start.y) <= 8) this.runBulk(g.firstCell, g.mode === 'replace')
    }
  },

  touchCancel() {
    if (!this.session || this.data.busy) return
    this.session.cancel()
    this.gesture = null
    this.overview = null
    this.syncState()
  },

  runBulk(cell, everywhere) {
    this.setData({ busy: true })
    wx.showLoading({ title: everywhere ? '正在替换同色' : '正在填色', mask: true })
    this.workTimer = setTimeout(() => {
      if (this.destroyed) return
      try {
        this.session.begin()
        this.session.fill(this.session.index(cell.x, cell.y), this.data.selectedColor, everywhere)
        this.session.commit()
        this.showPosition(cell)
      } catch (_) {
        this.session.cancel()
        wx.showToast({ title: '调整失败，请重试', icon: 'none' })
      } finally {
        wx.hideLoading()
        this.overview = null
        this.setData({ busy: false })
        this.syncState()
      }
    }, 30)
  },

  undo() {
    if (this.data.busy || this.gesture) return
    this.session.undo(); this.overview = null; this.syncState()
  },
  redo() {
    if (this.data.busy || this.gesture) return
    this.session.redo(); this.overview = null; this.syncState()
  },
  syncState() {
    if (!this.session || this.destroyed) return
    this.showPosition(this.positionCell)
    const dirty = this.session.dirtyCount > 0
    this.setData({ dirty, canUndo: !!this.session.undoStack.length,
      canRedo: !!this.session.redoStack.length, guardOpen: dirty && !this.leaving })
    this.scheduleDraw()
  },

  scheduleDraw() {
    if (this.drawTimer || !this.ctx || this.destroyed) return
    this.drawTimer = setTimeout(() => {
      this.drawTimer = null
      if (!this.destroyed) this.draw()
    }, 16)
  },

  makeOverview() {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: this.session.width, height: this.session.height })
      canvas.width = this.session.width; canvas.height = this.session.height
      const ctx = canvas.getContext('2d')
      const img = ctx.createImageData(canvas.width, canvas.height)
      const rgb = {}
      this.session.palette.forEach(c => { rgb[c.colorIndex] = c.code.slice(1).match(/../g).map(v => parseInt(v, 16)) })
      this.session.pixels.forEach((value, i) => {
        const shade = (Math.floor(i / canvas.width) + i % canvas.width) % 2 ? 207 : 233
        const color = rgb[value] || [shade, shade, shade]
        const offset = i * 4
        img.data[offset] = color[0]; img.data[offset + 1] = color[1]; img.data[offset + 2] = color[2]; img.data[offset + 3] = 255
      })
      ctx.putImageData(img, 0, 0)
      this.overview = canvas
    } catch (_) { this.overview = null }
  },

  draw() {
    const ctx = this.ctx, v = this.view
    if (!ctx || !v || !this.session) return
    ctx.fillStyle = '#e6edf3'
    ctx.fillRect(0, 0, v.width, v.height)
    if (v.cell < 2) {
      if (!this.overview) this.makeOverview()
      if (this.overview) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(this.overview, v.left, v.top, v.cols * v.cell, v.rows * v.cell)
        return
      }
    }
    const bounds = visibleCells(v)
    // Fallback overview samples no more than one cell per screen pixel.
    const step = v.cell < 1 ? Math.ceil(1 / v.cell) : 1
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (let y = bounds.y0; y < bounds.y1; y += step) {
      for (let x = bounds.x0; x < bounds.x1; x += step) {
        const value = this.session.pixels[y * v.cols + x]
        const color = this.colors[value]
        const left = v.left + x * v.cell, top = v.top + y * v.cell
        ctx.fillStyle = color?.code || ((x + y) % 2 ? '#ced7df' : '#e8edf2')
        ctx.fillRect(left, top, v.cell * step, v.cell * step)
        if (!value && v.cell >= MIN_EDIT_CELL) {
          ctx.fillStyle = '#f7f9fb'
          ctx.fillRect(left, top, v.cell / 2, v.cell / 2)
          ctx.fillRect(left + v.cell / 2, top + v.cell / 2, v.cell / 2, v.cell / 2)
        }
        if (color && v.cell >= 24) {
          const rgb = color.code.slice(1).match(/../g).map(v => parseInt(v, 16))
          ctx.fillStyle = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150 ? '#172c3e' : '#fff'
          ctx.font = `${Math.min(14, v.cell * .32)}px sans-serif`
          ctx.fillText(color.beadCode, left + v.cell / 2, top + v.cell / 2, v.cell - 2)
        }
      }
    }
    if (v.cell >= 6) {
      ctx.strokeStyle = '#71869a66'; ctx.lineWidth = .5
      ctx.beginPath()
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        ctx.moveTo(v.left + x * v.cell, Math.max(0, v.top))
        ctx.lineTo(v.left + x * v.cell, Math.min(v.height, v.top + v.rows * v.cell))
      }
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        ctx.moveTo(Math.max(0, v.left), v.top + y * v.cell)
        ctx.lineTo(Math.min(v.width, v.left + v.cols * v.cell), v.top + y * v.cell)
      }
      ctx.stroke()
    }
    if (this.positionCell && v.cell >= MIN_EDIT_CELL) {
      const x = v.left + this.positionCell.x * v.cell
      const y = v.top + this.positionCell.y * v.cell
      // A two-tone outline stays visible against both dark and light beads.
      for (const [inset, color] of [[1, '#ffffff'], [3, '#146fc0']]) {
        ctx.strokeStyle = color; ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x + inset, y + inset)
        ctx.lineTo(x + v.cell - inset, y + inset)
        ctx.lineTo(x + v.cell - inset, y + v.cell - inset)
        ctx.lineTo(x + inset, y + v.cell - inset)
        ctx.lineTo(x + inset, y + inset)
        ctx.stroke()
      }
    }
  },

  saveEdit() {
    if (!this.session || this.data.busy || this.gesture) return
    if (!this.session.dirtyCount) { this.leavePage(); return }
    try {
      const task = getApp().globalData.taskData
      if (task?.plan !== this.session.plan) throw new Error('EDIT_PLAN_CHANGED')
      const plan = this.session.save()
      getApp().globalData.taskData = { ...task, plan }
      this.session.plan = plan
      this.session.dirtyCount = 0
      this.session.undoStack = []
      this.session.redoStack = []
      this.session.historyChanges = 0
      this.leavePage()
    } catch (error) {
      wx.showToast({ title: error.message === 'EMPTY_EDIT_PLAN' ? '请至少保留一颗豆子' :
        error.message === 'EDIT_PLAN_CHANGED' ? '图纸已变化，请返回后重新编辑' : '保存失败，请重试', icon: 'none' })
    }
  },

  cancelEdit() {
    if (this.data.busy || this.gesture || this.leaving) return
    if (!this.session?.dirtyCount) { this.leavePage(); return }
    this.askToLeave()
  },
  askToLeave() {
    if (this.askingLeave || this.leaving) return
    this.askingLeave = true
    wx.showModal({ title: '保存图纸修改？', content: '保存后更新图纸和用豆量，放弃则保留原图纸。',
      confirmText: '保存修改', cancelText: '放弃修改',
      success: result => {
        this.askingLeave = false
        if (result.confirm) this.saveEdit()
        else if (result.cancel) this.leavePage()
      }, fail: () => { this.askingLeave = false } })
  },
  guardLeave() {
    if (this.leaving) { this.navigateBack(); return }
    // Setting guardOpen=false after undoing all edits is not a user back action.
    if (!this.data.guardOpen || !this.session?.dirtyCount) return
    this.setData({ guardOpen: false }, () => {
      this.setData({ guardOpen: true })
      this.askToLeave()
    })
  },
  leavePage() {
    this.leaving = true
    if (this.data.guardOpen) this.setData({ guardOpen: false })
    else this.navigateBack()
  },
  navigateBack() {
    if (this.navigating) return
    this.navigating = true
    wx.navigateBack({ fail: () => {
      this.navigating = false; this.leaving = false; this.syncState()
      wx.showToast({ title: '返回失败，请重试', icon: 'none' })
    } })
  }
})
