// Only remove complete outer white rows/columns, never white inside the subject.
function whiteBounds(colors, width) {
  const height = colors.length / width
  let left = width, right = -1, top = height, bottom = -1
  for (let i = 0; i < colors.length; i++) {
    const rgb = colors[i].rgb
    const white = Math.min(...rgb) >= 240 && Math.max(...rgb) - Math.min(...rgb) <= 10
    if (white) continue
    const x = i % width, y = Math.floor(i / width)
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  // An entirely white input has no identifiable subject; preserve it.
  if (right < 0) return { left: 0, top: 0, width, height }
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}
module.exports = { whiteBounds }
