const { toOklab, distance } = require('./quantize')

// Replace only tiny, low-contrast components surrounded by one dominant color.
// Read from the original array throughout: no cascading erosion of outlines.
function cleanAssignments(colors, width) {
  const output = colors.slice()
  const visited = new Uint8Array(colors.length)
  const labs = new Map(colors.map(c => [c.index, toOklab(c.rgb)]))
  const height = colors.length / width
  const neighbors = i => {
    const x = i % width, y = Math.floor(i / width)
    return [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1, y + 1 < height ? i + width : -1].filter(v => v >= 0)
  }
  for (let start = 0; start < colors.length; start++) {
    if (visited[start]) continue
    const component = [start], boundary = new Map()
    visited[start] = 1
    let edges = 0
    for (let cursor = 0; cursor < component.length; cursor++) {
      for (const next of neighbors(component[cursor])) {
        if (colors[next].index === colors[start].index) {
          if (!visited[next]) { visited[next] = 1; component.push(next) }
        } else {
          const color = colors[next]
          boundary.set(color.index, { color, count: (boundary.get(color.index)?.count || 0) + 1 })
          edges++
        }
      }
    }
    if (component.length > 2 || !edges) continue
    const winner = Array.from(boundary.values()).sort((a, b) => b.count - a.count || a.color.index - b.color.index)[0]
    if (winner.count / edges < 0.75) continue
    if (distance(labs.get(colors[start].index), labs.get(winner.color.index)) > 0.08 ** 2) continue
    component.forEach(i => { output[i] = winner.color })
  }
  return output
}
module.exports = { cleanAssignments }
