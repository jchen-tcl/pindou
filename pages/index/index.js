const { APP_VERSION } = require('../../utils/version')

Page({
  data: {
    imagePath: '',
    appVersion: ''
  },
  onShow() {
    const app = getApp()
    const taskData = app.globalData.taskData || {}
    this.setData({
      imagePath: taskData.imagePath || '',
      appVersion: app.globalData.appVersion || APP_VERSION
    })
  },
  chooseImage() {
    if (this.picking) return
    this.picking = true
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: async (res) => {
        const path = res.tempFilePaths?.[0] || ''
        if (!path) {
          this.picking = false
          return
        }
        try {
          const safePath = await this.normalizeImage(path)
          this.saveImagePath(safePath)
        } catch (error) {
          wx.showToast({ title: '图片处理失败，请重试', icon: 'none' })
        } finally {
          this.picking = false
        }
      },
      fail: (error) => {
        this.picking = false
        if (/cancel/.test(error.errMsg || '')) return
        wx.showToast({
          title: '图片选择失败，请重试',
          icon: 'none'
        })
      }
    })
  },
  saveImagePath(path) {
    const app = getApp()
    const prev = app.globalData.taskData || {}
    app.globalData.taskData = {
      ...prev,
      imagePath: path,
      plan: null
    }
    this.setData({ imagePath: path })
    wx.showToast({
      title: '你真棒，完成第一步啦',
      icon: 'none'
    })
  },
  async normalizeImage(path) {
    const ext = this.getExt(path)
    const formatExt = ['heic', 'heif', 'tiff', 'tif', 'bmp', 'webp']
    const needConvert = formatExt.includes(ext)
    const info = await this.getImageInfoSafe(path)
    if (info?.width && info?.height && !needConvert) {
      return path
    }
    for (const quality of [82, 60]) {
      const converted = await this.compressImageSafe(path, quality)
      if (!converted) {
        continue
      }
      const convertedInfo = await this.getImageInfoSafe(converted)
      if (convertedInfo?.width && convertedInfo?.height) {
        return converted
      }
    }
    return path
  },
  getExt(path) {
    const file = String(path || '').split('?')[0]
    const parts = file.split('.')
    return parts.length > 1 ? parts.pop().toLowerCase() : ''
  },
  getImageInfoSafe(path) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: path,
        success: (res) => resolve(res),
        fail: () => resolve(null)
      })
    })
  },
  compressImageSafe(path, quality = 82) {
    return new Promise((resolve) => {
      wx.compressImage({
        src: path,
        quality,
        success: (res) => resolve(res.tempFilePath || ''),
        fail: () => resolve('')
      })
    })
  },
  goParams() {
    if (!this.data.imagePath) {
      wx.showToast({
        title: '先上传图片哦',
        icon: 'none'
      })
      return
    }
    wx.navigateTo({
      url: '/pages/params/params',
      fail: (error) => {
        console.error('打开参数页失败', error)
        wx.showToast({ title: '页面打开失败，请重新编译后重试', icon: 'none' })
      }
    })
  }
})
