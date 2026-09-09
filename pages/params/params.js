const { generateBeadPlan } = require('../../utils/bead')
const { recordPlanDiagnostics } = require('../../utils/diagnostics')
const { GRID_SIZES, parseGridSize } = require('../../utils/grid')

const GRID_OPTIONS = GRID_SIZES.map(size => ({ label: `${size}×${size}`, value: `${size}x${size}` }))

function paletteSettings(version, count) {
  const paletteVersion = String(version) === '291' ? '291' : '221'
  const maxColorCount = Number(paletteVersion)
  return {
    paletteVersion,
    maxColorCount,
    colorCount: Math.max(8, Math.min(maxColorCount, Math.floor(Number(count) || maxColorCount)))
  }
}

function getErrorMessage(error) {
  const code = error?.message
  if (code === 'INVALID_GRID_SIZE') return '请输入 1～1000 的整数格数'
  if (code === 'IMAGE_DECODE_FAILED') {
    return '图片解析失败，请先在相册里编辑后再保存'
  }
  if (code === 'CANVAS_CONTEXT_FAILED') {
    return '当前设备暂不支持该图片处理方式'
  }
  return '解析失败，请更换图片后重试'
}

Page({
  data: {
    imagePath: '',
    gridOptions: GRID_OPTIONS,
    sizeLabel: '约 24 × 24 cm（按 5 mm 间距估算）',
    grid: '48x48',
    customGrid: false,
    customSize: '',
    colorCount: 221,
    maxColorCount: 221,
    paletteVersion: '221'
  },
  onLoad(options = {}) {
    const app = getApp()
    const taskData = app.globalData.taskData || {}
    if (!taskData.imagePath) {
      wx.redirectTo({
        url: '/pages/index/index'
      })
      return
    }
    this.setData({
      updateNotice: options.updated === '1' ? '配色算法已更新，请重新生成图纸。' : '',
      imagePath: taskData.imagePath,
      sizeLabel: this.getSizeLabel(taskData.grid || '48x48'),
      grid: taskData.grid || '48x48',
      customGrid: !!taskData.grid && !GRID_OPTIONS.some(item => item.value === taskData.grid),
      customSize: taskData.grid ? taskData.grid.split('x')[0] : '',
      ...paletteSettings(taskData.paletteVersion, taskData.colorCount)
    })
  },
  getSizeLabel(grid) {
    const side = (Number(String(grid).split('x')[0]) || 48) * 0.5
    return `约 ${side} × ${side} cm（按 5 mm 间距估算）`
  },
  setGrid(e) {
    const grid = e.currentTarget.dataset.value
    if (grid === 'custom') {
      this.setData({ customGrid: true })
      this.setCustomSize({ detail: { value: this.data.customSize } })
      return
    }
    this.setData({ grid, customGrid: false, sizeLabel: this.getSizeLabel(grid) })
  },
  setCustomSize(e) {
    const customSize = String(e.detail.value).trim()
    const grid = `${customSize}x${customSize}`
    let sizeLabel = '请输入 1～1000 的整数格数'
    try { parseGridSize(grid); sizeLabel = this.getSizeLabel(grid) } catch (_) {}
    this.setData({ customSize, grid, sizeLabel })
  },
  setColorCount(e) {
    this.setData(paletteSettings(this.data.paletteVersion, e.detail.value))
  },
  setPaletteVersion(e) {
    this.setData(paletteSettings(e.detail.value))
  },
  async startConvert() {
    if (this.converting) {
      return
    }
    try { parseGridSize(this.data.grid) } catch (error) {
      wx.showToast({ title: getErrorMessage(error), icon: 'none' })
      return
    }
    this.converting = true
    const sizeLabel = this.getSizeLabel(this.data.grid)
    wx.showLoading({
      title: '正在转换',
      mask: true
    })
    try {
      const plan = await generateBeadPlan({
        imagePath: this.data.imagePath,
        grid: this.data.grid,
        colorCount: this.data.colorCount,
        styleMode: 'clean',
        paletteVersion: this.data.paletteVersion
      })
      recordPlanDiagnostics(plan)
      const app = getApp()
      const prev = app.globalData.taskData || {}
      app.globalData.taskData = {
        ...prev,
        sizeLabel,
        grid: this.data.grid,
        colorCount: this.data.colorCount,
        styleMode: 'clean',
        paletteVersion: plan.paletteVersion,
        plan
      }
      wx.showToast({
        title: '太棒啦，参数设置完成',
        icon: 'none'
      })
      wx.navigateTo({
        url: '/pages/result/result'
      })
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error),
        icon: 'none'
      })
    } finally {
      this.converting = false
      wx.hideLoading()
    }
  }
})
