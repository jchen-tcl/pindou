const { getPalette } = require('./colors')
const { quantize, normalizeStyle } = require('./quantize')
const { cleanAssignments } = require('./cleanup')

const GRID_TO_TOTAL = {
  '32x32': 1024,
  '48x48': 2304,
  '64x64': 4096,
  '128x128': 16384
}

async function generateBeadPlan({ imagePath, grid = '48x48', colorCount = 16, styleMode = 'cute', cropRatio = 'contain', paletteVersion = '221' }) {
  const PALETTE = getPalette(paletteVersion)
  if (!GRID_TO_TOTAL[grid]) grid = '48x48'
  const total = GRID_TO_TOTAL[grid] || 2304
  const gridSize = Number(String(grid).split('x')[0]) || 48
  const safeColorCount = Math.max(1, Math.min(Math.floor(Number(colorCount) || 16), PALETTE.length))
  const palette = PALETTE.map((item, index) => ({
    ...item,
    index,
    rgb: hexToRgb(item.code)
  }))
  const imageInfo = await getImageInfoSafe(imagePath)
  const pixelList = (await samplePixels(imagePath, imageInfo, gridSize, cropRatio))
    .map(([r, g, b]) => normalizeStyle(r, g, b, styleMode))
  const mapped = quantize(pixelList, palette, safeColorCount)
  const assignments = styleMode === 'clean' ? cleanAssignments(mapped, gridSize) : mapped
  const countMap = new Map()
  const cellsByColor = {}
  const matrix = new Array(gridSize)
  for (let row = 0; row < gridSize; row += 1) {
    const rowColors = new Array(gridSize)
    for (let col = 0; col < gridSize; col += 1) {
      const i = row * gridSize + col
      const color = assignments[i]
      countMap.set(color.index, (countMap.get(color.index) || 0) + 1)
      if (!cellsByColor[color.index]) {
        cellsByColor[color.index] = []
      }
      cellsByColor[color.index].push({ row: row + 1, col: col + 1 })
      rowColors[col] = color.index + 1
    }
    matrix[row] = rowColors
  }
  const detail = palette
    .filter((item) => countMap.has(item.index))
    .map((item) => ({
      name: item.name,
      beadCode: item.id,
      code: item.code,
      count: countMap.get(item.index),
      colorIndex: item.index + 1
    }))
    .sort((a, b) => b.count - a.count)
  return {
    total,
    paletteVersion: String(paletteVersion) === '291' ? '291' : '221',
    detail,
    matrix,
    gridSize,
    cellsByColor
  }
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: (res) => resolve(res),
      fail: reject
    })
  })
}

async function samplePixels(imagePath, imageInfo, gridSize, cropRatio) {
  const { canvas, ctx } = createSamplingCanvas(gridSize)
  let rendered = await tryRenderPath(canvas, ctx, imagePath, imageInfo, gridSize, cropRatio)
  for (const quality of [82, 60]) {
    if (rendered) break
    const path = await transcodeImage(imagePath, quality)
    if (path === imagePath) continue
    rendered = await tryRenderPath(canvas, ctx, path, await getImageInfoSafe(path), gridSize, cropRatio)
  }
  if (!rendered) {
    throw new Error('IMAGE_DECODE_FAILED')
  }
  const data = ctx.getImageData(0, 0, gridSize, gridSize).data
  const pixels = []
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255
    const r = Math.round(data[i] * alpha + 255 * (1 - alpha))
    const g = Math.round(data[i + 1] * alpha + 255 * (1 - alpha))
    const b = Math.round(data[i + 2] * alpha + 255 * (1 - alpha))
    pixels.push([r, g, b])
  }
  return pixels
}

function createSamplingCanvas(gridSize) {
  let canvas = null
  try {
    canvas = wx.createOffscreenCanvas({ type: '2d' })
  } catch (error) {
    canvas = null
  }
  if (!canvas) {
    try {
      canvas = wx.createOffscreenCanvas()
    } catch (error) {
      throw new Error('CANVAS_CONTEXT_FAILED')
    }
  }
  if (!canvas) throw new Error('CANVAS_CONTEXT_FAILED')
  canvas.width = gridSize
  canvas.height = gridSize
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('CANVAS_CONTEXT_FAILED')
  }
  return { canvas, ctx }
}

async function tryRenderPath(canvas, ctx, imagePath, imageInfo, gridSize, cropRatio) {
  ctx.clearRect(0, 0, gridSize, gridSize)
  if (imageInfo?.width && imageInfo?.height) {
    try {
      drawByImageInfo(ctx, imagePath, imageInfo, gridSize, cropRatio)
      if (hasPixels(ctx, gridSize)) {
        return true
      }
    } catch (error) {}
  }
  try {
    await drawByDecoder(canvas, ctx, imagePath, gridSize, cropRatio)
    return hasPixels(ctx, gridSize)
  } catch (error) {
    return false
  }
}

function hasPixels(ctx, gridSize) {
  const data = ctx.getImageData(0, 0, gridSize, gridSize).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      return true
    }
  }
  return false
}

function drawByImageInfo(ctx, imagePath, imageInfo, gridSize, cropRatio) {
  const sw = imageInfo.width
  const sh = imageInfo.height
  drawImageToGrid(ctx, imagePath, sw, sh, gridSize, cropRatio)
}

function drawImageToGrid(ctx, image, sw, sh, gridSize, cropRatio) {
  if (cropRatio === 'contain') {
    const scale = gridSize / Math.max(sw, sh)
    const width = sw * scale
    const height = sh * scale
    ctx.drawImage(image, 0, 0, sw, sh, (gridSize - width) / 2, (gridSize - height) / 2, width, height)
    return
  }
  const rect = getCropRect(sw, sh, cropRatio)
  ctx.drawImage(image, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, gridSize, gridSize)
}

function drawByDecoder(canvas, ctx, imagePath, gridSize, cropRatio) {
  return new Promise((resolve, reject) => {
    try {
      if (!canvas || typeof canvas.createImage !== 'function') {
        reject(new Error('CREATE_IMAGE_UNAVAILABLE'))
        return
      }
      const image = canvas.createImage()
      image.onload = () => {
        try {
          drawImageToGrid(ctx, image, image.width, image.height, gridSize, cropRatio)
          resolve()
        } catch (error) {
          reject(error)
        }
      }
      image.onerror = reject
      image.src = imagePath
    } catch (error) {
      reject(error)
    }
  })
}

function getCropRect(sw, sh, cropRatio) {
  const ratio = parseRatio(cropRatio)
  const srcRatio = sw / sh
  let sWidth = sw
  let sHeight = sh
  if (srcRatio > ratio) {
    sWidth = Math.floor(sh * ratio)
  } else {
    sHeight = Math.floor(sw / ratio)
  }
  const sx = Math.floor((sw - sWidth) / 2)
  const sy = Math.floor((sh - sHeight) / 2)
  return { sx, sy, sWidth, sHeight }
}

function parseRatio(value) {
  if (typeof value !== 'string' || !value.includes(':')) {
    return 1
  }
  const [w, h] = value.split(':').map((n) => Number(n))
  if (!w || !h) {
    return 1
  }
  return w / h
}

function transcodeImage(imagePath, quality = 80) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: imagePath,
      quality,
      success: (res) => resolve(res.tempFilePath || imagePath),
      fail: () => resolve(imagePath)
    })
  })
}

async function getImageInfoSafe(src) {
  try {
    return await getImageInfo(src)
  } catch (error) {
    return null
  }
}

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((s) => s + s).join('') : value
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

module.exports = {
  generateBeadPlan
}
