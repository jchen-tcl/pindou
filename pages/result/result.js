const { buildPrintText, buildXlsxBuffer, saveFile, saveBinaryFile } = require('../../utils/exporter')

Page({
  data: {
    imagePath: '',
    sizeLabel: '',
    grid: '',
    colorCount: 16,
    total: 0,
    detail: [],
    previewMode: 'effect',
    previewPadding: 100
  },
  onLoad() {
    const app = getApp()
    const taskData = app.globalData.taskData || {}
    if (!taskData.imagePath || !taskData.plan) {
      wx.redirectTo({
        url: '/pages/index/index'
      })
      return
    }
    this.taskData = taskData
    this.setData({
      imagePath: taskData.imagePath,
      sizeLabel: taskData.sizeLabel,
      grid: taskData.grid,
      colorCount: taskData.colorCount,
      total: taskData.plan.total,
      detail: taskData.plan.detail
    })
    this.syncPreviewRatio(taskData.imagePath)
  },
  onReady() {
    this.renderEffectImage()
  },
  switchPreview(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.previewMode) {
      return
    }
    this.setData({ previewMode: mode }, () => {
      if (mode === 'effect' && !this.effectImagePath) {
        setTimeout(() => {
          this.renderEffectImage()
        }, 50)
      }
      if (mode === 'effect_code' && !this.effectCodeImagePath) {
        setTimeout(() => {
          this.renderEffectCodeImage()
        }, 50)
      }
    })
  },
  async renderEffectImage() {
    const matrix = this.taskData?.plan?.matrix || []
    if (!matrix.length) {
      return
    }
    try {
      const { canvas, width, height } = await this.getCanvasNode('#effectCanvas')
      const ctx = canvas.getContext('2d')
      const gridSize = matrix.length
      const colorMap = this.buildColorMap(this.taskData.plan.detail)
      const draw = this.getEffectDrawRect(width, height)
      ctx.clearRect(0, 0, width, height)
      const cell = draw.size / gridSize
      for (let row = 0; row < gridSize; row += 1) {
        const line = matrix[row]
        for (let col = 0; col < gridSize; col += 1) {
          const colorIndex = line[col]
          const color = colorMap[colorIndex] || '#FFFFFF'
          ctx.fillStyle = color
          ctx.fillRect(draw.left + col * cell, draw.top + row * cell, cell, cell)
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = Math.max(0.4, cell * 0.04)
      for (let i = 0; i <= gridSize; i += 1) {
        const p = i * cell
        ctx.beginPath()
        ctx.moveTo(draw.left, draw.top + p)
        ctx.lineTo(draw.left + draw.size, draw.top + p)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(draw.left + p, draw.top)
        ctx.lineTo(draw.left + p, draw.top + draw.size)
        ctx.stroke()
      }
      this.canvasNode = canvas
      this.canvasSize = { width, height }
      this.effectImagePath = await this.canvasToImagePath(canvas, width, height)
      return this.effectImagePath
    } catch (error) {
      wx.showToast({
        title: '效果图生成失败',
        icon: 'none'
      })
      throw error
    }
  },
  async renderEffectCodeImage() {
    const matrix = this.taskData?.plan?.matrix || []
    if (!matrix.length) {
      return
    }
    try {
      const { canvas, width, height } = await this.getCanvasNode('#effectCodeCanvas')
      const ctx = canvas.getContext('2d')
      const gridSize = matrix.length
      const colorMap = this.buildColorMap(this.taskData.plan.detail)
      const draw = this.getEffectDrawRect(width, height)
      ctx.clearRect(0, 0, width, height)
      const cell = draw.size / gridSize
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let row = 0; row < gridSize; row += 1) {
        const line = matrix[row]
        for (let col = 0; col < gridSize; col += 1) {
          const colorIndex = Number(line[col] || 0)
          const color = colorMap[colorIndex] || '#FFFFFF'
          ctx.fillStyle = color
          ctx.fillRect(draw.left + col * cell, draw.top + row * cell, cell, cell)
          if (colorIndex > 0) {
            ctx.fillStyle = this.getTextColorByBg(color)
            ctx.font = `${Math.max(8, Math.floor(cell * 0.45))}px sans-serif`
            ctx.fillText(String(colorIndex).padStart(2, '0'), draw.left + col * cell + cell / 2, draw.top + row * cell + cell / 2)
          }
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = Math.max(0.4, cell * 0.04)
      for (let i = 0; i <= gridSize; i += 1) {
        const p = i * cell
        ctx.beginPath()
        ctx.moveTo(draw.left, draw.top + p)
        ctx.lineTo(draw.left + draw.size, draw.top + p)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(draw.left + p, draw.top)
        ctx.lineTo(draw.left + p, draw.top + draw.size)
        ctx.stroke()
      }
      this.effectCodeImagePath = await this.canvasToImagePath(canvas, width, height)
      return this.effectCodeImagePath
    } catch (error) {
      wx.showToast({
        title: '色号效果图生成失败',
        icon: 'none'
      })
      throw error
    }
  },
  ensureEffectReady() {
    if (this.effectImagePath) {
      return Promise.resolve(this.effectImagePath)
    }
    return new Promise((resolve, reject) => {
      const run = () => {
        this.renderEffectImage()
          .then((path) => {
            if (path) {
              resolve(path)
            } else {
              reject(new Error('empty path'))
            }
          })
          .catch(reject)
      }
      if (this.data.previewMode === 'effect') {
        run()
      } else {
        this.setData({ previewMode: 'effect' }, () => {
          setTimeout(run, 50)
        })
      }
    })
  },
  buildColorMap(detail) {
    const map = {}
    detail.forEach((item, index) => {
      const key = Number(item.colorIndex || index + 1)
      map[key] = item.code
    })
    return map
  },
  getTextColorByBg(hex) {
    const raw = String(hex || '').replace('#', '')
    const full = raw.length === 3 ? raw.split('').map((s) => s + s).join('') : raw
    const r = parseInt(full.slice(0, 2), 16) || 0
    const g = parseInt(full.slice(2, 4), 16) || 0
    const b = parseInt(full.slice(4, 6), 16) || 0
    const luminance = (r * 299 + g * 587 + b * 114) / 1000
    return luminance >= 150 ? '#2f3f50' : '#ffffff'
  },
  getCanvasNode(selector = '#effectCanvas') {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select(selector)
        .fields({ node: true, size: true }, (res) => {
          if (!res || !res.node) {
            reject(new Error('canvas not found'))
            return
          }
          const dpr = wx.getSystemInfoSync().pixelRatio || 1
          const width = Math.max(1, Math.floor(res.width))
          const height = Math.max(1, Math.floor(res.height))
          const canvas = res.node
          canvas.width = width * dpr
          canvas.height = height * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)
          resolve({ canvas, width, height })
        })
        .exec()
    })
  },
  canvasToImagePath(canvas, width, height) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath(
        {
          canvas,
          x: 0,
          y: 0,
          width,
          height,
          destWidth: width * 2,
          destHeight: height * 2,
          fileType: 'png',
          quality: 1,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        },
        this
      )
    })
  },
  getEffectDrawRect(width, height) {
    const size = Math.min(width, height)
    const left = (width - size) / 2
    const top = (height - size) / 2
    return { left, top, size }
  },
  syncPreviewRatio(imagePath) {
    wx.getImageInfo({
      src: imagePath,
      success: (res) => {
        if (!res?.width || !res?.height) {
          return
        }
        const padding = Number(((res.height / res.width) * 100).toFixed(2))
        this.setData({
          previewPadding: padding
        })
      }
    })
  },
  exportImage() {
    const save = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          wx.showToast({ title: '已保存到相册', icon: 'none' })
        },
        fail: () => {
          wx.showToast({ title: '保存失败，请检查权限', icon: 'none' })
        }
      })
    }
    this.ensureEffectReady()
      .then((path) => {
        save(path)
      })
      .catch(() => {
        wx.showToast({ title: '效果图未生成', icon: 'none' })
      })
  },
  exportExcel() {
    if (!this.taskData?.plan?.matrix?.length) {
      wx.showToast({
        title: '效果图未生成',
        icon: 'none'
      })
      return
    }
    try {
      const xlsxBuffer = buildXlsxBuffer(this.taskData)
      const path = saveBinaryFile(`effect_${Date.now()}.xlsx`, xlsxBuffer)
      wx.openDocument({
        filePath: path,
        showMenu: true,
        fileType: 'xlsx',
        fail: () => {
          try {
            const text = buildPrintText(this.taskData)
            const txtPath = saveFile(`effect_${Date.now()}.txt`, text)
            wx.openDocument({
              filePath: txtPath,
              showMenu: true,
              fileType: 'txt'
            })
            wx.showToast({
              title: 'Excel预览失败，已切换文本清单',
              icon: 'none'
            })
          } catch (error) {
            wx.showToast({
              title: '文件预览失败，请稍后重试',
              icon: 'none'
            })
          }
        }
      })
    } catch (error) {
      wx.showToast({
        title: 'Excel导出失败',
        icon: 'none'
      })
    }
  }
})
