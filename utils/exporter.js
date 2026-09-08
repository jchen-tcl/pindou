function buildPrintText(taskData) {
  const lines = []
  lines.push('拼豆转换器 - 亲子手作清单')
  lines.push(`色卡：MARD ${taskData.plan.paletteVersion || '221'} 色`)
  lines.push(`成品尺寸：${taskData.sizeLabel}`)
  lines.push(`拼豆网格：${taskData.grid}`)
  lines.push(`颜色数量：${taskData.plan.detail.length}色`)
  lines.push(`总颗粒数：${taskData.plan.total}`)
  lines.push('------------------------')
  taskData.plan.detail.forEach((item, index) => {
    lines.push(`${item.beadCode || String(item.colorIndex || index + 1).padStart(2, '0')}. ${item.name} ${item.code}：${item.count}颗`)
  })
  lines.push('------------------------')
  lines.push('制作小贴士：先从边缘颜色开始更容易完成。')
  return lines.join('\n')
}

function buildExcelXml(taskData) {
  const detail = taskData.plan?.detail || []
  const matrix = taskData.plan?.matrix || []
  const worksheets = []
  const effectRows = buildEffectRows(matrix, false)
  const columnCount = matrix[0]?.length || 1
  worksheets.push(buildWorksheet('效果图', effectRows, columnCount, 12))
  const effectCodeRows = buildEffectRows(matrix, true, detail)
  worksheets.push(buildWorksheet('效果图+色号', effectCodeRows, columnCount, 12))
  const statRows = buildStatsRows(detail, taskData.plan?.total || 0)
  worksheets.push(buildWorksheet('拼豆统计', statRows, 6, [12, 16, 28, 20, 14, 14], { rowHeight: 24 }))

  const head = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${buildStyles(detail)}
`
  const foot = '</Workbook>'
  return `${head}${worksheets.join('')}${foot}`
}

function buildXlsxBuffer(taskData) {
  const matrix = taskData.plan?.matrix || []
  const detail = taskData.plan?.detail || []
  const styleContext = createXlsxStyleContext(detail)
  const rows1 = buildXlsxEffectRows(matrix, styleContext)
  const rows2 = buildXlsxEffectCodeRows(matrix, styleContext)
  const rows3 = buildXlsxStatsRows(detail, taskData.plan?.total || 0, styleContext)
  rows3[0][0] = `MARD ${taskData.plan?.paletteVersion || '221'} 色 · 拼豆颜色数量统计`
  const squareCellPx = 18
  const squareOptions = {
    squareCells: true,
    rowHeight: toExcelRowHeight(squareCellPx),
    columnWidth: toExcelColumnWidth(squareCellPx)
  }
  const sheet1 = buildSheetXml(rows1, squareOptions)
  const sheet2 = buildSheetXml(rows2, {
    squareCells: true,
    rowHeight: toExcelRowHeight(36),
    columnWidth: toExcelColumnWidth(36)
  })
  const sheet3 = buildSheetXml(rows3)
  const styles = styleContext.stylesXml
  const workbook = buildWorkbookXml(['效果图', '效果图+色号', '拼豆统计'])
  const contentTypes = buildContentTypesXml()
  const rootRels = buildRootRelsXml()
  const wbRels = buildWorkbookRelsXml()
  const entries = [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRels },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/worksheets/sheet1.xml', content: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', content: sheet2 },
    { name: 'xl/worksheets/sheet3.xml', content: sheet3 }
  ].map((item) => ({
    name: item.name,
    data: utf8Bytes(item.content)
  }))
  return buildZip(entries).buffer
}

function buildWorksheet(name, rows, columnCount = 0, columnWidth = 12, options = {}) {
  let columns = ''
  if (columnCount > 0) {
    if (Array.isArray(columnWidth)) {
      const fallback = columnWidth[columnWidth.length - 1] || 12
      columns = Array.from({ length: columnCount }, (_, index) => `<Column ss:Width="${columnWidth[index] || fallback}"/>`).join('')
    } else {
      columns = Array.from({ length: columnCount }, () => `<Column ss:Width="${columnWidth}"/>`).join('')
    }
  }
  const rowHeight = options.rowHeight || 12
  const rowXml = rows
    .map((row) => {
      const cells = row.map((cell) => buildCellXml(cell)).join('')
      return `<Row ss:AutoFitHeight="0" ss:Height="${rowHeight}">${cells}</Row>`
    })
    .join('')
  return `<Worksheet ss:Name="${escapeXml(normalizeSheetName(name))}"><Table>${columns}${rowXml}</Table></Worksheet>`
}

function buildCellXml(cell) {
  if (typeof cell === 'object' && cell !== null) {
    const value = cell.value ?? ''
    const style = cell.styleId ? ` ss:StyleID="${escapeXml(cell.styleId)}"` : ''
    const type = cell.type || 'String'
    const mergeAcross = Number.isInteger(cell.mergeAcross) ? ` ss:MergeAcross="${cell.mergeAcross}"` : ''
    return `<Cell${style}${mergeAcross}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`
  }
  return `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`
}

function buildEffectRows(matrix, withCode, detail = []) {
  if (!matrix.length) {
    return [[{ value: '', styleId: 'blank' }]]
  }
  return matrix.map((line) =>
    line.map((colorIndex) => ({
      value: withCode && colorIndex ? (detail.find(item => item.colorIndex === colorIndex)?.beadCode || String(colorIndex)) : '',
      styleId: colorIndex ? toColorStyleId(colorIndex) : 'blank'
    }))
  )
}

function buildXlsxEffectRows(matrix, styleContext) {
  if (!matrix.length) {
    return [['']]
  }
  return matrix.map((line) =>
    line.map((value) => {
      const colorIndex = Number(value || 0)
      if (!colorIndex) {
        return ''
      }
      return { value: '', style: styleContext.styleByColorIndex[colorIndex] || 0 }
    })
  )
}

function buildXlsxEffectCodeRows(matrix, styleContext) {
  if (!matrix.length) {
    return [['']]
  }
  return matrix.map((line) =>
    line.map((value) => {
      const n = Number(value || 0)
      if (!n) {
        return ''
      }
      return {
        value: styleContext.labelByColorIndex[n] || String(n),
        style: styleContext.styleByColorIndex[n] || 0
      }
    })
  )
}

function buildStatsRows(detail, total) {
  const rows = [
    [{ value: '拼豆颜色数量统计', styleId: 'statTitle', mergeAcross: 5 }],
    ['', '', '', '', '', ''],
    [
      { value: '序号', styleId: 'statHead' },
      { value: '颜色编号', styleId: 'statHead' },
      { value: '颜色名称', styleId: 'statHead' },
      { value: '色号', styleId: 'statHead' },
      { value: '数量', styleId: 'statHead' },
      { value: '色卡', styleId: 'statHead' }
    ]
  ]
  detail.forEach((item, index) => {
    const colorIndex = Number(item.colorIndex || index + 1)
    rows.push([
      { value: `${index + 1}`, styleId: 'statNum' },
      { value: item.beadCode || `${colorIndex}`, styleId: 'statNum' },
      { value: item.name || '', styleId: 'statCell' },
      { value: item.code || '', styleId: 'statCell' },
      { value: `${item.count || 0}`, styleId: 'statNum' },
      { value: '', styleId: toColorStyleId(colorIndex) }
    ])
    if (index !== detail.length - 1) {
      rows.push([
        { value: '', styleId: 'statGap' },
        { value: '', styleId: 'statGap' },
        { value: '', styleId: 'statGap' },
        { value: '', styleId: 'statGap' },
        { value: '', styleId: 'statGap' },
        { value: '', styleId: 'statGap' }
      ])
    }
  })
  rows.push([
    { value: '合计', styleId: 'statTotal', mergeAcross: 3 },
    { value: `${total}`, styleId: 'statTotal' },
    { value: '', styleId: 'statTotal' }
  ])
  return rows
}

function buildXlsxStatsRows(detail, total, styleContext) {
  const rows = [
    ['拼豆颜色数量统计', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['序号', '颜色编号', '颜色名称', '色号', '数量', '色卡']
  ]
  detail.forEach((item, index) => {
    const colorIndex = Number(item.colorIndex || index + 1)
    rows.push([
      index + 1,
      item.beadCode || colorIndex,
      item.name || '',
      item.code || '',
      Number(item.count || 0),
      {
        value: '',
        style: styleContext.styleByColorIndex[colorIndex] || 0
      }
    ])
  })
  rows.push(['合计', '', '', '', Number(total || 0), ''])
  return rows
}

function buildColorSheetName(index, name) {
  const prefix = String(index + 1).padStart(2, '0')
  return `分色_${prefix}_${name}`
}

function normalizeSheetName(name) {
  return String(name)
    .replace(/[\\/*?:[\]]/g, '_')
    .slice(0, 31)
}

function buildPrintLayoutRows(taskData, detail) {
  const rows = [
    ['打印排版', ''],
    ['成品尺寸', taskData.sizeLabel || ''],
    ['拼豆网格', taskData.grid || ''],
    ['总颗粒数', `${taskData.plan?.total || 0}`],
    ['', ''],
    ['颜色图例', ''],
    ['编号', '颜色', '色值', '数量']
  ]
  detail.forEach((item) => {
    rows.push([
      `${item.colorIndex || ''}`,
      item.name,
      { value: item.code, styleId: toColorStyleId(item.colorIndex) },
      `${item.count}`
    ])
  })
  rows.push(['', ''])
  const matrix = taskData.plan?.matrix || []
  const gridSize = matrix[0]?.length || 0
  const blockSize = 16
  for (let start = 0; start < gridSize; start += blockSize) {
    const end = Math.min(start + blockSize, gridSize)
    rows.push(['', ''])
    rows.push([`网格区（列${start + 1}-${end}）`, ''])
    const headerRow = [{ value: '行\\列', styleId: 'head' }]
    for (let col = start + 1; col <= end; col += 1) {
      headerRow.push({ value: `${col}`, styleId: 'head' })
    }
    rows.push(headerRow)
    matrix.forEach((line, rowIndex) => {
      const row = [{ value: `${rowIndex + 1}`, styleId: 'head' }]
      for (let col = start; col < end; col += 1) {
        const colorIndex = Number(line[col] || 0)
        row.push({
          value: colorIndex ? String(colorIndex).padStart(2, '0') : '',
          styleId: colorIndex ? toColorStyleId(colorIndex) : ''
        })
      }
      rows.push(row)
    })
  }
  return rows
}

function buildStyles(detail) {
  const base = [
    '<Styles>',
    '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Borders/><Font ss:FontName="微软雅黑" ss:Size="10"/><Interior/><NumberFormat/><Protection/></Style>',
    '<Style ss:ID="blank"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="statTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Size="14" ss:Bold="1" ss:Color="#4E7FAE"/><Interior ss:Color="#EAF5FF" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="statHead"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#4A6B8C"/><Interior ss:Color="#DDEEFF" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="statCell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Color="#4F5F70"/><Interior ss:Color="#F8FCFF" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="statNum"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#4A6B8C"/><Interior ss:Color="#F3F9FF" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="statGap"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="statTotal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#3F648B"/><Interior ss:Color="#CFE5FF" ss:Pattern="Solid"/></Style>'
  ]
  detail.forEach((item, index) => {
    const colorIndex = Number(item.colorIndex || index + 1)
    const styleId = toColorStyleId(colorIndex)
    const fontColor = textColorForBg(item.code)
    base.push(
      `<Style ss:ID="${styleId}"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Color="${fontColor}" ss:Bold="1"/><Interior ss:Color="${item.code}" ss:Pattern="Solid"/></Style>`
    )
  })
  base.push('</Styles>')
  return base.join('')
}

function toColorStyleId(colorIndex) {
  return `c${String(colorIndex || 0).padStart(3, '0')}`
}

function textColorForBg(hex) {
  const [r, g, b] = hexToRgb(hex)
  const luminance = (r * 299 + g * 587 + b * 114) / 1000
  return luminance >= 150 ? '#333333' : '#FFFFFF'
}

function buildGroupSummary(detail) {
  const bucket = {
    暖色系: 0,
    冷色系: 0,
    中性色: 0
  }
  detail.forEach((item) => {
    const group = detectGroup(item.code)
    bucket[group] += item.count
  })
  return Object.keys(bucket).map((key) => ({
    group: key,
    count: bucket[key]
  }))
}

function detectGroup(hex) {
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta < 20) {
    return '中性色'
  }
  const hue = rgbToHue(r, g, b)
  if (hue <= 60 || hue >= 300) {
    return '暖色系'
  }
  if (hue >= 70 && hue <= 260) {
    return '冷色系'
  }
  return '暖色系'
}

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((s) => s + s).join('') : value
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0
  ]
}

function rgbToHue(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  if (!delta) {
    return 0
  }
  let hue = 0
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2
  } else {
    hue = (rn - gn) / delta + 4
  }
  const value = Math.round(hue * 60)
  return value < 0 ? value + 360 : value
}

function escapeXml(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
}

function buildWorkbookXml(sheetNames) {
  const sheets = sheetNames
    .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

function buildSheetXml(rows, options = {}) {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 1)
  const rowCount = Math.max(rows.length, 1)
  const dimension = `A1:${toColumnName(maxCols)}${rowCount}`
  const squareCells = !!options.squareCells
  const rowHeight = Number(options.rowHeight || 13.5)
  const columnWidth = Number(options.columnWidth || 1.85)
  const sheetFormatPr = squareCells ? `<sheetFormatPr defaultRowHeight="${rowHeight}" customHeight="1"/>` : ''
  const colsXml = squareCells ? `<cols><col min="1" max="${maxCols}" width="${columnWidth}" customWidth="1"/></cols>` : ''
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => buildXlsxCell(value, rowIndex + 1, colIndex + 1))
        .filter(Boolean)
        .join('')
      if (!squareCells) {
        return `<row r="${rowIndex + 1}">${cells}</row>`
      }
      return `<row r="${rowIndex + 1}" ht="${rowHeight}" customHeight="1">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  ${sheetFormatPr}
  ${colsXml}
  <sheetData>${rowXml}</sheetData>
</worksheet>`
}

function buildXlsxCell(value, row, col) {
  if (value === '' || value === null || value === undefined) {
    return ''
  }
  const ref = `${toColumnName(col)}${row}`
  if (typeof value === 'object') {
    const styleAttr = Number.isInteger(value.style) && value.style > 0 ? ` s="${value.style}"` : ''
    const cellValue = value.value
    if (cellValue === '' || cellValue === null || cellValue === undefined) {
      return styleAttr ? `<c r="${ref}"${styleAttr}/>` : ''
    }
    if (typeof cellValue === 'number' && Number.isFinite(cellValue)) {
      return `<c r="${ref}"${styleAttr}><v>${cellValue}</v></c>`
    }
    return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t>${escapeXml(cellValue)}</t></is></c>`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
}

