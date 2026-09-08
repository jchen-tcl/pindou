const ALL_COLORS = require('../data/mard/colors')
const PALETTE = ALL_COLORS.filter(color => /^[A-HM]\d+$/.test(color.id))
function getPalette(version = '221') { return String(version) === '291' ? ALL_COLORS : PALETTE }
module.exports = { PALETTE, ALL_COLORS, getPalette }
