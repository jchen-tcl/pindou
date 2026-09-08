// sRGB -> Oklab; color space reference: https://www.w3.org/TR/css-color-4/
function toOklab(rgb) {
  const [r, g, b] = rgb.map(value => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function distance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function pixelKey(rgb) { return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2] }

// Add the color that reduces total perceptual error most.
// Bounded by requested color count, suitable for the larger MARD palette.
function quantize(pixels, palette, limit) {
  if (!pixels.length || !palette.length) throw new Error('EMPTY_COLORS')
  const count = Math.max(1, Math.min(palette.length, Math.floor(Number(limit) || 1)))
  const labs = palette.map(color => toOklab(color.rgb))
  const histogram = new Map()
  pixels.forEach(rgb => {
    const key = pixelKey(rgb)
    if (histogram.has(key)) histogram.get(key).count++
    else {
      const lab = toOklab(rgb)
      histogram.set(key, { key, count: 1, distances: Float64Array.from(labs, color => distance(lab, color)) })
    }
  })
  const bins = Array.from(histogram.values())
  const active = palette.map((_, i) => i)
  const usage = new Array(palette.length).fill(0)
  function nearest(bin, indices) {
    let best = indices[0]
    for (const i of indices) if (bin.distances[i] < bin.distances[best]) best = i
    return best
  }
  bins.forEach(bin => { usage[nearest(bin, active)] += bin.count })
  // Keep the old frequency strategy as a quality floor under the same metric.
  const baseline = active.slice().sort((a, b) => usage[b] - usage[a] || a - b).slice(0, count)
  const selectedGreedy = []
  const bestDistances = new Float64Array(bins.length).fill(Infinity)
  if (count === palette.length) selectedGreedy.push(...active)
  while (selectedGreedy.length < count) {
    let candidate = -1, bestError = Infinity
    for (const i of active) {
      if (selectedGreedy.includes(i)) continue
      let sum = 0
      for (let b = 0; b < bins.length; b++) {
        sum += bins[b].count * Math.min(bestDistances[b], bins[b].distances[i])
      }
      if (sum < bestError) { bestError = sum; candidate = i }
    }
    selectedGreedy.push(candidate)
    for (let b = 0; b < bins.length; b++) bestDistances[b] = Math.min(bestDistances[b], bins[b].distances[candidate])
    if (bestError === 0) break
  }
  const error = indices => bins.reduce((sum, bin) => sum + bin.count * bin.distances[nearest(bin, indices)], 0)
  const selected = error(selectedGreedy) <= error(baseline) ? selectedGreedy : baseline
  const mapping = new Map(bins.map(bin => [bin.key, palette[nearest(bin, selected)]]))
  return pixels.map(rgb => mapping.get(pixelKey(rgb)))
}

function normalizeStyle(r, g, b, mode) {
  if (mode !== 'cute') return [r, g, b]
  const lightness = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
  // Preserve dark outlines; soften mainly the midtones.
  const strength = 0.16 * Math.min(1, Math.max(0, (lightness - 0.2) / 0.35))
  return [r, g, b].map(c => Math.round(c + (255 - c) * strength))
}

module.exports = { quantize, toOklab, distance, normalizeStyle }