function createXlsxStyleContext(detail) {
  const colorRows = detail
    .map((item, index) => {
      const colorIndex = Number(item.colorIndex || index + 1)
      const rgb = toArgb(item.code)
      if (!colorIndex || !rgb) {
        return null
      }
      return {
        colorIndex,
        rgb,
        fontId: pickFontId(rgb)
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.colorIndex - b.colorIndex)
  const labelByColorIndex = Object.fromEntries(detail.map(item => [item.colorIndex, item.beadCode || String(item.colorIndex)]))
  const styleByColorIndex = {}
  colorRows.forEach((item, index) => {
    styleByColorIndex[item.colorIndex] = index + 2
  })
  const fills = colorRows
    .map((item) => `<fill><patternFill patternType="solid"><fgColor rgb="${item.rgb}"/><bgColor indexed="64"/></patternFill></fill>`)
    .join('')
  const colorXfs = colorRows
    .map((item, index) => {
      const fillId = index + 2
      return `<xf numFmtId="0" fontId="${item.fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`
    })
    .join('')
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><color rgb="FF333333"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="${2 + colorRows.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills}
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${2 + colorRows.length}">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    ${colorXfs}
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
  return {
    styleByColorIndex,
    labelByColorIndex,
    stylesXml
  }
}

function toArgb(hex) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((s) => s + s).join('') : value
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return 'FFFFFFFF'
  }
  return `FF${full.toUpperCase()}`
}

