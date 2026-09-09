// Keep the latest conversion's metadata locally so simulator issues can be
// investigated without requiring the user to copy console output.
function recordPlanDiagnostics(plan) {
  const record = {
    createdAt: new Date().toISOString(),
    appVersion: plan.appVersion,
    algorithmVersion: plan.algorithmVersion,
    styleMode: plan.styleMode,
    paletteVersion: plan.paletteVersion,
    ...plan.diagnostics
  }
  const data = JSON.stringify(record)
  console.info('[bead-plan]', data)
  try {
    if (typeof wx === 'undefined' || !wx.env?.USER_DATA_PATH || !wx.getFileSystemManager) return
    wx.getFileSystemManager().writeFileSync(`${wx.env.USER_DATA_PATH}/bead-diagnostics.json`, data, 'utf8')
  } catch (error) {
    // Diagnostics must never prevent conversion or navigation.
    console.warn('[bead-plan] 本地诊断日志保存失败')
  }
}

module.exports = { recordPlanDiagnostics }
