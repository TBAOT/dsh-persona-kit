import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Render smoke test for the client panel.
 *
 * The panel is plain `h()` calls, so it can be rendered with a stubbed React and no
 * DOM. This exists because a moved `const` (used by the tab row but declared lower in
 * the component) shipped a **blank panel**: `node --check` passed, tests passed, and
 * the first person to refresh saw nothing. Rendering once turns that class of mistake
 * into a failing test.
 */
function stubReact(seed = []) {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const queue = [...seed]
  return {
    Fragment: 'Fragment',
    createElement,
    // 前几个 useState 用给定值，其余用它们自己的初值——这样能把"有数据"的渲染路径也跑一遍。
    useState: (init) => [queue.length ? queue.shift() : typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
  }
}

/** 第一次 import 时把 factory 抓住；之后每个用例都用它创建一份新的模块实例。 */
let capturedFactory = null

function loadPanel(seed = []) {
  const require = (name) => {
    if (name === 'react') return stubReact(seed)
    throw new Error(`unexpected require: ${name}`)
  }
  if (capturedFactory) return Promise.resolve(capturedFactory(require))
  globalThis.window = {
    __ModuleLoader__: {
      load(module) {
        capturedFactory = module.factory
      },
    },
  }
  return import('../lib/client/panel.js').then(() => (capturedFactory ? capturedFactory(require) : null))
}

test('the panel renders once without throwing', async () => {
  const plugin = await loadPanel()
  assert.ok(plugin && typeof plugin.apply === 'function', '面板模块必须导出 apply')

  const registered = []
  const ctx = {
    slots: {
      inject: (name, register) => register(),
      register: (slot, component) => {
        registered.push({ slot, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  const main = registered.find((entry) => entry.slot?.name === 'main')
  assert.ok(main, '主面板必须注册到 main slot')

  // Render with empty props: this is where a hoisting/TDZ mistake surfaces.
  const tree = main.component({})
  assert.ok(tree, '渲染结果不能为空')

  // 同一棵树在英文下也要能渲染：语言只在 h() 里做文本替换，不该改变结构。
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
  try {
    const english = main.component({})
    assert.ok(english, '英文渲染结果不能为空')
  } finally {
    delete globalThis.navigator
  }
})

test('the panel renders the editing view with real state', async () => {
  // 有数据时才走的路径（编辑页、按条/整份切换）平时测不到，这里喂一份 state 进去。
  const draft = {
    text: '第一条事实\n§\n第二条事实',
    loaded: '第一条事实\n§\n第二条事实',
    usage: { used: 20, limit: 900, percent: 2 },
    file: 'C:/x/memory.md',
  }
  const plugin = await loadPanel([
    'zh', // locale
    { personas: [{ id: '甲', name: '甲', workspaces: [], limits: { user: 800, memory: 900 } }] },
    '甲',
    'memory',
    draft,
    draft,
  ])
  const registered = []
  plugin.apply({
    slots: {
      inject: (name, register) => register(),
      register: (slot, component) => {
        registered.push({ slot, component })
        return () => {}
      },
    },
  })
  const main = registered.find((entry) => entry.slot?.name === 'main')
  const tree = main.component({})
  const flat = JSON.stringify(tree)
  assert.match(flat, /"className":"dp-editor-bar"/, '编辑页应当出现"整份文本 / 按条"切换')
  assert.match(flat, /"className":"dp-manuscript"/, '默认仍是整份文本模式')
})

test('choosing "by entry" renders one row per fact', async () => {
  const draft = {
    text: '第一条事实\n§\n第二条事实',
    loaded: '第一条事实\n§\n第二条事实',
    usage: { used: 20, limit: 900, percent: 2 },
    file: 'C:/x/memory.md',
  }
  // localStorage 里记着上次选"按条"
  globalThis.window = { __ModuleLoader__: { load() {} }, localStorage: { getItem: () => 'entries' } }
  const plugin = await loadPanel([
    'zh', // locale
    { personas: [{ id: '甲', name: '甲', workspaces: [], limits: { user: 800, memory: 900 } }] },
    '甲',
    'memory',
    draft,
    draft,
  ])

  const registered = []
  plugin.apply({
    slots: {
      inject: (name, register) => register(),
      register: (slot, component) => {
        registered.push({ slot, component })
        return () => {}
      },
    },
  })
  const main = registered.find((entry) => entry.slot?.name === 'main')
  // localStorage 要在渲染之后才撤：useState 的初值是在 component() 里读的
  const flat = JSON.stringify(main.component({}))
  delete globalThis.window.localStorage
  assert.match(flat, /"className":"dp-row-list"/, '按条模式应渲染条目列表')
  assert.match(flat, /第一条事实/)
  assert.match(flat, /第二条事实/)
  assert.equal(flat.includes('"className":"dp-manuscript"'), false, '按条模式不渲染整份文本域')
})
