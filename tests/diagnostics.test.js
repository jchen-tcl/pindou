const { test } = require('node:test')
const assert = require('node:assert/strict')
const { recordPlanDiagnostics } = require('../utils/diagnostics')

test('local diagnostics identify the actual pipeline without storing the picture or matrix', () => {
  let record, file
  global.wx = {
    env: { USER_DATA_PATH: '/simulator/usr' },
    getFileSystemManager: () => ({ writeFileSync: (path, data) => { file = path; record = JSON.parse(data) } })
  }
  recordPlanDiagnostics({ appVersion: 'v1.0.6', algorithmVersion: 'flat-v2', styleMode: 'clean',
    imagePath: 'private.webp', matrix: [[1]], diagnostics: { gridSize: 128, actualColorCount: 4 } })
  assert.equal(file, '/simulator/usr/bead-diagnostics.json')
  assert.equal(record.algorithmVersion, 'flat-v2')
  assert.equal(record.gridSize, 128)
  assert.equal(record.actualColorCount, 4)
  assert.equal(record.imagePath, undefined)
  assert.equal(record.matrix, undefined)
})

test('unavailable filesystem or a write failure does not break conversion', () => {
  global.wx = {}
  assert.doesNotThrow(() => recordPlanDiagnostics({}))
  global.wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager() { throw new Error('unavailable') } }
  assert.doesNotThrow(() => recordPlanDiagnostics({}))
})
