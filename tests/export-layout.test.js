const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildXlsxBuffer } = require('../utils/exporter')

// Read the exporter's uncompressed ZIP entries to validate the actual file,
// rather than only checking its internal sizing helper.
function xmlParts(buffer) {
  const bytes = Buffer.from(buffer), parts = {}
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0)
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength)
    const start = offset + 30 + nameLength + extraLength
    parts[name] = bytes.toString('utf8', start, start + size)
    offset = start + size
  }
  return parts
}

test('both exported grids have equal physical width and height at every supported size', () => {
  for (const grid of [32, 48, 64, 128, 256, 512, 777, 1000]) {
    const parts = xmlParts(buildXlsxBuffer({ plan: {
      matrix: Array.from({ length: grid }, () => Array(grid).fill(1)), total: grid * grid,
      detail: [{ colorIndex: 1, beadCode: 'H7', code: '#000000', name: 'MARD H7', count: grid * grid }]
    } }))
    assert.match(parts['xl/workbook.xml'], /<bookViews><workbookView\/><\/bookViews>/)
    const fonts = [...parts['xl/styles.xml'].matchAll(/<font>(.*?)<\/font>/g)].map(match => match[1])
    assert.match(fonts[0], /<sz val="12"\/>/)
    assert.match(fonts[0], /<name val="Calibri"\/>/)
    assert.match(fonts[1], /<sz val="10"\/>/)
    assert.match(fonts[2], /<sz val="10"\/>/)
    for (const sheet of [1, 2]) {
      const xml = parts[`xl/worksheets/sheet${sheet}.xml`]
      assert.equal((xml.match(/<c /g) || []).length, grid * grid)
      if (grid === 1000) assert.match(xml, /<dimension ref="A1:ALL1000"/)
      assert.match(xml, /<sheetViews><sheetView workbookViewId="0" zoomScale="100" zoomScaleNormal="100"\/><\/sheetViews>/)
      const width = Number(xml.match(/<col [^>]*width="([^"]+)"/)[1])
      // OOXML's specified reverse conversion with Calibri 12's 8 px digit width.
      const widthPx = Math.floor((256 * width + Math.floor(128 / 8)) / 256 * 8)
      assert.equal(widthPx, sheet === 1 ? 18 : 36)
      const rows = [...xml.matchAll(/<row r="\d+" ht="([^"]+)" customHeight="1">/g)]
      assert.ok(rows.length >= grid)
      rows.forEach(row => assert.equal(Number(row[1]) * 96 / 72, widthPx))
    }
    assert.ok(parts['xl/worksheets/sheet2.xml'].includes('<t>H7</t>'))
  }
})
