const { buildXlsxBuffer, saveBinaryFile } = require('../../utils/exporter')
const { FLAT_ALGORITHM_VERSION } = require('../../utils/flat')
const { drawRoundBead } = require('../../utils/bead-preview')

Page({
  data: {
    imagePath: '',
    sizeLabel: '',
    paletteVersion: '221',
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
    if (this.redirectStalePlan(taskData)) return
    this.loadTask(taskData)
  },
  loadTask(taskData) {
    this.taskData = taskData
    this.renderEpoch = (this.renderEpoch || 0) + 1
    this.effectImagePath = ''
    this.effectCodeImagePath = ''
    this.roundImagePath = ''
    this.setData({
      generationLabel: `${taskData.plan.appVersion} · 纯色优化`,
      editedLabel: taskData.plan.manualEdited ? `已手动调整 · ${taskData.plan.editedAppVersion}` : '',
      emptyCells: taskData.plan.emptyCells || 0,
      imagePath: taskData.imagePath,
      sizeLabel: taskData.sizeLabel,
      paletteVersion: taskData.plan.paletteVersion || taskData.paletteVersion || '221',
      grid: `${taskData.plan.gridWidth || taskData.plan.gridSize}×${taskData.plan.gridHeight || taskData.plan.gridSize}`,
      trimmedBeads: taskData.plan.trimmedBeads || 0,
      colorCount: taskData.plan.detail.length,
      total: taskData.plan.total,
      detail: taskData.plan.detail.map((item) => ({
        ...item,
        colorLabel: item.beadCode || String(item.colorIndex).padStart(2, '0')
      }))
    })
  },
  onShow() {
    const taskData = getApp().globalData.taskData
    if (this.redirectStalePlan(taskData)) return
    if (taskData?.plan && taskData.plan !== this.taskData?.plan) {
      this.loadTask(taskData)
      if (this.ready) this.refreshPreview()
    }
  },
  redirectStalePlan(taskData) {
    if (this.redirectingStalePlan) return true
    if (!taskData?.plan || taskData.plan.algorithmVersion === FLAT_ALGORITHM_VERSION) return false
    this.redirectingStalePlan = true
    wx.redirectTo({
      url: '/pages/params/params?updated=1',
      fail: () => {
        this.redirectingStalePlan = false
        wx.showToast({ title: '算法已更新，请返回参数页重新转换', icon: 'none' })
      }
    })
    return true
  },
  onReady() {
    if (this.redirectingStalePlan) return
    this.ready = true
    this.renderEffectImage().catch(() => {})
  },
  refreshPreview() {
    // Wait for any old render to settle, then render the updated plan.
    Promise.allSettled([this.effectRenderPromise, this.codeRenderPromise, this.roundRenderPromise]).then(() => {
      if (this.data.previewMode === 'round') this.renderRoundImage().catch(() => {})
      if (this.data.previewMode === 'effect_code') this.renderEffectCodeImage().catch(() => {})
      else if (this.data.previewMode === 'effect') this.renderEffectImage().catch(() => {})
    })
  },
  async editPlan() {
    if (this.openingEditor) return
    this.openingEditor = true
    await Promise.allSettled([this.effectRenderPromise, this.codeRenderPromise, this.roundRenderPromise])
    wx.navigateTo({ url: '/pages/editor/editor',
      fail: () => wx.showToast({ title: '编辑页打开失败，请重试', icon: 'none' }),
      complete: () => { this.openingEditor = false }
    })
  },
  switchPreview(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.previewMode) {
      return
    }
    this.setData({ previewMode: mode }, () => {
      if (mode === 'round' && !this.roundImagePath) {
        setTimeout(() => { this.renderRoundImage().catch(() => {}) }, 50)
      }
      if (mode === 'effect' && !this.effectImagePath) {
        setTimeout(() => {
          this.renderEffectImage().catch(() => {})
        }, 50)
      }
      if (mode === 'effect_code' && !this.effectCodeImagePath) {
        setTimeout(() => {
          this.renderEffectCodeImage().catch(() => {})
        }, 50)
      }
    })
  },
  renderEffectImage() {
    if (!this.effectRenderPromise) {
      this.effectRenderPromise = this.drawEffectImage().finally(() => {
        this.effectRenderPromise = null
      })
    }
    return this.effectRenderPromise
  },
  renderEffectCodeImage() {
    if (!this.codeRenderPromise) {
      this.codeRenderPromise = this.drawEffectCodeImage().finally(() => {
        this.codeRenderPromise = null
      })
    }
    return this.codeRenderPromise
  },
  drawEffectImage() { return this.drawPreview(false) },
  renderRoundImage() {
    if (!this.roundRenderPromise) {
      this.roundRenderPromise = this.drawPreview(false, true).finally(() => { this.roundRenderPromise = null })
    }
    return this.roundRenderPromise
  },
  drawEffectCodeImage() { return this.drawPreview(true) },
  async drawPreview(withCode, round = false) {
    const plan = this.taskData?.plan
    const matrix = plan?.matrix || []
    if (!matrix.length) return
    const epoch = this.renderEpoch
    try {
      const { canvas, width, height } = await this.getCanvasNode(round ? '#roundCanvas' : withCode ? '#effectCodeCanvas' : '#effectCanvas')
      if (epoch !== this.renderEpoch) return
      const ctx = canvas.getContext('2d')
      const rows = matrix.length, cols = matrix[0].length
      const colors = this.buildColorMap(plan.detail)
      const beadSprites = {}
      if (round && typeof wx.createOffscreenCanvas === 'function') {
        for (const item of plan.detail) {
          try {
            const sprite = wx.createOffscreenCanvas({ type: '2d', width: 48, height: 48 })
            sprite.width = 48; sprite.height = 48
            drawRoundBead(sprite.getContext('2d'), item.code, 0, 0, 48)
            beadSprites[item.colorIndex] = sprite
          } catch (_) { break }
        }
      }
      const labels = Object.fromEntries(plan.detail.map(c => [c.colorIndex, c.beadCode || String(c.colorIndex)]))
      const draw = this.getEffectDrawRect(width, height)
      const cell = draw.size / Math.max(rows, cols)
      draw.left += (draw.size - cols * cell) / 2
      draw.top += (draw.size - rows * cell) / 2
      ctx.clearRect(0, 0, width, height)
      if (round) { ctx.fillStyle = '#f1f3f5'; ctx.fillRect(0, 0, width, height) }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const value = matrix[row][col]
          const color = colors[value] || '#FFFFFF'
          const x = draw.left + col * cell, y = draw.top + row * cell
          if (round) {
            if (value) {
              if (beadSprites[value]) ctx.drawImage(beadSprites[value], x, y, cell, cell)
              else drawRoundBead(ctx, color, x, y, cell)
            }
            continue
          }
          ctx.fillStyle = value ? color : ((row + col) % 2 ? '#cdd6df' : '#e8edf2')
          ctx.fillRect(x, y, cell, cell)
          if (!value && cell >= 6) {
            ctx.fillStyle = '#f7f9fb'
            ctx.fillRect(x, y, cell / 2, cell / 2)
            ctx.fillRect(x + cell / 2, y + cell / 2, cell / 2, cell / 2)
          }
          if (withCode && value && cell >= 2) {
            ctx.fillStyle = this.getTextColorByBg(color)
            ctx.font = `${Math.max(3, cell * .28)}px sans-serif`
            ctx.fillText(labels[value], x + cell / 2, y + cell / 2, cell * .9)
          }
        }
        if (round && rows > 128 && row % 32 === 31) {
          await new Promise(resolve => setTimeout(resolve, 0))
          if (epoch !== this.renderEpoch) return
        }
      }
      if (!round && cell >= 3) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.lineWidth = Math.max(.4, cell * .04)
        ctx.beginPath()
        for (let row = 0; row <= rows; row++) {
          ctx.moveTo(draw.left, draw.top + row * cell)
          ctx.lineTo(draw.left + cols * cell, draw.top + row * cell)
        }
        for (let col = 0; col <= cols; col++) {
          ctx.moveTo(draw.left + col * cell, draw.top)
          ctx.lineTo(draw.left + col * cell, draw.top + rows * cell)
        }
        ctx.stroke()
      }
      const path = await this.canvasToImagePath(canvas, width, height)
      if (epoch !== this.renderEpoch) return
      if (round) this.roundImagePath = path
      else if (withCode) this.effectCodeImagePath = path
      else {
        this.canvasNode = canvas
        this.canvasSize = { width, height }
        this.effectImagePath = path
      }
      return path
    } catch (error) {
      if (epoch === this.renderEpoch) wx.showToast({ title: '效果图生成失败，请重试', icon: 'none' })
      throw error
    }
  },
  ensureEffectReady() {
    if (this.data.previewMode === 'round') return this.roundImagePath ? Promise.resolve(this.roundImagePath) : this.renderRoundImage()
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
  parseSaveErrorType(error) {
    const errMsg = String(error?.errMsg || error?.message || '').toLowerCase()
    if (/privacy/.test(errMsg)) {
      return 'privacy_denied'
    }
    if (/cancel/.test(errMsg)) {
      return 'user_cancel'
    }
    if (/file.*not.*found|no such file|invalid file/.test(errMsg)) {
      return 'invalid_file'
    }
    if (/auth deny|authorize no response|permission/.test(errMsg)) {
      return 'permission_denied'
    }
    if (/saveimage/.test(errMsg) && /fail/.test(errMsg)) {
      return 'save_failed'
    }
    return 'unknown'
  },
  showSaveErrorToast(type) {
    const map = {
      privacy_denied: '请先同意隐私授权',
      permission_denied: '未开启相册权限',
      invalid_file: '图片缓存失效，请重试',
      user_cancel: '已取消保存',
      save_failed: '保存失败，请重试',
      unknown: '保存失败，请重试'
    }
    wx.showToast({ title: map[type] || map.unknown, icon: 'none' })
  },
  ensurePrivacyAuthorize() {
    return new Promise((resolve, reject) => {
      if (typeof wx.getPrivacySetting !== 'function' || typeof wx.requirePrivacyAuthorize !== 'function') {
        resolve()
        return
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (!res?.needAuthorization) {
            resolve()
            return
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(),
            fail: () => reject(new Error('privacy denied'))
          })
        },
        fail: () => {
          resolve()
        }
      })
    })
  },
  ensureAlbumPermission() {
    return new Promise((resolve, reject) => {
      this.ensurePrivacyAuthorize()
        .then(() => {
          wx.getSetting({
            success: (settingRes) => {
              const authSetting = settingRes?.authSetting || {}
              if (authSetting['scope.writePhotosAlbum']) {
                resolve()
                return
              }
              wx.authorize({
                scope: 'scope.writePhotosAlbum',
                success: () => {
                  resolve()
                },
                fail: () => {
                  wx.showModal({
                    title: '需要相册权限',
                    content: '请在设置中开启“保存到相册”权限后重试',
                    confirmText: '去设置',
                    success: (modalRes) => {
                      if (!modalRes.confirm) {
                        reject(new Error('album permission denied'))
                        return
                      }
                      wx.openSetting({
                        success: (openRes) => {
                          if (openRes?.authSetting?.['scope.writePhotosAlbum']) {
                            resolve()
                            return
                          }
                          reject(new Error('album permission denied'))
                        },
                        fail: () => {
                          reject(new Error('open setting failed'))
                        }
                      })
                    },
                    fail: () => {
                      reject(new Error('show modal failed'))
                    }
                  })
                }
              })
            },
            fail: () => {
              reject(new Error('get setting failed'))
            }
          })
        })
        .catch(reject)
    })
  },
  exportImage() {
    const save = (filePath, retryCount = 0) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          wx.showToast({ title: '已保存到相册', icon: 'none' })
        },
        fail: (error) => {
          const type = this.parseSaveErrorType(error)
          if (type === 'invalid_file' && retryCount < 1) {
            this.effectImagePath = ''
            this.roundImagePath = ''
            this.ensureEffectReady()
              .then((newPath) => {
                save(newPath, retryCount + 1)
              })
              .catch(() => {
                wx.showToast({ title: '效果图未生成', icon: 'none' })
              })
            return
          }
          if (type === 'permission_denied' && retryCount < 1) {
            this.ensureAlbumPermission()
              .then(() => {
                save(filePath, retryCount + 1)
              })
              .catch((permError) => {
                this.showSaveErrorToast(this.parseSaveErrorType(permError))
              })
            return
          }
          this.showSaveErrorToast(type)
        }
      })
    }
    this.ensureEffectReady()
      .then((path) => {
        this.ensureAlbumPermission()
          .then(() => {
            save(path)
          })
          .catch((error) => {
            this.showSaveErrorToast(this.parseSaveErrorType(error))
          })
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
      const path = saveBinaryFile('effect_current.xlsx', xlsxBuffer)
      wx.openDocument({
        filePath: path,
        showMenu: true,
        fileType: 'xlsx',
        fail: () => {
          wx.showToast({
            title: 'Excel预览失败，请稍后重试',
            icon: 'none'
          })
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
