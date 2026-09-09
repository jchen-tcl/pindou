const { toOklab, distance, quantize } = require('./quantize')
const { cleanAssignments } = require('./cleanup')
const FLAT_ALGORITHM_VERSION = 'flat-v3'

function canMergeFill(left, right) {
  // Light pastel fills can be close to white in total distance while carrying
  // a distinct hue. Preserve that chromatic difference before merging shades.
  if (left[0] > 0.85 && right[0] > 0.85 &&
      Math.hypot(left[1] - right[1], left[2] - right[2]) > 0.025) return false
  return distance(left, right) <= 0.09 ** 2
}

function isBoundaryBlend(center, left, right) {
  if (distance(left.lab, right.lab) < 0.09 ** 2) return false
  const delta = right.rgb.map((v, i) => v - left.rgb[i])
  const length = delta.reduce((sum, v) => sum + v * v, 0)
  const t = center.rgb.reduce((sum, v, i) => sum + (v - left.rgb[i]) * delta[i], 0) / length
  if (t < 0.08 || t > 0.92) return false
  const residual = center.rgb.reduce((sum, v, i) => sum + (v - left.rgb[i] - t * delta[i]) ** 2, 0)
  return residual < 3 * 18 ** 2
}

// Learn colors from flat interiors, before downsampling mixes their boundaries.
// RGB bins bound the work; Oklab distances merge perceptually similar shades.
function flattenColors(pixels, width, diagnostics = {}) {
  if (!pixels.length || !Number.isInteger(width) || width < 1 || pixels.length % width) {
    throw new Error('INVALID_SAMPLE_GRID')
  }
  const bins = new Map()
  const keys = pixels.map(rgb => ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3))
  pixels.forEach((rgb, i) => {
    let bin = bins.get(keys[i])
    if (!bin) {
      bin = { key: keys[i], sum: [0, 0, 0], count: 0, stable: 0, core: 0, transitions: 0 }
      bins.set(keys[i], bin)
    }
    bin.count++
    rgb.forEach((c, channel) => { bin.sum[channel] += c })
  })
  for (const bin of bins.values()) {
    bin.rgb = bin.sum.map(c => Math.round(c / bin.count))
    bin.lab = toOklab(bin.rgb)
  }
  const samples = keys.map(key => bins.get(key))
  const radius = Math.max(1, Math.round(width / 192))
  const height = pixels.length / width
  samples.forEach((bin, i) => {
    const x = i % width
    const neighbors = [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1,
      i >= width ? i - width : -1, i + width < pixels.length ? i + width : -1].filter(n => n >= 0)
    // Three agreeing neighbors reject most antialiased rims without blurring.
    if (neighbors.filter(n => distance(bin.lab, samples[n].lab) < 0.035 ** 2).length >= Math.min(3, neighbors.length)) {
      bin.stable++
    }
    if (radius === 1) { bin.core = bin.stable; return }
    const y = Math.floor(i / width)
    const left = x >= radius ? samples[i - radius] : null
    const right = x + radius < width ? samples[i + radius] : null
    const top = y >= radius ? samples[i - radius * width] : null
    const bottom = y + radius < height ? samples[i + radius * width] : null
    const distant = [left, right, top, bottom].filter(Boolean)
    if (distant.filter(other => distance(bin.lab, other.lab) < 0.035 ** 2).length >= Math.min(3, distant.length)) bin.core++
    if ((left && right && isBoundaryBlend(bin, left, right)) ||
        (top && bottom && isBoundaryBlend(bin, top, bottom))) bin.transitions++
  })
  const ranked = Array.from(bins.values()).sort((a, b) => b.stable - a.stable || b.count - a.count || a.key - b.key)
  const anchors = []
  const minSupport = 3
  let rejectedTransitionBins = 0
  for (const bin of ranked) {
    if (bin.stable < minSupport) continue
    // At 128, a one-pixel antialiased rim can become two samples wide and pass
    // the old neighbor test. Reject thin blends at a resolution-aware radius.
    // A small independent accent or solid gray area is not a boundary blend.
    if (bin.core < minSupport && bin.transitions / bin.count > 0.6) {
      rejectedTransitionBins++
      continue
    }
    if (anchors.every(anchor => !canMergeFill(bin.lab, anchor.lab))) anchors.push(bin)
  }
  // Thin ink strokes may have no flat interior after sampling. Give their most
  // frequent dark neutral a shared anchor, instead of splitting their votes.
  const ink = ranked.filter(bin => bin.lab[0] < 0.45 && Math.hypot(bin.lab[1], bin.lab[2]) < 0.04)
    .sort((a, b) => b.count - a.count || a.key - b.key)[0]
  if (ink && !anchors.some(anchor => anchor.lab[0] < 0.45 && Math.hypot(anchor.lab[1], anchor.lab[2]) < 0.04)) {
    anchors.push(ink)
  }
  // A textured input may have no reliable interiors. Leave its colors intact.
  diagnostics.sourceColorBins = bins.size
  diagnostics.interiorRadius = radius
  diagnostics.rejectedTransitionBins = rejectedTransitionBins
  diagnostics.anchorColorCount = anchors.length
  diagnostics.flatFallback = !anchors.length
  if (!anchors.length) return pixels
  for (const bin of bins.values()) {
    // Gray antialiasing around ink must not turn into colored beads just because
    // a blue/pink fill happens to have similar lightness.
    const chroma = Math.hypot(bin.lab[1], bin.lab[2])
    const compatible = anchors.filter(anchor => {
      const other = Math.hypot(anchor.lab[1], anchor.lab[2])
      return other < 0.025 || (chroma >= 0.025 &&
        (bin.lab[1] * anchor.lab[1] + bin.lab[2] * anchor.lab[2]) / (chroma * other) > 0.5)
    })
    const candidates = compatible.length ? compatible : anchors
    let best = candidates[0]
    for (const anchor of candidates) {
      if (distance(bin.lab, anchor.lab) < distance(bin.lab, best.lab)) best = anchor
    }
    // Keep tiny high-contrast dark/white details even without an interior.
    if ((bin.lab[0] < 0.25 || bin.lab[0] > 0.96) && distance(bin.lab, best.lab) > 0.15 ** 2) {
      bin.flat = bin.rgb
    } else bin.flat = best.rgb
  }
  return samples.map(bin => bin.flat)
}

