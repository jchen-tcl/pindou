const { generateBeadPlan } = require('../../utils/bead')

const SIZE_OPTIONS = [
  { label: '小号（入门）', value: 'small' },
  { label: '中号（推荐）', value: 'medium' },
  { label: '大号（进阶）', value: 'large' }
]

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
    sizeOptions: SIZE_OPTIONS,
    gridOptions: GRID_OPTIONS,
    size: 'medium',
    grid: '48x48',
    colorCount: 16,
    styleMode: 'cute'
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
      size: taskData.size || 'medium',
      grid: taskData.grid || '48x48',
      colorCount: taskData.colorCount || 16,
      styleMode: taskData.styleMode || 'cute'
    })
  },
  setSize(e) {
    this.setData({ size: e.currentTarget.dataset.value })
  },
  setGrid(e) {
    this.setData({ grid: e.currentTarget.dataset.value })
  },
  setColorCount(e) {
    this.setData({ colorCount: Number(e.detail.value) })
  },
  setStyleMode(e) {
    this.setData({ styleMode: e.detail.value })
  },
  async startConvert() {
    if (this.converting) {
      return
    }
    this.converting = true
    const sizeLabel = SIZE_OPTIONS.find((item) => item.value === this.data.size)?.label || '中号（推荐）'
    wx.showLoading({
      title: '正在转换',
      mask: true
    })
    try {
      const plan = await generateBeadPlan({
        imagePath: this.data.imagePath,
        grid: this.data.grid,
        colorCount: this.data.colorCount,
        styleMode: this.data.styleMode
      })
      const app = getApp()
      const prev = app.globalData.taskData || {}
      app.globalData.taskData = {
        ...prev,
        size: this.data.size,
        sizeLabel,
        grid: this.data.grid,
        colorCount: this.data.colorCount,
        styleMode: this.data.styleMode,
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
