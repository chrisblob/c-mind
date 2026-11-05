/**
 * 多格式脑图 导入解析 / 导出构建
 *
 * 支持导入：
 *  - .cmind / .json   C-Mind 或 simple-mind-map JSON
 *  - .xmind           XMind（新版 content.json / 旧版 content.xml，自动识别）
 *  - .mm              FreeMind / Freeplane XML
 *  - .opml            OPML 大纲（幕布、Workflowy、OmniOutlander 等）
 *  - .md / .markdown  Markdown 大纲（标题 + 无序列表缩进）
 *
 * 支持导出（可被其他平台导入）：
 *  - .xmind（XMind）、.mm（FreeMind）、.opml（大纲类）、.md（Markdown）、.json、png、svg
 */

/* ---------- 导入：把各类格式文本解析为节点树 {data:{text},children:[]} ---------- */

export function extToKind(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  if (e === 'cmind' || e === 'json' || e === 'smm') return 'json'
  if (e === 'xmind') return 'xmind'
  if (e === 'mm') return 'freemind'
  if (e === 'opml') return 'opml'
  if (e === 'md' || e === 'markdown' || e === 'txt') return 'markdown'
  return null
}

export function parseImportText(kind, text) {
  if (kind === 'xmind') return parseXmindAuto(text)
  if (kind === 'json') return parseJsonAny(text)
  if (kind === 'freemind') return parseFreeMind(text)
  if (kind === 'opml') return parseOpml(text)
  if (kind === 'markdown') return parseMarkdown(text)
  throw new Error('不支持的格式：' + kind)
}

// 空标题给默认文案，避免导入后出现极小的“不可操作”节点
const node = (text, children = [], extra = {}) => ({ data: { text: String(text == null ? '' : text).trim() || '子主题', ...extra }, children })
const okSrc = (u) => /^(data:|https?:)/.test(String(u || ''))
const okHref = (u) => { const h = String(u || ''); return /^https?:\/\//.test(h) || h.startsWith('cmind://') }

/* C-Mind / simple-mind-map / 任意含 root 或 data 的 JSON */
export function parseJsonAny(text) {
  let obj
  try { obj = JSON.parse(text) } catch (e) { throw new Error('JSON 解析失败：' + e.message) }
  return normalizeNodeTree(obj)
}

export function normalizeNodeTree(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('无法识别的脑图数据')
  // c-mind 文档
  if (obj.format === 'c-mind' && obj.root) obj = obj.root
  // {root: {...}}
  if (obj.root && obj.root.data) obj = obj.root
  // simple-mind-map 节点
  if (obj.data && Array.isArray(obj.children)) {
    const d = obj.data
    const data = { text: String(d.text || '') }
    for (const k of ['hyperlink', 'hyperlinkTitle', 'note', 'imageSize']) {
      if (d[k] !== undefined && d[k] !== null && d[k] !== '') data[k] = d[k]
    }
    // 兼容历史误写的对象格式 {url,...}：转回 sm-m 规范的 image(URL 字符串) + imageSize
    const img = d.image
    if (img && typeof img === 'object' && img.url) {
      data.image = String(img.url)
      const w = Number(img.width) || 0
      const h = Number(img.height) || 0
      if (!data.imageSize && w > 0 && h > 0) data.imageSize = { width: w, height: h, custom: false }
    } else if (typeof img === 'string' && img) {
      data.image = img
    }
    return { data, children: (obj.children || []).map(normalizeNodeTree) }
  }
  throw new Error('无法识别的 JSON 结构')
}

/* XMind：新版 zip 内是 content.json（数组），旧版是 content.xml */
export function parseXmindAuto(text) {
  const trimmed = String(text || '').trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let arr
    try { arr = JSON.parse(trimmed) } catch (e) { throw new Error('XMind content.json 解析失败：' + e.message) }
    if (Array.isArray(arr)) arr = arr[0]
    return xmindTopicJson(arr && arr.rootTopic)
  }
  return parseXmindXml(text)
}

function xmindTopicJson(t) {
  if (!t) throw new Error('XMind 文件缺少 rootTopic')
  const children = []
  const att = (t.children && t.children.attached) || []
  for (const c of att) children.push(xmindTopicJson(c))
  const extra = {}
  if (t.image && okSrc(t.image.src)) {
    // sm-m 节点格式：data.image = URL 字符串，尺寸放 data.imageSize
    extra.image = String(t.image.src)
    const w = Number(t.image.width) || 0
    const h = Number(t.image.height) || 0
    if (w > 0 && h > 0) extra.imageSize = { width: w, height: h, custom: false }
  }
  if (okHref(t.href)) extra.hyperlink = t.href
  return node(t.title || '', children, extra)
}

/* XMind 旧版 content.xml：<topic><title>..</title><children><topics><topic> */
export function parseXmindXml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('XMind content.xml 解析失败')
  const first = doc.querySelector('topic')
  if (!first) throw new Error('XMind 文件中未找到主题节点')
  return xmindTopicXml(first)
}