function quantizeFlat(pixels, sampleWidth, gridSize, palette, limit, diagnostics = {}) {
  const scale = sampleWidth / gridSize
  if (!Number.isInteger(scale) || scale < 1 || pixels.length !== sampleWidth * sampleWidth) {
    throw new Error('INVALID_SAMPLE_GRID')
  }
  const flat = flattenColors(pixels, sampleWidth, diagnostics)
  const cells = scale === 1 ? flat : []
  for (let row = 0; scale > 1 && row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const votes = new Map()
      const center = flat[(row * scale + Math.floor(scale / 2)) * sampleWidth + col * scale + Math.floor(scale / 2)]
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const rgb = flat[(row * scale + y) * sampleWidth + col * scale + x]
          const key = rgb.join(',')
          const vote = votes.get(key) || { rgb, count: 0, minX: x, maxX: x, minY: y, maxY: y }
          vote.count++
          vote.minX = Math.min(vote.minX, x)
          vote.maxX = Math.max(vote.maxX, x)
          vote.minY = Math.min(vote.minY, y)
          vote.maxY = Math.max(vote.maxY, y)
          votes.set(key, vote)
        }
      }
      // Dominant color, with the center sample breaking ties. No RGB averaging.
      const ranked = Array.from(votes.values()).sort((a, b) => b.count - a.count ||
        Number(b.rgb === center) - Number(a.rgb === center))
      // A light patch enclosed by ink is likely an eye highlight. Do not let
      // the thin-stroke rule fill it, even when ink crosses one side of its cell.
      let enclosedLight = false
      if (toOklab(ranked[0].rgb)[0] > 0.9) {
        const cx = col * scale + Math.floor(scale / 2)
        const cy = row * scale + Math.floor(scale / 2)
        let enclosingSides = 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          for (let step = 1; step <= scale * 2; step++) {
            const x = cx + dx * step, y = cy + dy * step
            if (x < 0 || y < 0 || x >= sampleWidth || y >= sampleWidth) break
            if (toOklab(flat[y * sampleWidth + x])[0] < 0.45) {
              enclosingSides++
              break
            }
          }
        }
        enclosedLight = enclosingSides >= 3
      }
      // Preserve a thin dark stroke crossing a cell even below 50% coverage.
      // Require spatial extent, so a corner speck does not grow into an outline.
      const stroke = !enclosedLight && ranked.find(vote => {
        const lab = toOklab(vote.rgb)
        return lab[0] < 0.45 && Math.hypot(lab[1], lab[2]) < 0.04 &&
          vote.count >= Math.ceil(scale * scale * 0.28) &&
          (vote.maxX - vote.minX === scale - 1 || vote.maxY - vote.minY === scale - 1) &&
          toOklab(ranked[0].rgb)[0] - lab[0] > 0.25
      })
      const winner = stroke || ranked[0]
      cells.push(winner.rgb)
    }
  }
  const mapped = quantize(cells, palette, limit)
  const colorMatches = new Map()
  cells.forEach((rgb, i) => {
    const key = rgb.join(',')
    let match = colorMatches.get(key)
    if (!match) {
      match = { sourceRgb: rgb, beadCode: mapped[i].id, beadRgb: mapped[i].rgb, count: 0 }
      colorMatches.set(key, match)
    }
    match.count++
  })
  diagnostics.colorMatches = Array.from(colorMatches.values()).sort((a, b) => b.count - a.count).slice(0, 24)
  return cleanAssignments(mapped, gridSize)
}

module.exports = { flattenColors, quantizeFlat, FLAT_ALGORITHM_VERSION }
