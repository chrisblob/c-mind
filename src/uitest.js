/**
 * UI 自动化走查脚本（仅在 CMIND_UITEST=1 时由主进程注入执行）
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
  const sideBtn = (kw, exclude) => [...document.querySelectorAll('.filetree button')]
    .find(b => b.textContent.includes(kw) && (!exclude || !b.textContent.includes(exclude)))
  const clickBtnInModal = (label) => {
    const b = qa('.modal-foot button').find(x => x.textContent.trim() === label)
    if (b) b.click()
    return !!b
  }

  // ---------- 1. 新建脑图：弹框 & 必填校验 ----------
  sideBtn('脑图') && sideBtn('脑图').click()
  await sleep(350)
  log('open-new-map-dialog', {
    title: q('.modal-head')?.textContent,
    inputValue: q('.modal input')?.value,
    modalCount: qa('.modal').length
  })

  // 1a. 空名称点确定 → 应保持打开
  clickBtnInModal('确定')
  await sleep(300)
  log('empty-name-submit', { modalCount: qa('.modal').length })

  // 1b. 填名称点确定 → 应创建并关闭
  setInput(q('.modal input'), '测试脑图')
  await sleep(80)
  clickBtnInModal('确定')
  await sleep(1200)
  log('submit-valid-name', {
    modalCount: qa('.modal').length,
    tabs: S.tabs.map(t => t.name),
    treeNames: S.tree.map(n => n.name)
  })

  // ---------- 2. 取消不应创建 ----------
  const tabCountBefore = S.tabs.length
  sideBtn('脑图') && sideBtn('脑图').click()
  await sleep(300)
  const cancelFound = clickBtnInModal('取消')
  await sleep(400)
  log('cancel', { cancelFound, modalCount: qa('.modal').length, tabsDelta: S.tabs.length - tabCountBefore })

  // ---------- 3. 文件夹节点右键菜单 ----------
  const dirRow = qa('.tree-row').find(r => r.textContent.includes('学习笔记'))
  if (dirRow) {
    dirRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }))
    await sleep(250)
  }
  log('dir-context-menu', { found: !!dirRow, items: qa('.context-menu .mi').map(e => e.textContent.trim()) })

  // ---------- 4. 右键文件夹 → 新建脑图 ----------
  const newMapItem = qa('.context-menu .mi').find(e => e.textContent.includes('新建脑图'))
  if (newMapItem) {
    newMapItem.click()
    await sleep(300)
    setInput(q('.modal input'), '子目录脑图')
    await sleep(80)
    clickBtnInModal('确定')
    await sleep(1000)
  }
  log('create-map-in-folder', { modalCount: qa('.modal').length, tabs: S.tabs.map(t => t.name) })
  const folder = S.tree.find(n => n.name === '学习笔记')
  log('folder-children', { children: folder ? folder.children.map(c => c.name) : [] })

  // ---------- 5. 新建普通文件 ----------
  const fileBtn = sideBtn('文件', '文件夹')
  log('new-file-button', { exists: !!fileBtn })
  if (fileBtn) {
    fileBtn.click()
    await sleep(300)
    setInput(q('.modal input'), 'notes.md')
    await sleep(80)
    clickBtnInModal('确定')
    await sleep(900)
  }
  log('create-file', { modalCount: qa('.modal').length, treeNames: S.tree.map(n => n.name) })

  // ---------- 6. 文件节点右键：应支持新建同级脑图/文件夹/文件 ----------
  const fileRow = qa('.tree-row').find(r => r.textContent.includes('notes.md'))
  if (fileRow) {
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 240, clientY: 320 }))
    await sleep(250)
  }
  log('file-context-menu', { items: qa('.context-menu .mi').map(e => e.textContent.trim()) })
  q('.context-menu') && q('.context-menu').remove()

  // ---------- 7. 根节点改名 → 文件名同步 ----------
  const map = window.__cmindMap
  let renameInfo = { skipped: true }
  if (map) {
    const beforeTab = S.tabs.find(t => t.id === S.activeId)
    map.execCommand('SET_NODE_TEXT', map.renderer.root, '改名后的根主题')
    await sleep(2500) // 等防抖保存 + 改名
    const afterTab = S.tabs.find(t => t.id === S.activeId)
    const files = []
    const walk = (list, base) => list.forEach(n => {
      if (n.type === 'dir') walk(n.children, base + n.name + '/')
      else files.push(base + n.name)
    })
    walk(S.tree, '')
    renameInfo = {
      before: beforeTab && beforeTab.name,
      afterTabName: afterTab && afterTab.name,
      fileExists: files.some(f => f.includes('改名后的根主题')),
      files
    }
  }
  log('root-rename', renameInfo)

  return out
}
