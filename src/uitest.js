/**
 * UI 自动化走查脚本（仅在 CMIND_UITEST=1 时由主进程注入执行）
 * 覆盖：当前目录新建、图片插入渲染、脑图链接树形选择、git 绑定/分支/提交
 */
window.__cmindUITest = async function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const S = window.__cmindStore
  const out = { steps: [] }

  const q = (sel) => document.querySelector(sel)
  const qa = (sel) => [...document.querySelectorAll(sel)]
  const setInput = (el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const log = (name, data) => out.steps.push({ name, ...data })
  const sideBtn = (kw) => [...document.querySelectorAll('.filetree button')].find(b => b.textContent.includes(kw))
  const clickBtnInModal = (label) => {
    const b = qa('.modal-foot button').find(x => x.textContent.trim() === label)
    if (b) b.click()
    return !!b
  }
  const submitModal = async (name) => {
    setInput(q('.modal input'), name)
    await sleep(80)
    clickBtnInModal('确定')
    await sleep(900)
  }

  // ---------- 0. 先绑定远程仓库（真实用户流程：绑定 → 产内容 → 提交推送） ----------
  let gitBind = {}
  try {
    gitBind = await window.cmind.invoke('git:bind', {
      url: 'git@github.com:chrisblob/mind-file.git', user: 'chrisblob', token: ''
    })
    const st = await window.cmind.invoke('git:status')
    gitBind.statusAfterBind = { branch: st.branch, branches: st.branches, tracking: st.tracking }
  } catch (e) { gitBind = { error: String(e.message || e) } }
  log('git-bind', gitBind)

  // ---------- 1. 点击文件夹 → 当前目录切换 → 侧栏新建脑图落在该文件夹 ----------
  const dirRow = qa('.tree-row').find(r => r.textContent.includes('学习笔记'))
  if (dirRow) { dirRow.click(); await sleep(300) }
  log('current-dir-after-folder-click', { currentDir: S.currentDir })

  sideBtn('脑图') && sideBtn('脑图').click()
  await sleep(300)
  await submitModal('当前目录脑图')
  const folder = S.tree.find(n => n.name === '学习笔记')
  log('create-in-current-dir', {
    currentDir: S.currentDir,
    folderChildren: folder ? folder.children.map(c => c.name) : [],
    tabs: S.tabs.map(t => t.name)
  })

  // ---------- 1b. 再建一张脑图（供链接选择用） ----------
  sideBtn('脑图') && sideBtn('脑图').click()
  await sleep(300)
  await submitModal('第二张脑图')

  // ---------- 2. 插入图片：节点应出现带尺寸的 image 元素 ----------
  const tb = qa('.toolbar button')
  log('toolbar-debug', {
    toolbarCount: tb.length,
    hasMap: typeof window.__cmindMap,
    hasActive: window.__cmindMap ? window.__cmindMap.renderer.activeNodeList.length : -1,
    titles: tb.map(b => b.title)
  })
  const imgBtn = tb.find(b => b.title === '插入图片')
  const PNG_RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  let imgResult = { skipped: true }
  if (imgBtn && window.__cmindMap) {
    const M = window.__cmindMap
    M.renderer.root.active() // 激活根节点
    await sleep(200)
    M.execCommand('INSERT_CHILD_NODE')
    await sleep(400)
    log('after-insert-child', { activeCount: M.renderer.activeNodeList.length })
    imgBtn.click()
    await sleep(300)
    const urlInput = q('.modal input[type="url"]')
    if (urlInput) {
      setInput(urlInput, PNG_RED)
      await sleep(80)
      clickBtnInModal('确定')
      await sleep(1200)
      const imgs = qa('.canvas-holder image')
      imgResult = {
        imageCount: imgs.length,
        firstSize: imgs[0] ? (imgs[0].getAttribute('width') + 'x' + imgs[0].getAttribute('height')) : null
      }
    }
  }
  log('insert-image', imgResult)

  // ---------- 3. 脑图链接弹框：按目录层级展示 ----------
  const linkBtn = qa('.toolbar button').find(b => b.title && b.title.includes('插入链接'))
  let linkResult = { skipped: true }
  if (linkBtn) {
    const M2 = window.__cmindMap
    if (M2 && !M2.renderer.activeNodeList.length) { M2.renderer.root.active(); await sleep(200) }
    linkBtn.click()
    await sleep(300)
    const radio = qa('.modal input[type="radio"]')[1]
    log('link-radio', { radioCount: qa('.modal input[type="radio"]').length })
    if (radio) { radio.click(); await sleep(250) }
    const rows = qa('.map-list .item').map(e => ({
      text: e.textContent.trim().slice(0, 30),
      dir: e.classList.contains('dir'),
      indent: parseInt(e.style.paddingLeft || '10', 10)
    }))
    linkResult = { rowCount: rows.length, rows }
    // 选中第一个脑图行并确定
    const mapRow = qa('.map-list .item').find(e => !e.classList.contains('dir'))
    if (mapRow) {
      mapRow.click()
      await sleep(100)
      clickBtnInModal('确定')
      await sleep(600)
      const node = window.__cmindMap.renderer.activeNodeList[0]
      linkResult.hyperlink = node ? node.getData('hyperlink') : null
    }
  }
  log('link-dialog-tree', linkResult)

  // ---------- 4. Git：提交 → 分支 → 切回 → 推送 ----------
  let gitResult = {}
  try {
    const st1 = await window.cmind.invoke('git:status')
    gitResult.statusBeforeCommit = { branch: st1.branch, branches: st1.branches, tracking: st1.tracking }
    await window.cmind.invoke('git:commit', 'uitest: 提交脑图文件')
    const cb = await window.cmind.invoke('git:createBranch', 'uitest-branch')
    gitResult.createBranch = cb
    const br = await window.cmind.invoke('git:branches')
    gitResult.branches = br
    await window.cmind.invoke('git:checkout', 'main')
    const st2 = await window.cmind.invoke('git:status')
    gitResult.branchAfterCheckout = st2.branch
    const logLines = await window.cmind.invoke('git:log')
    gitResult.logTop = logLines[0] ? logLines[0].message : null
    try {
      await window.cmind.invoke('git:push')
      gitResult.push = 'ok'
    } catch (e) {
      gitResult.push = 'failed: ' + String(e.message || e)
    }
  } catch (e) {
    gitResult.error = String(e.message || e)
  }
  log('git-flow', gitResult)

  return out
}
