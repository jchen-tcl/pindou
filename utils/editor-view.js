const MIN_EDIT_CELL = 12

function fitView(width, height, cols, rows) {
  const cell = Math.min(width / cols, height / rows)
  return { width, height, cols, rows, minCell: cell, cell,
    left: (width - cols * cell) / 2, top: (height - rows * cell) / 2 }
}

function clampView(view) {
  const clamp = (offset, extent, viewport) => extent <= viewport ? (viewport - extent) / 2 :
    Math.max(viewport - extent, Math.min(0, offset))
  view.left = clamp(view.left, view.cols * view.cell, view.width)
  view.top = clamp(view.top, view.rows * view.cell, view.height)
  return view
}

function zoomView(view, factor, point) {
  const cell = Math.max(view.minCell, Math.min(Math.max(64, view.minCell), view.cell * factor))
  const ratio = cell / view.cell
  view.left = point.x - (point.x - view.left) * ratio
  view.top = point.y - (point.y - view.top) * ratio
  view.cell = cell
  return clampView(view)
}

function cellAt(view, point) {
  const x = Math.floor((point.x - view.left) / view.cell)
  const y = Math.floor((point.y - view.top) / view.cell)
  return x >= 0 && x < view.cols && y >= 0 && y < view.rows ? { x, y } : null
}

function visibleCells(view) {
  return { x0: Math.max(0, Math.floor(-view.left / view.cell)),
    y0: Math.max(0, Math.floor(-view.top / view.cell)),
    x1: Math.min(view.cols, Math.ceil((view.width - view.left) / view.cell)),
    y1: Math.min(view.rows, Math.ceil((view.height - view.top) / view.cell)) }
}

module.exports = { MIN_EDIT_CELL, fitView, clampView, zoomView, cellAt, visibleCells }
