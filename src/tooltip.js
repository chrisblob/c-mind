/**
 * 全局悬停提示（tooltip）：读取元素的 data-tip / data-key
 * - data-tip：提示文案
 * - data-key：可选的快捷键徽标
 * 延迟 350ms 出现，避免误触；位置优先在元素下方，空间不足时翻转到上方
 */
let tipEl = null
let showTimer = null

function ensureEl() {
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'cmind-tooltip'
    tipEl.style.display = 'none'
    document.body.appendChild(tipEl)
  }
  return tipEl
}

function show(target) {
  const text = target.getAttribute('data-tip')
  if (!text) return
  const key = target.getAttribute('data-key')
  hide()
  showTimer = setTimeout(() => {
    const el = ensureEl()
    el.innerHTML = `<span>${text}</span>` + (key ? `<span class="kbd">${key}</span>` : '')
    el.style.display = 'flex'
    const rect = target.getBoundingClientRect()
    const tipRect = el.getBoundingClientRect()
    let top = rect.bottom + 6
    if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 6
    let left = rect.left + rect.width / 2 - tipRect.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8))
    el.style.top = top + 'px'
    el.style.left = left + 'px'
  }, 350)
}

function hide() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  if (tipEl) tipEl.style.display = 'none'
}

export function installTooltip() {
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-tip]')
    if (t) show(t)
  })
  document.addEventListener('mouseout', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-tip]')) hide()
  })
  document.addEventListener('mousedown', hide, true)
  window.addEventListener('blur', hide)
}
