// 把 text part 正文里的产物引用（`<artifact_ref id="art_..."/>` 裸标签、命中 store 的裸
// `art_xxx` 词）在进入 markdown 前改写成内联链接占位，再由 Markdown 的 `a` 覆写渲染成产物卡片/chip。
// 关键约束：任何情况下都不把原始 `<artifact_ref>` 标签文本透给用户（micromark 因标签名含下划线
// 不识别为 HTML，会原样当文字渲染，这正是 P0-1 泄漏点）。

/** 内联产物引用链接的 href 前缀。用 `#` 片段形态，绕开 react-markdown 的 URL 协议白名单过滤。 */
export const ARTIFACT_REF_HREF_PREFIX = '#artifact-ref-'

const REF_LINK_LABEL = '产物'

// 占位边界用控制符（U+0001 / U+0002）拼装，不会出现在正常正文；替换与还原都在本函数内完成，
// 控制符不会流到 markdown。用 fromCharCode 生成，避免源码里出现裸控制字符。
const STASH_OPEN = String.fromCharCode(1)
const STASH_CLOSE = String.fromCharCode(2)

/** 从改写后的 href 里取回 artifactId；不是产物引用返回 null。 */
export function parseArtifactRefHref(href: string | undefined): string | null {
  if (!href || !href.startsWith(ARTIFACT_REF_HREF_PREFIX)) return null
  return href.slice(ARTIFACT_REF_HREF_PREFIX.length)
}

/**
 * 纯函数：改写正文里的产物引用。
 * - `<artifact_ref id="art_..."/>`（含属性顺序 / 空白 / 单双引号变体）→ 内联链接（无论 store 是否命中，
 *   都不透标签；命中与否由渲染层的 chip 决定卡片 or 弱化「不可用」）。
 * - 裸 `art_[A-Za-z0-9]{8,}` 词 → 仅 `isKnownArtifact` 命中才转链接，否则保持原文（防误伤）。
 * - 代码块 / 行内代码内的内容一律不动。
 * - 结尾未闭合的 `<artifact_ref` 片段（流式途中）直接剥掉，避免半截标签闪现。
 */
export function transformArtifactRefs(
  content: string,
  isKnownArtifact: (artifactId: string) => boolean,
): string {
  if (!content.includes('artifact_ref') && !content.includes('art_')) return content

  const stash: string[] = []
  const put = (finalText: string): string => {
    const token = `${STASH_OPEN}${stash.length}${STASH_CLOSE}`
    stash.push(finalText)
    return token
  }

  // 原文若混入哨兵控制符（正常正文不会有），先剥掉，防止与占位 token 撞车损坏内容
  const sentinels = new RegExp(`[${STASH_OPEN}${STASH_CLOSE}]`, 'g')
  let s = content
    .replace(sentinels, '')
    .replace(/(`{3,})[\s\S]*?\1/g, (m) => put(m)) // fenced ```（≥3 个反引号，含 4+ 嵌套示例形态）
    .replace(/(~{3,})[\s\S]*?\1/g, (m) => put(m)) // fenced ~~~
    .replace(/`[^`\n]+`/g, (m) => put(m)) // 行内代码

  // 成对标签（含内文）整体折叠为引用点：内文不外泄，chip 标题以 store 为准。
  // 开始标签须非自闭合（负向后顾），内文限段内（不跨空行），防止把两个独立引用间的正文误吞
  s = s.replace(
    /<artifact_ref\b([^>]*?)(?<!\/)>(?:(?!\n{2})[\s\S])*?<\/artifact_ref\s*>/gi,
    (_m, attrs: string) => put(refLink(extractId(attrs) ?? '')),
  )
  // 落单的闭合标签直接去掉
  s = s.replace(/<\/artifact_ref\s*>/gi, '')
  // 开始 / 自闭合标签 → 内联链接占位（始终转，绝不透标签）
  s = s.replace(/<artifact_ref\b([^>]*?)\/?>/gi, (_m, attrs: string) =>
    put(refLink(extractId(attrs) ?? '')),
  )
  // 流式途中结尾的半截标签（还没等到 `>`）剥掉，避免闪现原文
  s = s.replace(/<artifact_ref\b[^>]*$/i, '')
  // 裸 art_ 词：命中 store 才转
  s = s.replace(/\bart_[A-Za-z0-9]{8,}\b/g, (m) => (isKnownArtifact(m) ? put(refLink(m)) : m))

  // 还原占位（最终文本原样回填，不再参与扫描）
  const restore = new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}`, 'g')
  return s.replace(restore, (_m, i: string) => stash[Number(i)] ?? '')
}

function extractId(attrs: string): string | null {
  const m = /\bid\s*=\s*["']([^"']*)["']/i.exec(attrs)
  if (!m) return null
  // 异形 id（含空白 / 括号等 markdown 特殊符）不进链接，落到「不可用」chip 而不是破坏链接语法
  return /^[A-Za-z0-9_-]+$/.test(m[1]) ? m[1] : null
}

function refLink(artifactId: string): string {
  return `[${REF_LINK_LABEL}](${ARTIFACT_REF_HREF_PREFIX}${artifactId})`
}
