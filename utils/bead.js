const { PALETTE } = require('./colors')

const GRID_TO_TOTAL = {
  '32x32': 1024,
  '48x48': 2304,
  '64x64': 4096
}

async function generateBeadPlan({ imagePath, grid = '48x48', colorCount = 16, styleMode = 'cute', cropRatio = '1:1' }) {
  const total = GRID_TO_TOTAL[grid] || 2304
  const gridSize = Number(String(grid).split('x')[0]) || 48
  const safeColorCount = Math.max(1, Math.min(Number(colorCount) || 16, PALETTE.length))
  const colors = PALETTE.slice(0, safeColorCount).map((item, index) => ({
    ...item,
    index,
    rgb: hexToRgb(item.code)
  }))
  const resolveNearestColor = createNearestColorResolver(colors)
  const imageInfo = await getImageInfoSafe(imagePath)
  const pixelList = await samplePixels(imagePath, imageInfo, gridSize, cropRatio)
  const countMap = new Map()
  const cellsByColor = {}
  const matrix = new Array(gridSize)
  for (let row = 0; row < gridSize; row += 1) {
    const rowColors = new Array(gridSize)
    for (let col = 0; col < gridSize; col += 1) {
      const i = row * gridSize + col
      const [r, g, b] = pixelList[i] || [255, 255, 255]
      const [sr, sg, sb] = normalizeStyle(r, g, b, styleMode)
      const color = resolveNearestColor(sr, sg, sb)
      countMap.set(color.index, (countMap.get(color.index) || 0) + 1)
      if (!cellsByColor[color.index]) {
        cellsByColor[color.index] = []
      }
      cellsByColor[color.index].push({ row: row + 1, col: col + 1 })
      rowColors[col] = color.index + 1
    }
    matrix[row] = rowColors
  }
  const detail = colors
    .filter((item) => countMap.has(item.index))
    .map((item) => ({
      name: item.name,
      code: item.code,
      count: countMap.get(item.index),
      colorIndex: item.index + 1
    }))
    .sort((a, b) => b.count - a.count)
  return {
    total,
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
  const candidatePaths = await buildCandidatePaths(imagePath)
  let rendered = false
  for (let i = 0; i < candidatePaths.length; i += 1) {
    const path = candidatePaths[i]
    const info = path === imagePath ? (imageInfo || await getImageInfoSafe(path)) : await getImageInfoSafe(path)
    rendered = await tryRenderPath(canvas, ctx, path, info, gridSize, cropRatio)
    if (rendered) {
      break
    }
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
    canvas = wx.createOffscreenCanvas()
  }
  canvas.width = gridSize
  canvas.height = gridSize
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('CANVAS_CONTEXT_FAILED')
  }
  return { canvas, ctx }
}

async function buildCandidatePaths(imagePath) {
  const list = [imagePath]
  const p82 = await transcodeImage(imagePath, 82)
  if (p82) {
    list.push(p82)
  }
  const p60 = await transcodeImage(p82 || imagePath, 60)
  if (p60) {
    list.push(p60)
  }
  return Array.from(new Set(list))
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
  const rect = getCropRect(sw, sh, cropRatio)
  ctx.drawImage(imagePath, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, gridSize, gridSize)
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
        const sw = image.width
        const sh = image.height
        const rect = getCropRect(sw, sh, cropRatio)
        ctx.drawImage(image, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, gridSize, gridSize)
        resolve()
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

function normalizeStyle(r, g, b, styleMode) {
  if (styleMode !== 'cute') {
    return [r, g, b]
  }
  const bright = 0.16
  const softenedR = Math.round(r + (255 - r) * bright)
  const softenedG = Math.round(g + (255 - g) * bright)
  const softenedB = Math.round(b + (255 - b) * bright)
  return [softenedR, softenedG, softenedB]
}

function nearestColor(r, g, b, colors) {
  let best = colors[0]
  let minDistance = Number.MAX_SAFE_INTEGER
  for (let i = 0; i < colors.length; i += 1) {
    const color = colors[i]
    const dr = r - color.rgb[0]
    const dg = g - color.rgb[1]
    const db = b - color.rgb[2]
    const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
    if (distance < minDistance) {
      minDistance = distance
      best = color
    }
  }
  return best
}

function createNearestColorResolver(colors) {
  const cache = new Map()
  return (r, g, b) => {
    const qr = r >> 3
    const qg = g >> 3
    const qb = b >> 3
    const key = `${qr}_${qg}_${qb}`
    if (cache.has(key)) {
      return cache.get(key)
    }
    const color = nearestColor(r, g, b, colors)
    cache.set(key, color)
    return color
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