function pickFontId(argb) {
  const r = parseInt(argb.slice(2, 4), 16)
  const g = parseInt(argb.slice(4, 6), 16)
  const b = parseInt(argb.slice(6, 8), 16)
  const luminance = (r * 299 + g * 587 + b * 114) / 1000
  return luminance >= 150 ? 0 : 1
}

function toColumnName(index) {
  let n = index
  let output = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    output = String.fromCharCode(65 + rem) + output
    n = Math.floor((n - 1) / 26)
  }
  return output || 'A'
}

function toExcelRowHeight(pixel) {
  return Number((pixel * 0.75).toFixed(2))
}

function toExcelColumnWidth(pixel) {
  const width = pixel / 7 - 0.07
  return Number(Math.max(0.5, width).toFixed(2))
}

function utf8Bytes(input) {
  const text = String(input || '')
  const bytes = []
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000
        i += 1
      }
    }
    if (code <= 0x7f) {
      bytes.push(code)
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(bytes)
}

function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  entries.forEach((entry) => {
    const nameBytes = utf8Bytes(entry.name)
    const data = entry.data
    const crc = crc32(data)
    const localHeader = createLocalHeader(nameBytes, data.length, crc)
    localParts.push(localHeader, nameBytes, data)
    const centralHeader = createCentralHeader(nameBytes, data.length, crc, offset)
    centralParts.push(centralHeader, nameBytes)
    offset += localHeader.length + nameBytes.length + data.length
  })
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = createEndRecord(entries.length, centralSize, offset)
  return concatBytes([...localParts, ...centralParts, eocd])
}

