<script setup>
/**
 * Git 抽屉：工作区绑定 GitHub 仓库、查看状态、提交 / 推送 / 拉取 / 历史
 */
import { ref, onMounted } from 'vue'
import { store, api, toast, uiPrompt } from '../store.js'

const form = ref({ url: '', user: '', token: '' })
const binding = ref(false)
const status = ref(null)
const message = ref('')
const logs = ref([])
const busy = ref(false)

onMounted(refresh)

async function refresh() {
  try {
    status.value = await api('git:status')
    if (status.value.isRepo) logs.value = await api('git:log')
    const cfg = store.config.git
    if (cfg) form.value = { url: cfg.remote || '', user: cfg.user || '', token: cfg.token || '' }
  } catch (e) {
    toast('获取 Git 状态失败：' + (e.message || e), 'error')
  }
}

async function bind() {
  if (!form.value.url.trim()) { toast('请填写仓库地址', 'error'); return }
  binding.value = true
  try {
    const res = await api('git:bind', {
      url: form.value.url.trim(),
      user: form.value.user.trim(),
      token: form.value.token.trim()
    })
    const cfg = await api('config:get')
    store.config = cfg
    if (res.authOk) toast('已绑定远程仓库，凭据校验通过', 'ok')
    else toast('已绑定，但访问远程失败：' + res.authMsg + '（请检查仓库地址与 Token）', 'error')
    await refresh()
  } catch (e) {
    toast('绑定失败：' + (e.message || e), 'error')
  } finally {
    binding.value = false
  }
}

async function unbind() {
  await api('git:unbind')
  store.config = await api('config:get')
  toast('已解绑远程仓库')
  await refresh()
}

async function commit() {
  busy.value = true
  try {
    await api('git:commit', message.value)
    toast('已提交全部变更', 'ok')
    message.value = ''
    await refresh()
  } catch (e) {
    toast('提交失败：' + (e.message || e), 'error')
  } finally { busy.value = false }
}

async function push() {
  busy.value = true
  try {
    const r = await api('git:push')
    toast(`已推送 ${r.ahead || 0} 个提交到 ${r.branch}`, 'ok')
    await refresh()
  } catch (e) {
    toast('推送失败：' + (e.message || e), 'error')
  } finally { busy.value = false }
}

async function pull() {
  busy.value = true
  try {
    const r = await api('git:pull')
    toast('已从 ' + r.branch + ' 拉取', 'ok')
    await refresh()
  } catch (e) {
    toast('拉取失败：' + (e.message || e), 'error')
  } finally { busy.value = false }
}

const flagText = { untracked: '＋', M: 'M', A: 'A', D: 'D', R: 'R' }

async function onBranchChange(branch) {
  if (!branch || branch === status.value.branch) return
  busy.value = true
  try {
    await api('git:checkout', branch)
    toast('已切换到分支 ' + branch, 'ok')
    await refresh()
  } catch (e) {
    toast('切换分支失败：' + (e.message || e), 'error')
    await refresh()
  } finally { busy.value = false }
}

async function newBranch() {
  const name = await uiPrompt('新建分支（基于当前分支）', '分支名', '', '例如：feature/roadmap', true)
  if (!name) return
  busy.value = true
  try {
    await api('git:createBranch', name)
    toast('已创建并切换到 ' + name, 'ok')
    await refresh()
  } catch (e) {
    toast('创建分支失败：' + (e.message || e), 'error')
  } finally { busy.value = false }
}
</script>

<template>
  <div class="drawer">
    <div class="drawer-head">
      <span>Git 仓库</span>
      <button class="icon-btn" @click="store.gitOpen = false">✕</button>
    </div>
    <div class="drawer-body">
      <!-- 绑定 -->
      <div class="git-section">
        <h4>绑定 GitHub 仓库</h4>
        <div class="form-row">
          <label>仓库地址（HTTPS）</label>
          <input type="url" v-model="form.url" placeholder="https://github.com/you/your-repo.git" />
        </div>
        <div class="form-row">
          <label>用户名</label>
          <input type="text" v-model="form.user" placeholder="github 用户名" />
        </div>
        <div class="form-row">
          <label>Personal Access Token（需要 repo 权限；仅保存在本机）</label>
          <input type="password" v-model="form.token" placeholder="ghp_…" />
        </div>
        <div style="display:flex; gap:8px">
          <button class="primary" :disabled="binding" @click="bind">{{ binding ? '绑定中…' : '绑定 / 更新' }}</button>
          <button v-if="store.config.git" @click="unbind">解绑</button>
        </div>
        <p class="hint" style="margin-top:8px">
          绑定后整个工作区文件夹成为一个 git 仓库；Token 只存在本机配置中，推送时使用。
          建议在 GitHub 创建仅含 repo 权限的 Fine-grained Token。
        </p>
      </div>

      <!-- 状态 -->
      <div class="git-section" v-if="status && status.isRepo">
        <h4>状态</h4>
        <div class="status-line" style="flex-wrap:wrap">
          <select
            v-if="status.branches && status.branches.length"
            :value="status.branch" data-tip="切换分支" style="width:auto"
            @change="onBranchChange($event.target.value)"
          >
            <option v-for="b in status.branches" :key="b" :value="b">{{ b }}</option>
          </select>
          <span v-else class="badge">{{ status.branch || '无分支' }}</span>
          <button class="icon-btn" data-tip="从当前分支新建分支" @click="newBranch">＋ 分支</button>
          <span class="badge gray" v-if="status.tracking">↑{{ status.ahead }} ↓{{ status.behind }}</span>
          <span v-if="!status.tracking" class="badge warn">未跟踪远程分支</span>
          <span v-if="status.ownRepo === false" class="badge warn">嵌套于外部仓库</span>
        </div>
        <div class="changed-list" v-if="status.changed.length">
          <div class="ci" v-for="(f, i) in status.changed" :key="i">
            <span class="flag">{{ flagText[f.flag] || '·' }}</span>
            <span>{{ f.path }}</span>
          </div>
        </div>
        <p class="hint" v-else>没有未提交的变更 ✓</p>

        <div class="form-row" style="margin-top:10px">
          <label>提交说明</label>
          <input type="text" v-model="message" placeholder="本次改了什么…" @keydown.enter="commit" />
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <button class="primary" :disabled="busy || !message.trim()" @click="commit">提交</button>
          <button :disabled="busy" @click="push">推送</button>
          <button :disabled="busy" @click="pull">拉取</button>
        </div>
      </div>
      <div class="git-section" v-else-if="status">
        <h4>状态</h4>
        <p class="hint">当前工作区还不是 git 仓库，绑定上方远程仓库后会自动执行 <code>git init</code>。</p>
      </div>

      <!-- 历史 -->
      <div class="git-section" v-if="logs.length">
        <h4>提交历史</h4>
        <div class="log-list">
          <div class="li" v-for="c in logs" :key="c.hash">
            <div>{{ c.message }}</div>
            <div class="meta">{{ c.hash }} · {{ c.author }} · {{ new Date(c.date).toLocaleString('zh-CN') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
