// A top-down, unmelted bead: circular rim, small center hole and subtle depth.
function drawRoundBead(ctx, color, x, y, cell) {
  const cx = x + cell / 2, cy = y + cell / 2
  ctx.beginPath()
  ctx.arc(cx, cy + cell * .025, cell * .47, 0, Math.PI * 2)
  ctx.fillStyle = '#00000020'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, cell * .45, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = '#00000025'
  ctx.lineWidth = cell * .035
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, cell * .39, Math.PI * 1.08, Math.PI * 1.8)
  ctx.strokeStyle = '#ffffff75'
  ctx.lineWidth = cell * .045
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, cell * .145, 0, Math.PI * 2)
  ctx.fillStyle = '#e6e9ed'
  ctx.fill()
  ctx.strokeStyle = '#00000040'
  ctx.lineWidth = cell * .045
  ctx.stroke()
}
module.exports = { drawRoundBead }
