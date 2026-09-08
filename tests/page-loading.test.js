const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

// Model the mini-program's JS-only module graph instead of Node's JSON loader.
function pageLoader(globals) {
  const cache = new Map()
  function load(file) {
    if (!path.extname(file)) file += '.js'
    assert.equal(path.extname(file), '.js', `Non-JS runtime dependency: ${file}`)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const context = vm.createContext({ ...globals, module, exports: module.exports,
      require: ref => load(path.resolve(path.dirname(file), ref)) })
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
    return module.exports
  }
  return load
}

test('upload then next loads the parameters page with JS-only dependencies', async () => {
  let currentPage
  const app = { globalData: { taskData: null } }
  const load = pageLoader({
    console,
    Page: page => {
      currentPage = page
      page.setData = data => Object.assign(page.data, data)
    },
    getApp: () => app,
    wx: {
      showToast() {},
      navigateTo: options => {
        assert.equal(options.url, '/pages/params/params')
        load(path.join(root, 'pages/params/params.js'))
        currentPage.onLoad()
      }
    }
  })
  load(path.join(root, 'pages/index/index.js'))
  currentPage.saveImagePath('uploaded.png')
  currentPage.goParams()
  assert.equal(currentPage.data.imagePath, 'uploaded.png')
  assert.equal(currentPage.data.paletteVersion, '221')
  assert.equal(typeof currentPage.startConvert, 'function')
})

test('MARD JS module exactly matches the source JSON', () => {
  const colors = require('../data/mard/colors')
  const original = JSON.parse(fs.readFileSync(path.join(root, 'data/mard/colors.json'), 'utf8'))
  assert.deepEqual(colors, original)
})

test('navigation errors are surfaced to the user', () => {
  let page, message
  const load = pageLoader({
    console: { error() {} },
    Page: value => { page = value },
    wx: {
      navigateTo: options => options.fail({ errMsg: 'navigateTo:fail' }),
      showToast: options => { message = options.title }
    }
  })
  load(path.join(root, 'pages/index/index.js'))
  page.data.imagePath = 'uploaded.png'
  page.goParams()
  assert.match(message, /页面打开失败/)
})
