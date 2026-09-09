const MAX_GRID_SIZE = 1000
const GRID_SIZES = [32, 48, 64, 128, 256, 512]

function parseGridSize(grid) {
  const match = /^(\d+)x(\d+)$/.exec(String(grid))
  if (!match || match[1] !== match[2]) throw new Error('INVALID_GRID_SIZE')
  const size = Number(match[1])
  if (!Number.isInteger(size) || size < 1 || size > MAX_GRID_SIZE) throw new Error('INVALID_GRID_SIZE')
  return size
}

// Bound sampling to one million pixels, while retaining 3x sampling on small grids.
function getSampleSize(size, style) {
  return style === 'clean' ? size * Math.min(3, Math.floor(MAX_GRID_SIZE / size)) : size
}

module.exports = { MAX_GRID_SIZE, GRID_SIZES, parseGridSize, getSampleSize }
