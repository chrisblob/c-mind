/**
 * UI 自动化走查脚本（仅在 CMIND_UITEST=1 时由主进程注入执行）
 * 覆盖：当前目录新建、图片插入渲染、脑图链接树形选择、多格式导入/导出转换、git 绑定/分支/提交
 */
import { parseImportText, buildFreeMind, buildOpml, buildMarkdown, extToKind } from './formats.js'
import { openMap, closeContextMenu, handleCmindLink } from './store.js'
window.__cmindUITest = async function (mode) {
  const sleepF = (ms) => new Promise(r => setTimeout(r, ms))
  if (mode === 'exporttest') {
    const S = window.__cmindStore
    const out = { steps: [] }
    const log = (name, data) => out.steps.push({ name, ...data })
    const sleepE = (ms) => new Promise(r => setTimeout(r, ms))
    // 打开 demo 的「产品路线图」
    const row = [...document.querySelectorAll('.tree-row')].find(r => r.textContent.includes('产品路线图'))
    if (row) row.click()
    await sleepE(2600)
    const M = window.__cmindMap
    if (!M) { log('open', { error: 'no map' }); return out }
    log('open', { text: (M.getData().data || {}).text })
    // 1) 核心导出器逐个调用
    for (const t of ['png', 'svg', 'xmind', 'json']) {
      try {
        const data = await M.export(t, false, '导出测试')
        log('mindmap-export', {
          type: t,
          kind: typeof data,
          len: data ? String(data).length : 0,
          prefix: data ? String(data).slice(0, 40) : ''
        })
      } catch (e) {
        log('mindmap-export', { type: t, error: String(e && e.message || e) })
      }
    }
    // 2) 互操作导出 + 保存通道（CMIND_EXPORT_DIR 下真实落盘）
    try {
      const gd = M.getData()
      const md = (await import('./formats.js')).buildMarkdown(gd)
      const saved = await window.cmind.invoke('export:save', { defaultName: '导出测试.md', content: md })
      log('save-mardown', { saved })
    } catch (e) { log('save-mardown', { error: String(e && e.message || e) }) }
    try {
      const png = await M.export('png', false, '导出测试')
      const b64 = String(png).split(',')[1] || ''
      const saved = await window.cmind.invoke('export:save', { defaultName: '导出测试.png', content: { base64: b64 } })
      log('save-png', { saved, bytes: b64.length })
    } catch (e) { log('save-png', { error: String(e && e.message || e) }) }
    // 3) 导出菜单是否弹出且条目齐全
    try {
      const btn = [...document.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('导出'))
      btn && btn.click()
      await sleepE(400)
      log('export-menu', {
        shown: !!document.querySelector('.context-menu'),
        items: [...document.querySelectorAll('.context-menu .mi')].map(x => x.textContent.trim())
      })
      // 真点击「PNG 图片」菜单项，验证 菜单→doExport→保存 全链路
      const pngItem = [...document.querySelectorAll('.context-menu .mi')].find(x => x.textContent.includes('PNG'))
      if (pngItem) {
        pngItem.click()
        await sleepE(1500)
        log('export-menu-click', { toasts: (window.__cmindStore.toasts || []).map(t => t.text) })
      } else {
        log('export-menu-click', { error: 'png item not found' })
      }
      window.__cmindStore.closeContextMenu && window.__cmindStore.closeContextMenu()
    } catch (e) { log('export-menu', { error: String(e && e.message || e) }) }
    return out
  }
  if (mode === 'importtest') {
    const out = { steps: [] }
    const log = (name, data) => out.steps.push({ name, ...data })
    try {
      const res = await window.cmind.invoke('import:open')
      log('import-open', { kind: res && res.kind, sub: res && res.sub, textLen: res ? String(res.text || '').length : 0 })
      const fm = await import('./formats.js')
      const tree = fm.parseImportText(res.kind, res.text)
      log('import-parse', {
        root: (tree.data || {}).text,
        children: (tree.children || []).map(c => (c.data || {}).text).slice(0, 6),
        total: (tree.children || []).reduce((n, c) => n + 1 + (c.children || []).length, 0)
      })
      // 端到端：走侧栏「📥 导入」全链路。规则 = 选中脑图→其所在文件夹；选中文件夹→该文件夹
      const S = window.__cmindStore
      if (!window.__cmindImport) { log('insert', { error: 'no hook' }); return out }
      await new Promise(r => setTimeout(r, 1200))
      log('tree-probe', {
        ws: S.workspace.split('/').pop(),
        treeLen: S.tree.length,
        names: S.tree.map(n => n.name).slice(0, 6),
        rows: document.querySelectorAll('.tree-row').length,
        tabs: S.tabs.length,
        hookImport: typeof window.__cmindImport,
        hookMove: typeof window.__cmindMove
      })
      const pick = async (kw) => {
        const row = [...document.querySelectorAll('.tree-row')].find(r => r.textContent.includes(kw))
        if (row) row.click()
        await new Promise(r => setTimeout(r, 2200))
        return S.currentDir
      }
      const results = []
      // 场景1：选中根目录下的脑图 产品路线图 → 应导入到根目录
      let dir = await pick('产品路线图')
      const beforeTabs = S.tabs.length
      await window.__cmindImport()
      await new Promise(r => setTimeout(r, 1600))
      let tab = S.tabs.find(t => t.id === S.activeId)
      results.push({
        scene: '选中脑图(根目录) → 导入到其所在文件夹',
        dir: String(dir).split('/').pop(),
        fileName: tab && tab.path.split('/').pop(),
        activePathInDir: !!(tab && tab.path.startsWith(dir + '/')),
        tabs: beforeTabs + '→' + S.tabs.length
      })
      // 场景2：选中子文件夹 学习笔记 → 应导入到该文件夹
      dir = await pick('学习笔记')
      await window.__cmindImport()
      await new Promise(r => setTimeout(r, 1600))
      tab = S.tabs.find(t => t.id === S.activeId)
      results.push({
        scene: '选中文件夹(学习笔记) → 导入到该文件夹',
        dir: String(dir).split('/').pop(),
        fileName: tab && tab.path.split('/').pop(),
        activePathInDir: !!(tab && tab.path.startsWith(dir + '/')),
        tabs: beforeTabs + '→' + S.tabs.length
      })
      log('import-as-new-file', results)
      // 画布渲染校验：所有节点 <img> 必须真实解码成功（naturalWidth>0）
      await new Promise(r => setTimeout(r, 1200))
      const imgs = [...document.querySelectorAll('svg foreignObject img, svg image')]
      const ok = imgs.filter(el => el.tagName === 'IMG' ? el.naturalWidth > 0 : el.href.baseVal.startsWith('data:'))
      log('canvas-render-check', { imgCount: imgs.length, renderedOk: ok.length })
      // 最新导入文件内容校验（图片/链接落盘）
      if (tab) {
        await new Promise(r => setTimeout(r, 800))
        const raw = String(await window.cmind.invoke('fs:read', tab.path))
        const doc = JSON.parse(raw)
        const flat = []
        ;(function w(n) { flat.push(n); (n.children || []).forEach(w) })(doc.root)
        log('new-file-check', {
          rootText: doc.root.data.text,
          imageNodes: flat.filter(n => n.data && typeof n.data.image === 'string' && n.data.image.startsWith('data:')).length,
          withSize: flat.filter(n => n.data && n.data.imageSize && n.data.imageSize.width > 0).length,
          links: flat.filter(n => n.data && n.data.hyperlink).map(n => String(n.data.hyperlink).slice(0, 24))
        })
      }
      // 文件夹视图：点击左侧文件夹 → 右侧展示内容，支持列表/平铺
      const dirRow = [...document.querySelectorAll('.tree-row')].find(r => r.textContent.includes('学习笔记'))
      if (dirRow) dirRow.click()
      await new Promise(r => setTimeout(r, 1500))
      const at = S.tabs.find(t => t.id === S.activeId)
      log('dir-view-check', {
        tabType: at && at.type,
        tabName: at && at.name,
        items: document.querySelectorAll('.folder-item').length,
        hasGrid: !!document.querySelector('.fv-grid-wrap')
      })
      const gbtn = document.querySelector('[data-view="grid"]')
      if (gbtn) gbtn.click()
      await new Promise(r => setTimeout(r, 300))
      log('view-toggle-check', {
        gridOn: !!document.querySelector('.fv-grid-wrap'),
        savedMode: localStorage.getItem('cmind-dir-view')
      })
      // 链接随移动修复：把 团队知识库.cmind 移入 学习笔记，其他脑图里指向它的 cmind:// 链接应自动更新
      const mapRow2 = [...document.querySelectorAll('.tree-row')].find(r => r.textContent.includes('产品路线图'))
      if (mapRow2 && window.__cmindMove) {
        const ws = S.workspace
        // 先记录打开标签的 dirty 状态（dirty 会被跳过重写）
        const dirtyNow = S.tabs.filter(t => t.dirty).map(t => t.name)
        mapRow2.click()
        await new Promise(r => setTimeout(r, 2000))
        const prPath = S.tabs.find(t => t.id === S.activeId).path
        const beforeRaw = String(await window.cmind.invoke('fs:read', prPath))
        const encOld = encodeURIComponent('团队知识库.cmind').replace(/%2F/g, '/')
        const beforeHas = beforeRaw.includes('cmind://open?path=' + encOld)
        await window.__cmindMove(ws + '/团队知识库.cmind', ws + '/学习笔记')
        await new Promise(r => setTimeout(r, 1600))
        const afterRaw = String(await window.cmind.invoke('fs:read', prPath))
        const links = (afterRaw.match(/cmind:\/\/open\?path=([^"'\s<>)]+)/g) || []).map(x => {
          try { return decodeURIComponent(x.replace('cmind://open?path=', '')) } catch { return x }
        })
        let targetOk = false
        try { await window.cmind.invoke('fs:read', ws + '/学习笔记/团队知识库.cmind'); targetOk = true } catch {}
        log('link-move-check', {
          beforeHas,
          links: links.slice(0, 6),
          targetMoved: targetOk,
          dirtyNow,
          toasts: S.toasts.map(t2 => t2.text).slice(-4)
        })
        // 同名不同文件夹：造 其他/团队知识库.cmind 同名副本，再把 学习笔记 那份移到 X/
        // → 链接按完整相对路径精确匹配重写，其他文件夹的同名文件不受影响
        const otherDir = ws + '/其他'
        const xDir = ws + '/X'
        let c1 = '', c2 = ''
        try { await window.cmind.invoke('fs:createDir', ws, '其他') } catch (e) { c1 = String(e.message || e) }
        try { await window.cmind.invoke('fs:createDir', ws, 'X') } catch (e) { c2 = String(e.message || e) }
        const tkRaw = String(await window.cmind.invoke('fs:read', ws + '/学习笔记/团队知识库.cmind'))
        await window.cmind.invoke('fs:write', otherDir + '/团队知识库.cmind', tkRaw)
        await window.__cmindMove(ws + '/学习笔记/团队知识库.cmind', xDir)
        await new Promise(r => setTimeout(r, 1600))
        const prRaw2 = String(await window.cmind.invoke('fs:read', prPath))
        const links2 = (prRaw2.match(/cmind:\/\/open\?path=([^"'\s<>)]+)/g) || []).map(x => {
          try { return decodeURIComponent(x.replace('cmind://open?path=', '')) } catch { return x }
        })
        const otherRaw = String(await window.cmind.invoke('fs:read', otherDir + '/团队知识库.cmind'))
        log('same-name-check', {
          links: links2.slice(0, 6),
          movedRewritten: links2.includes('X/团队知识库.cmind'),
          otherIntact: otherRaw === tkRaw
        })
        // 重名校验：同文件夹新建/重名 → 明确报错（不再自动 -1/-2）
        let dupFileMsg = ''
        try { await window.cmind.invoke('fs:createFile', ws, '产品路线图', '{}') } catch (e) { dupFileMsg = String(e.message || e) }
        let dupDirMsg = ''
        try { await window.cmind.invoke('fs:createDir', ws, '学习笔记') } catch (e) { dupDirMsg = String(e.message || e) }
        log('dup-check', { dupFileMsg, dupDirMsg })
        // uuid 链接：path 参数故意写错 → uuid 应兜底解析；再把文件移走（path 更 stale）→ uuid 依然解析成功
        const uidDoc = { format: 'c-mind', version: 1, uuid: 'uitest-fixed-uuid-0001', root: { data: { text: 'UUID目标' }, children: [] } }
        await window.cmind.invoke('fs:write', ws + '/学习笔记/UUID目标.cmind', JSON.stringify(uidDoc, null, 2))
        await window.__cmindMove(ws + '/产品路线图.cmind', ws + '/学习笔记') // 触发 refreshTree 失效索引（实际无影响，仅制造树变化）
        await new Promise(r => setTimeout(r, 1200))
        await window.__cmindMove(ws + '/学习笔记/产品路线图.cmind', ws)
        await new Promise(r => setTimeout(r, 1200))
        const staleLink = 'cmind://open?uuid=uitest-fixed-uuid-0001&path=' + encodeURIComponent('已不存在的路径/UUID目标.cmind')
        const beforeTab = S.tabs.find(t => t.id === S.activeId)
        await handleCmindLink(staleLink)
        await new Promise(r => setTimeout(r, 1200))
        const t1 = S.tabs.find(t => t.id === S.activeId)
        await window.__cmindMove(ws + '/学习笔记/UUID目标.cmind', ws + '/X')
        await new Promise(r => setTimeout(r, 1200))
        S.tabs = S.tabs.filter(t => t.id !== (t1 && t1.id)) // 关闭旧标签，确保第二次是真的重新解析打开
        await handleCmindLink(staleLink)
        await new Promise(r => setTimeout(r, 1200))
        const t2 = S.tabs.find(t => t.id === S.activeId)
        log('uuid-link-check', {
          resolvedByUuid1: !!(t1 && t1.name === 'UUID目标'),
          resolvedByUuid2: !!(t2 && t2.name === 'UUID目标' && t2.path.endsWith('/X/UUID目标.cmind'))
        })
        // dirty 打开场景：给当前脑图制造未保存改动，再反向移动 团队知识库 回根目录
        const MM = window.__cmindMap
        if (MM) {
          MM.execCommand('INSERT_CHILD_NODE', false, [MM.renderer.root], { data: { text: 'dirty-probe' } }, [])
          await new Promise(r => setTimeout(r, 400))
          const dirtyTab = S.tabs.find(t => t.id === S.activeId)
          await window.__cmindMove(ws + '/X/团队知识库.cmind', ws)
          await new Promise(r => setTimeout(r, 2000)) // 等自动保存(900ms)+重写
          const doc = MM.getData(true)
          const memLinks = []
          ;(function w3(n) { if (n.data && n.data.hyperlink) memLinks.push(n.data.hyperlink); (n.children || []).forEach(w3) })(doc.root)
          const diskRaw = String(await window.cmind.invoke('fs:read', dirtyTab.path))
          log('dirty-move-check', {
            wasDirty: dirtyTab.dirty,
            memLinks: memLinks.map(x => decodeURIComponent(x.replace('cmind://open?path=', ''))).slice(0, 6),
            diskHasRootLink: diskRaw.includes('cmind://open?path=' + encodeURIComponent('团队知识库.cmind').replace(/%2F/g, '/')),
            diskStaleLink: diskRaw.includes(encodeURIComponent('学习笔记/团队知识库.cmind'))
          })
        }
      }
    } catch (e) {
      log('import-fail', { error: String(e && e.message || e) })
    }
    return out
  }
  if (mode === 'focus') {
    // ---- 专项验证：真实拖拽放大 / 画布放大 / 树排序 / 换行 ----
    const S = window.__cmindStore
    const out = { steps: [] }
    const log = (name, data) => out.steps.push({ name, ...data })
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]
    const setInput = (el, val) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })) }
    const submitModal = async (name) => {
      const inp = q('.modal input')
      if (!inp) throw new Error('modal input not found (button may not have opened)')
      setInput(inp, name); await sleepF(80)
      const ok = qa('.modal-foot button').find(x => x.textContent.trim() === '确定')
      if (!ok) throw new Error('modal confirm not found')
      ok.click(); await sleepF(900)
    }
    const ufPath = S.workspace + '/徐晓赫/测试二级文件夹/测试脑图.cmind'
    await openMap(ufPath)
    let waited = 0
    const ready = () => { const m = window.__cmindMap; if (!m || ((m.getData().data || {}).text !== '测试脑图')) return false; const k = (m.renderer.root && m.renderer.root.children) || []; return k.length >= 6 && k.every(x => x.group) }
    while (!ready() && waited < 20000) { await sleepF(300); waited += 300 }
    await sleepF(600)
    const M = window.__cmindMap
    const node = M.renderer.root.children[0]
    const imgEl = node.group.node.querySelector('image')
    const before = { ...(node.getData('imageSize') || {}) }
    // 画布内应为缩略图，且不再提供拖拽放大手柄
    imgEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 800, clientY: 500 }))
    await sleepF(300)
    log('thumb-check', { imageSize: node.getData('imageSize'), handleShown: !!q('.node-img-handle'), before })
    // 点图片本身 → 应该直接弹窗
    imgEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 800, clientY: 500 }))
    await sleepF(800)
    const clickOpen = { opened: !!q('.img-viewer') }
    if (q('.img-viewer')) { q('.img-viewer .viewer-bar button.primary').click(); await sleepF(300) }
    log('img-click-open', clickOpen)
    // 激活图片节点 → 工具栏「查看图片大图」→ 弹窗缩放
    node.active(); await sleepF(250)
    const viewBtn = qa('.toolbar button').find(b => (b.getAttribute('data-tip') || '').includes('查看图片大图'))
    viewBtn && viewBtn.click()
    await sleepF(700)
    const vr = { opened: !!q('.img-viewer'), pct0: (q('.img-viewer .vpct') || {}).textContent || '' }
    if (q('.img-viewer')) {
      const plus = qa('.img-viewer .viewer-bar button').find(b => b.textContent.trim() === '＋')
      plus && plus.click(); await sleepF(150); plus && plus.click(); await sleepF(250)
      vr.pct1 = q('.img-viewer .vpct').textContent
      vr.transform = (q('.img-viewer .viewer-stage img') || {}).style && q('.img-viewer .viewer-stage img').style.transform
      const cls = q('.img-viewer .viewer-bar button.primary')
      cls && cls.click(); await sleepF(250)
      vr.closed = !q('.img-viewer')
    }
    log('image-viewer', vr)
    // 画布放大按钮
    const scaleBefore = M.view.scale
    const zoomBtn = qa('.toolbar button').find(b => b.getAttribute('data-tip') === '放大')
    zoomBtn && zoomBtn.click(); await sleepF(120); zoomBtn && zoomBtn.click(); await sleepF(300)
    log('canvas-zoom', { scaleBefore, scaleAfter: M.view.scale, zoomed: M.view.scale > scaleBefore })
    // 树排序：同一文件夹连建两个
    const sideBtn = (kw) => qa('.filetree .mini-btn').find(b => (b.getAttribute('data-tip') || '').includes(kw) || b.textContent.includes(kw))
    for (let i = 0; i < 30 && !qa('.tree-row').length; i++) await sleepF(200)
    const dirRow = qa('.tree-row').find(r => r.textContent.includes('学习笔记'))
    dirRow && dirRow.click(); await sleepF(300)
    sideBtn('脑图') && sideBtn('脑图').click(); await sleepF(300); await submitModal('排序测试A')
    sideBtn('脑图') && sideBtn('脑图').click(); await sleepF(300); await submitModal('排序测试B')
    await sleepF(500)
    const folder = S.tree.find(n => n.name === '学习笔记')
    log('tree-order', { children: folder ? folder.children.map(c => c.name) : [], topIsNewest: !!(folder && folder.children[0] && folder.children[0].name.startsWith('排序测试B')) })
    // 换行
    const nd = (window.__cmindMap).renderer.root.children[0]
    window.__cmindMap.renderer.textEdit.show({ node: nd })
    await sleepF(400)
    const el = q('.smm-node-edit-wrap')
    let lb = { isEditBox: !!el }
    if (el) {
      el.focus(); el.innerHTML = 'A行'
      const rng = document.createRange(); rng.selectNodeContents(el); rng.collapse(false)
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
      await sleepF(150)
      lb.htmlHasBr = el.innerHTML.includes('<br')
      window.__cmindMap.renderer.textEdit.hideEditTextBox()
      await sleepF(300)
      lb.text = JSON.stringify(nd.getData('text'))
    }
    log('line-break-2', lb)
    return out
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const S = window.__cmindStore
  const out = { steps: [] }
  const skipGit = mode === 'skipgit'

  const q = (sel) => document.querySelector(sel)
  const qa = (sel) => [...document.querySelectorAll(sel)]
  const setInput = (el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const log = (name, data) => out.steps.push({ name, ...data })
  const probeFile = async (tag) => {
    const p = S.workspace + '/徐晓赫/测试二级文件夹/测试脑图.cmind'
    try {
      const raw = String(await window.cmind.invoke('fs:read', p))
      let ok = true
      try { JSON.parse(raw) } catch (e) { ok = 'PARSE-FAIL:' + e.message.slice(0, 40) }
      out.steps.push({ name: 'probe-' + tag, len: raw.length, parseOk: ok, tabs: S.tabs.map(t => t.name) })
    } catch (e) { out.steps.push({ name: 'probe-' + tag, err: String(e.message || e) }) }
  }
  await probeFile('start')
  const sideBtn = (kw) => [...document.querySelectorAll('.filetree .mini-btn')].find(b => (b.getAttribute('data-tip') || '').includes(kw) || b.textContent.includes(kw))
  const clickBtnInModal = (label) => {
    const b = qa('.modal-foot button').find(x => x.textContent.trim() === label)
    if (b) b.click()
    return !!b
  }
  const submitModal = async (name) => {
    const inp = q('.modal input')
    if (!inp) throw new Error('modal input not found (button may not have opened)')
    setInput(inp, name)
    await sleep(80)
    clickBtnInModal('确定')
    await sleep(900)
  }

  // ---------- 0. 先绑定远程仓库（真实用户流程：绑定 → 产内容 → 提交推送） ----------
  let gitBind = {}
  if (!skipGit) try {
    gitBind = await window.cmind.invoke('git:bind', {
      url: 'git@github.com:chrisblob/mind-file.git', user: 'chrisblob', token: ''
    })
    const st = await window.cmind.invoke('git:status')
    gitBind.statusAfterBind = { branch: st.branch, branches: st.branches, tracking: st.tracking }
  } catch (e) { gitBind = { error: String(e.message || e) } }
  log('git-bind', skipGit ? 'skipped' : gitBind)

  // ---------- 1. 点击文件夹 → 当前目录切换 → 侧栏新建脑图落在该文件夹 ----------
  for (let i = 0; i < 30 && !qa('.tree-row').length; i++) await sleep(200)
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
    firstChild: folder && folder.children[0] ? folder.children[0].name : null,
    tabs: S.tabs.map(t => t.name)
  })

  // ---------- 1b. 再建一张脑图（供链接选择用） ----------
  sideBtn('脑图') && sideBtn('脑图').click()
  await sleep(300)
  await submitModal('第二张脑图' + Date.now() % 1000)

  // ---------- 2. 插入图片：节点应出现带尺寸的 image 元素 ----------
  const tb = qa('.toolbar button')
  log('toolbar-debug', {
    toolbarCount: tb.length,
    hasMap: typeof window.__cmindMap,
    hasActive: window.__cmindMap ? window.__cmindMap.renderer.activeNodeList.length : -1,
    titles: tb.map(b => b.title)
  })
  const imgBtn = document.querySelector('[data-tip="插入图片"]')
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

  // ---------- 2b. 多格式导入解析（单元级） ----------
  const fmt = {}
  try {
    const xmindJson = JSON.stringify([{ rootTopic: { title: '中心', children: { attached: [
      { title: 'A', children: { attached: [{ title: 'A1' }] } },
      { title: 'B' }
    ] } } }])
    const r1 = parseImportText('xmind', xmindJson)
    fmt['xmind-json'] = { root: r1.data.text, children: r1.children.map(c => c.data.text + (c.children[0] ? '/' + c.children[0].data.text : '')) }

    const xmindXml = '<sheet><topic><title>旧版中心</title><children><topics type="attached"><topic><title>X</title></topic><topic><title>Y</title></topic></topics></children></topic></sheet>'
    const r2 = parseImportText('xmind', xmindXml)
    fmt['xmind-xml'] = { root: r2.data.text, children: r2.children.map(c => c.data.text) }

    const mmText = '<map version="1.0.1"><node TEXT="根"><node TEXT="子一"><node TEXT="孙"/></node><node TEXT="子二"/></node></map>'
    const r3 = parseImportText('freemind', mmText)
    fmt['freemind'] = { root: r3.data.text, children: r3.children.map(c => c.data.text + (c.children[0] ? '/' + c.children[0].data.text : '')) }

    const opmlText = '<opml version="2.0"><head><title>t</title></head><body><outline text="总"><outline text="甲"/><outline text="乙"/></outline></body></opml>'
    const r4 = parseImportText('opml', opmlText)
    fmt['opml'] = { root: r4.data.text, children: r4.children.map(c => c.data.text) }

    const mdText = '# 主标题\n## 小节\n- 要点1\n  - 细节\n- 要点2\n1. 第一\n'
    const r5 = parseImportText('markdown', mdText)
    fmt['markdown'] = { root: r5.data.text, sections: r5.children.map(c => c.data.text), bullets: r5.children[0].children.map(c => c.data.text + '>' + c.children.map(x => x.data.text).join('|')) }

    const r6 = parseImportText('json', JSON.stringify({ format: 'c-mind', version: 1, root: { data: { text: '文档根' }, children: [{ data: { text: 'c' }, children: [] }] } }))
    fmt['cmind-json'] = { root: r6.data.text, children: r6.children.map(c => c.data.text) }

    fmt.extMap = { xmind: extToKind('XMIND'), mm: extToKind('.mm'), opml: extToKind('opml'), md: extToKind('md') }

    // 导出构建
    const sample = { data: { text: '根' }, children: [{ data: { text: '甲' }, children: [{ data: { text: '甲一' }, children: [] }] }, { data: { text: '乙' }, children: [] }] }
    fmt['export-mm'] = buildFreeMind(sample).includes('<node TEXT="甲">')
    fmt['export-opml'] = buildOpml(sample).includes('<outline text="甲一">')
    fmt['export-md'] = buildMarkdown(sample).split('\n').slice(1).join('|')
  } catch (e) {
    fmt.error = String(e.message || e)
  }
  log('format-converters', fmt)

  // ---------- 2c. 导入插入路径（界面级，模拟选好文件后的行为） ----------
  let importFlow = { skipped: true }
  try {
    const M = window.__cmindMap
    const parsed = parseImportText('markdown', '# 导入的根\n- 分支一\n- 分支二\n')
    M.renderer.root.active()
    await sleep(150)
    M.execCommand('INSERT_CHILD_NODE', false, [M.renderer.root], { ...parsed.data }, parsed.children)
    await sleep(800)
    const rootData = M.getData()
    importFlow = { rootText: rootData.data.text, childTexts: rootData.children.map(c => c.data.text) }
  } catch (e) { importFlow = { error: String(e.message || e) } }
  log('import-insert-flow', importFlow)

  // ---------- 2d. 每个二级节点的交互走查（激活/编辑/插入/右键） ----------
  let interact = {}
  try {
    const M = window.__cmindMap
    // 造 3 个二级节点（含一个空文本节点模拟导入场景）
    M.renderer.root.active()
    await sleep(120)
    M.execCommand('INSERT_CHILD_NODE', false, [M.renderer.root], { text: '子A' }, [])
    M.execCommand('INSERT_CHILD_NODE', false, [M.renderer.root], { text: '' }, [])
    M.execCommand('INSERT_CHILD_NODE', false, [M.renderer.root], { text: '子C' }, [])
    await sleep(600)
    const kids = M.renderer.root.children || []
    interact.childCount = kids.length
    interact.perNode = kids.map((nd, i) => {
      const r = { idx: i, text: nd.getData('text') }
      try {
        nd.active()
        r.activate = M.renderer.activeNodeList.includes(nd)
        r.deactivate = (nd.deactivate(), !M.renderer.activeNodeList.includes(nd))
        M.execCommand('SET_NODE_TEXT', nd, '改名' + i)
        r.setText = nd.getData('text') === '改名' + i
        M.execCommand('INSERT_CHILD_NODE', false, [nd], { text: '孙' + i }, [])
        r.insertChild = (nd.children || []).some(c => c.getData('text') === '孙' + i)
        M.execCommand('REMOVE_NODE', nd.children.filter(c => c.getData('text') === '孙' + i))
        r.removeExtra = !(nd.children || []).some(c => c.getData('text') === '孙' + i)
        // 右键事件派发到节点元素
        nd.active()
        const el = nd.group && nd.group.node
        if (el) {
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 }))
          return r  // 右键结果统一在下面统计
        }
        r.el = !!el
      } catch (e) { r.error = String(e.message || e) }
      return r
    })
    await sleep(300)
    interact.ctxMenuShown = !!document.querySelector('.context-menu')
    interact.ctxItems = [...document.querySelectorAll('.context-menu .mi')].map(e => e.textContent.trim())
    closeContextMenu()
    await sleep(100)
    // 空文本节点是否能命中点击区域
    const emptyNode = kids.find(nd => !nd.getData('text'))
    if (emptyNode) {
      const el = emptyNode.group && emptyNode.group.node
      if (el) {
        const rect = el.getBoundingClientRect()
        interact.emptyTextNode = { hitW: Math.round(rect.width), hitH: Math.round(rect.height) }
      }
    }
    // 收尾：恢复文本
    kids.forEach((nd, i) => M.execCommand('SET_NODE_TEXT', nd, '节点' + (i + 1)))
  } catch (e) { interact.error = String(e.message || e) }
  log('node-interaction', interact)
  await probeFile('after-2d')

  // ---------- 2e. 用户真实文件回归：图片节点尺寸修复 + 点击 + 右键菜单 ----------
  let userFile = { skipped: true }
  let preRead = 'not run'
  const toastAtLoad = []
  const mountTrace = []
  try {
    const ufPath = S.workspace + '/徐晓赫/测试二级文件夹/测试脑图.cmind'
    preRead = 'ok'
    try {
      const raw = String(await window.cmind.invoke('fs:read', ufPath))
      const doc = JSON.parse(raw)
      preRead = { rawLen: raw.length, rootText: doc.root.data.text, kids: doc.root.children.length }
    } catch (e) { preRead = 'READ FAIL: ' + (e.message || e) }
    await openMap(ufPath)
    for (let i = 0; i < 10; i++) {
      await sleep(1000)
      const m = window.__cmindMap
      toastAtLoad.push(...S.toasts.map(t => t.text))
      mountTrace.push({
        t: (i + 1) + 's',
        rootText: m ? ((m.getData().data || {}).text || '').slice(0, 10) : 'none',
        kids: m ? ((m.renderer.root || {}).children || []).length : -1,
        svg: !!document.querySelector('.canvas-holder svg'),
        tabs: S.tabs.length
      })
    }
    // 等编辑器完成加载与图片尺寸修复（1MB 图片解码较慢）
    let waited = 0
    const ready = () => {
      const m = window.__cmindMap
      if (!m || ((m.getData().data || {}).text !== '测试脑图')) return false
      const kids = (m.renderer.root && m.renderer.root.children) || []
      return kids.length >= 6 && kids.every(k => k.group)
    }
    while (!ready() && waited < 20000) { await sleep(300); waited += 300 }
    await sleep(800)
    const M = window.__cmindMap
    const first = M.renderer.root.children[0]
    const el = first.group && first.group.node
    const rect = el ? el.getBoundingClientRect() : null
    const img = el ? el.querySelector('image') : null
    userFile = {
      text: JSON.stringify(first.getData('text')),
      rect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      imageRendered: !!img,
      imageSize: img ? (img.getAttribute('width') + 'x' + img.getAttribute('height')) : null,
      childCount: M.renderer.root.children.length
    }
    // 模拟真实点击（mousedown/mouseup/click）
    if (el) {
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
      for (const type of ['mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
      }
      await sleep(300)
      userFile.clickActivates = M.renderer.activeNodeList.includes(first)
    }
    // 模拟右键
    if (el) {
      window.__dbg = []
      M.on('node_contextmenu', (e, n) => window.__dbg.push('emit:' + (n && n.getData('text'))))
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 400 }))
      const trace = []
      for (let i = 0; i < 20; i++) {
        await sleep(50)
        trace.push((window.__cmindStore.contextMenu ? 'S' : '-') + (document.querySelector('.context-menu') ? 'D' : '-'))
      }
      userFile.trace = trace.join('')
      userFile.storeCtx = !!window.__cmindStore.contextMenu
      userFile.ctxMenuShown = !!document.querySelector('.context-menu')
      userFile.ctxItems = [...document.querySelectorAll('.context-menu .mi')].map(x => x.textContent.trim())
      closeContextMenu()
      await sleep(100)
    }
    // 图片尺寸是否已写回文件
    const raw = JSON.parse(await window.cmind.invoke('fs:read', S.workspace + '/徐晓赫/测试二级文件夹/测试脑图.cmind'))
    userFile.savedImageSize = raw.root.children[0].data.imageSize
    userFile.savedText = JSON.stringify(raw.root.children[0].data.text)
    // 看图弹窗：激活图片节点 → 工具栏 🔍 → 放大/缩小
    try {
      const n0 = M.renderer.root.children[0]
      n0.active(); await sleep(300)
      const vb = [...document.querySelectorAll('.toolbar button')].find(b => (b.getAttribute('data-tip') || '').includes('查看图片大图'))
      vb && vb.click(); await sleep(700)
      userFile.viewerOpened = !!document.querySelector('.img-viewer')
      if (userFile.viewerOpened) {
        const bars = [...document.querySelectorAll('.img-viewer .viewer-bar button')]
        userFile.viewerPct0 = document.querySelector('.img-viewer .vpct').textContent
        bars.find(b => b.textContent.trim() === '＋').click(); await sleep(200)
        userFile.viewerPct1 = document.querySelector('.img-viewer .vpct').textContent
        bars.find(b => b.textContent.trim() === '－').click(); await sleep(150)
        // 滚轮缩放
        document.querySelector('.img-viewer .viewer-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
        await sleep(150)
        userFile.viewerPct2 = document.querySelector('.img-viewer .vpct').textContent
        document.querySelector('.img-viewer .viewer-bar button.primary').click(); await sleep(200)
        userFile.viewerClosed = !document.querySelector('.img-viewer')
      }
    } catch (e) { userFile.viewerErr = String(e.message || e) }
    // 回主测试图
    { const back = S.tabs[S.tabs.length - 2]; if (back) await openMap(back.path) }
    await sleep(800)
  } catch (e) {
    const m = window.__cmindMap
    userFile = {
      error: String(e.message || e),
      stack: String(e.stack || '').split('\n')[1] || '',
      state: {
        rootText: m ? (m.getData().data || {}).text : 'no map',
        tabs: S.tabs.map(t => t.name + (t.id === S.activeTabId ? '*' : '') + ' @ ' + (t.path || '-')),
        kids: m ? ((m.renderer.root || {}).children || []).length : -1,
        toasts: S.toasts.map(t => t.text),
      preRead,
      toastAtLoad
      }
    }
  }
  userFile.toastAtLoad = toastAtLoad
  userFile.mountTrace = mountTrace
  log('user-file-check', userFile)

  // ---------- 2f. 悬停提示（tooltip + 快捷键） ----------
  let tipCheck = {}
  try {
    const btn = document.querySelector('[data-tip][data-key]')
    if (btn) {
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await sleep(600)
      const tip = document.querySelector('.cmind-tooltip')
      tipCheck = {
        shown: !!(tip && tip.style.display !== 'none'),
        text: tip ? tip.textContent : null
      }
    } else tipCheck = { found: false }
  } catch (e) { tipCheck = { error: String(e.message || e) } }
  log('tooltip-check', tipCheck)

  // ---------- 2g. 节点内换行（编辑时 Shift+Enter） ----------
  let lineBreak = {}
  try {
    const M = window.__cmindMap
    M.renderer.root.active()
    await sleep(150)
    M.execCommand('INSERT_CHILD_NODE', false, [M.renderer.root], { text: '换行测试' }, [])
    await sleep(500)
    const nd = M.renderer.root.children.find(c => c.getData('text') === '换行测试')
    M.renderer.textEdit.show({ node: nd })
    await sleep(400)
    const el = document.querySelector('.smm-node-edit-wrap')
    lineBreak.isEditBox = !!el
    if (el) {
      el.focus()
      el.innerHTML = '第一行'
      // 设置光标到末尾
      const rng = document.createRange(); rng.selectNodeContents(el); rng.collapse(false)
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
      await sleep(150)
      lineBreak.htmlHasBr = el.innerHTML.includes('<br')
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
      await sleep(100)
    }
    M.renderer.textEdit.hideEditTextBox()
    await sleep(400)
    const t = nd.getData('text')
    lineBreak.nodeText = JSON.stringify(t)
    lineBreak.hasNewline = String(t).includes('\n')
  } catch (e) { lineBreak.error = String(e.message || e) }
  log('line-break', lineBreak)

  // ---------- 3. 脑图链接弹框：按目录层级展示 ----------
  const linkBtn = document.querySelector('[data-tip="插入链接（网页/其他脑图）"]')
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
  if (skipGit) gitResult = { skipped: true }
  else try {
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
