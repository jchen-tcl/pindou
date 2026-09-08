const { generateBeadPlan } = require('../../utils/bead')

const GRID_OPTIONS = [
  { label: '32x32', value: '32x32' },
  { label: '48x48', value: '48x48' },
  { label: '64x64', value: '64x64' }
]

function getErrorMessage(error) {
  const code = error?.message
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
    colorCount: 16,
    paletteVersion: '221'
  },
  onLoad() {
    const app = getApp()
    const taskData = app.globalData.taskData || {}
    if (!taskData.imagePath) {
      wx.redirectTo({
        url: '/pages/index/index'
      })
      return
    }
    this.setData({
      imagePath: taskData.imagePath,
      sizeLabel: this.getSizeLabel(taskData.grid || '48x48'),
      grid: taskData.grid || '48x48',
      colorCount: taskData.colorCount || 16,
      paletteVersion: taskData.paletteVersion || '221'
    })
  },
  getSizeLabel(grid) {
    const side = (Number(String(grid).split('x')[0]) || 48) * 0.5
    return `约 ${side} × ${side} cm（按 5 mm 间距估算）`
  },
  setGrid(e) {
    const grid = e.currentTarget.dataset.value
    this.setData({ grid, sizeLabel: this.getSizeLabel(grid) })
  },
  setColorCount(e) {
    this.setData({ colorCount: Number(e.detail.value) })
  },
  setPaletteVersion(e) {
    this.setData({ paletteVersion: e.detail.value })
  },
  async startConvert() {
    if (this.converting) {
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
        styleMode: 'cute',
        paletteVersion: this.data.paletteVersion
      })
      const app = getApp()
      const prev = app.globalData.taskData || {}
      app.globalData.taskData = {
        ...prev,
        sizeLabel,
        grid: this.data.grid,
        colorCount: this.data.colorCount,
        styleMode: 'cute',
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