function xmindTopicXml(el) {
  const titleEl = el.querySelector(':scope > title')
  const children = []
  const kidsEl = el.querySelector(':scope > children')
  if (kidsEl) {
    for (const t of kidsEl.querySelectorAll(':scope > topics > topic, :scope > topic')) {
      children.push(xmindTopicXml(t))
    }
  }
  const extra = {}
  const imgEl = el.querySelector(':scope > img')
  if (imgEl) {
    const src = imgEl.getAttributeNS('http://www.w3.org/1999/xhtml', 'src')
      || imgEl.getAttribute('xhtml:src') || imgEl.getAttribute('src')
    if (okSrc(src)) extra.image = String(src) // sm-m：image 为 URL 字符串，尺寸打开时由 repairImageSizes 探测
  }
  const href = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  if (okHref(href)) extra.hyperlink = href
  return node(titleEl ? titleEl.textContent : '', children, extra)
}

/* FreeMind / Freeplane：<map><node TEXT="..."><node .../></node></map> */
export function parseFreeMind(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('FreeMind 文件解析失败')
  const rootEl = doc.getElementsByTagName('node')[0]
  if (!rootEl) throw new Error('FreeMind 文件中未找到节点')
  return fmNode(rootEl)
}

function fmNode(el) {
  const children = []
  for (const c of el.children) {
    if (c.tagName.toLowerCase() === 'node') children.push(fmNode(c))
  }
  return node(el.getAttribute('TEXT') || el.getAttribute('text') || '', children)
}

/* OPML：<opml><body><outline text="..."><outline .../></outline></body></opml> */
export function parseOpml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('OPML 文件解析失败')
  const body = doc.getElementsByTagName('body')[0]
  if (!body) throw new Error('OPML 文件中未找到 body')
  const tops = [...body.children].filter(e => e.tagName.toLowerCase() === 'outline')
  if (!tops.length) throw new Error('OPML 文件中没有内容')
  // 多个顶层 outline 时，包一个虚拟根
  const children = tops.map(opmlNode)
  if (tops.length === 1) return children[0]
  return node('导入的大纲', children)
}

function opmlNode(el) {
  const children = [...el.children]
    .filter(e => e.tagName.toLowerCase() === 'outline')
    .map(opmlNode)
  return node(el.getAttribute('text') || el.getAttribute('_text') || el.getAttribute('title') || '', children)
}

/* Markdown：标题(#/##/…) 与无序列表(- * +)缩进，转成树 */
export function parseMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/)
  // 第一个一级标题（# ）作为根节点；没有一级标题时保持默认
  let rootText = '导入笔记'
  let firstH1Idx = -1
  let inCodePre = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inCodePre = !inCodePre; continue }
    if (!inCodePre && /^#\s+\S/.test(lines[i])) { rootText = lines[i].replace(/^#\s+/, '').trim(); firstH1Idx = i; break }
  }
  const root = node(rootText)
  const stack = [{ depth: 0, node: root }]
  let inCode = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (/^\s*```/.test(raw)) { inCode = !inCode; continue }
    if (inCode || !raw.trim()) continue
    if (i === firstH1Idx) continue // 已用作根节点
    const h = raw.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const depth = h[1].length
      const n = node(h[2])
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
      stack[stack.length - 1].node.children.push(n)
      stack.push({ depth, node: n })
      continue
    }
    const b = raw.match(/^(\s*)[-*+]\s+(.*)$/)
    if (b) {
      const indent = b[1].replace(/\t/g, '  ').length
      const depth = 100 + Math.floor(indent / 2) // 列表深度与标题深度分开计数
      const n = node(b[2])
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
      stack[stack.length - 1].node.children.push(n)
      stack.push({ depth, node: n })
      continue
    }
    // 有序列表 1. 2.
    const o = raw.match(/^(\s*)\d+[.)]\s+(.*)$/)
    if (o) {
      const indent = o[1].replace(/\t/g, '  ').length
      const depth = 100 + Math.floor(indent / 2)
      const n = node(o[2])
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
      stack[stack.length - 1].node.children.push(n)
      stack.push({ depth, node: n })
    }
  }
  return root
}

/* ---------- 导出：把节点树构建为其他平台可导入的文本格式 ---------- */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* FreeMind .mm */
export function buildFreeMind(root) {
  const walk = (n) => {
    const kids = (n.children || []).map(walk).join('')
    return `<node TEXT="${esc(n.data.text)}">${kids}</node>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">${walk(root)}</map>`
}

/* OPML 2.0 */
export function buildOpml(root) {
  const walk = (n) => {
    const kids = (n.children || []).map(walk).join('')
    return `<outline text="${esc(n.data.text)}">${kids}</outline>`
  }
  const tops = (root.children || []).map(walk).join('')
  const title = esc(root.data.text)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${title}</title></head>\n  <body>${tops || walk(root)}</body>\n</opml>`
}

/* Markdown 大纲：根为一级标题，其余按层级缩进为列表 */
export function buildMarkdown(root) {
  const out = ['# ' + (root.data.text || '')]
  const walk = (list, depth) => {
    for (const n of list || []) {
      out.push('  '.repeat(depth) + '- ' + (n.data.text || ''))
      walk(n.children, depth + 1)
    }
  }
  walk(root.children, 0)
  return out.join('\n')
}

/* dataURL("data:...;base64,xxx") → { mime, base64 }，用于主进程写二进制文件 */
export function dataUrlToBase64(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '')
  if (!m) return null
  if (!m[2]) return { mime: m[1] || 'text/plain', base64: btoa(unescape(encodeURIComponent(decodeURIComponent(m[3])))) }
  return { mime: m[1] || 'application/octet-stream', base64: m[3] }
}