function createLocalHeader(nameBytes, size, crc) {
  const out = new Uint8Array(30)
  writeU32(out, 0, 0x04034b50)
  writeU16(out, 4, 20)
  writeU16(out, 6, 0)
  writeU16(out, 8, 0)
  writeU16(out, 10, 0)
  writeU16(out, 12, 0)
  writeU32(out, 14, crc)
  writeU32(out, 18, size)
  writeU32(out, 22, size)
  writeU16(out, 26, nameBytes.length)
  writeU16(out, 28, 0)
  return out
}

function createCentralHeader(nameBytes, size, crc, localOffset) {
  const out = new Uint8Array(46)
  writeU32(out, 0, 0x02014b50)
  writeU16(out, 4, 20)
  writeU16(out, 6, 20)
  writeU16(out, 8, 0)
  writeU16(out, 10, 0)
  writeU16(out, 12, 0)
  writeU16(out, 14, 0)
  writeU32(out, 16, crc)
  writeU32(out, 20, size)
  writeU32(out, 24, size)
  writeU16(out, 28, nameBytes.length)
  writeU16(out, 30, 0)
  writeU16(out, 32, 0)
  writeU16(out, 34, 0)
  writeU16(out, 36, 0)
  writeU32(out, 38, 0)
  writeU32(out, 42, localOffset)
  return out
}

