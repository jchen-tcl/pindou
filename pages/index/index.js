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
    this.pickImage(['album'])
  },
  takePhoto() {
    this.pickImage(['camera'])
  },
  pickImage(sourceType) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType,
      success: async (res) => {
        const path = res.tempFilePaths?.[0] || ''
        if (!path) {
          return
        }
        const safePath = await this.normalizeImage(path)
        const finalPath = await this.tryCropImage(safePath, true)
        this.saveImagePath(finalPath)
      },
      fail: () => {
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
      imagePath: path
    }
    this.setData({ imagePath: path })
    wx.showToast({
      title: '你真棒，完成第一步啦',
      icon: 'none'
    })
  },
  async tryCropImage(path, askConfirm = false) {
    if (!path) {
      return path
    }
    const info = await this.getImageInfoSafe(path)
    if (!info?.width || !info?.height) {
      return path
    }
    if (Math.abs(info.width - info.height) <= 2) {
      return path
    }
    if (askConfirm) {
      const confirmed = await this.confirmCrop()
      if (!confirmed) {
        return path
      }
    }
    wx.showLoading({
      title: '正在裁切',
      mask: true
    })
    try {
      return await this.cropToSquare(path)
    } catch (error) {
      return path
    } finally {
      wx.hideLoading()
    }
  },
  confirmCrop() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '是否裁切',
        content: '可将图片裁切为正方形，更适合拼豆预览',
        confirmText: '裁切',
        cancelText: '跳过',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },
  cropToSquare(path) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: (info) => {
          const side = Math.min(info.width, info.height)
          const sx = Math.floor((info.width - side) / 2)
          const sy = Math.floor((info.height - side) / 2)
          const exportSize = Math.min(side, 1200)
          const ctx = wx.createCanvasContext('cropCanvas', this)
          ctx.clearRect(0, 0, exportSize, exportSize)
          ctx.drawImage(path, sx, sy, side, side, 0, 0, exportSize, exportSize)
          ctx.draw(false, () => {
            wx.canvasToTempFilePath(
              {
                canvasId: 'cropCanvas',
                x: 0,
                y: 0,
                width: exportSize,
                height: exportSize,
                destWidth: exportSize,
                destHeight: exportSize,
                fileType: 'jpg',
                quality: 0.95,
                success: (res) => resolve(res.tempFilePath || path),
                fail: reject
              },
              this
            )
          })
        },
        fail: reject
      })
    })
  },
  async normalizeImage(path) {
    const ext = this.getExt(path)
    const formatExt = ['heic', 'heif', 'tiff', 'tif', 'bmp', 'webp']
    const needConvert = formatExt.includes(ext)
    const info = await this.getImageInfoSafe(path)
    const compressedList = [
      await this.compressImageSafe(path, 82),
      await this.compressImageSafe(path, 60)
    ]
    for (let i = 0; i < compressedList.length; i += 1) {
      const converted = compressedList[i]
      if (!converted) {
        continue
      }
      const convertedInfo = await this.getImageInfoSafe(converted)
      if (convertedInfo?.width && convertedInfo?.height) {
        return converted
      }
    }
    if (info?.width && info?.height && !needConvert) {
      return path
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
      url: '/pages/params/params'
    })
  }
})