function createEndRecord(count, centralSize, centralOffset) {
  const out = new Uint8Array(22)
  writeU32(out, 0, 0x06054b50)
  writeU16(out, 4, 0)
  writeU16(out, 6, 0)
  writeU16(out, 8, count)
  writeU16(out, 10, count)
  writeU32(out, 12, centralSize)
  writeU32(out, 16, centralOffset)
  writeU16(out, 20, 0)
  return out
}

function writeU16(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >> 8) & 0xff
}

function writeU32(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >> 8) & 0xff
  target[offset + 2] = (value >> 16) & 0xff
  target[offset + 3] = (value >> 24) & 0xff
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach((part) => {
    out.set(part, offset)
    offset += part.length
  })
  return out
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    const index = (crc ^ bytes[i]) & 0xff
    crc = (crc >>> 8) ^ CRC_TABLE[index]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC_TABLE = buildCrcTable()

function buildCrcTable() {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
}

function saveFile(fileName, content) {
  const fs = wx.getFileSystemManager()
  const path = `${wx.env.USER_DATA_PATH}/${fileName}`
  fs.writeFileSync(path, content, 'utf8')
  return path
}

function saveBinaryFile(fileName, buffer) {
  const fs = wx.getFileSystemManager()
  const path = `${wx.env.USER_DATA_PATH}/${fileName}`
  fs.writeFileSync(path, buffer)
  return path
}

module.exports = {
  buildPrintText,
  buildExcelXml,
  buildXlsxBuffer,
  saveFile,
  saveBinaryFile
}
