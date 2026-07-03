import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_REF_HREF_PREFIX,
  parseArtifactRefHref,
  transformArtifactRefs,
} from './artifact-ref-text'

const none = () => false
const all = () => true
const known = (...ids: string[]) => (id: string) => ids.includes(id)

const link = (id: string) => `[产物](${ARTIFACT_REF_HREF_PREFIX}${id})`

describe('transformArtifactRefs — <artifact_ref/> 标签', () => {
  it('转完整自闭合标签为内联链接，且不残留原始标签文本', () => {
    const out = transformArtifactRefs('终稿 <artifact_ref id="art_gRofWGR0cvQD"/> 约 5400 字', none)
    expect(out).toBe(`终稿 ${link('art_gRofWGR0cvQD')} 约 5400 字`)
    expect(out).not.toContain('<artifact_ref')
  })

  it('容忍属性空白 / 单引号 / 额外属性等变体', () => {
    expect(transformArtifactRefs('a <artifact_ref  id = "art_ABCDEFGH" /> b', none)).toBe(
      `a ${link('art_ABCDEFGH')} b`,
    )
    expect(transformArtifactRefs("a <artifact_ref id='art_ABCDEFGH'/> b", none)).toBe(
      `a ${link('art_ABCDEFGH')} b`,
    )
    expect(
      transformArtifactRefs('a <artifact_ref version="2" id="art_ABCDEFGH" kind="doc"/> b', none),
    ).toBe(`a ${link('art_ABCDEFGH')} b`)
  })

  it('标签始终转（store 未命中也不透标签，命中与否交给渲染层）', () => {
    const out = transformArtifactRefs('参考 <artifact_ref id="art_unknown01"/> 结束', none)
    expect(out).toBe(`参考 ${link('art_unknown01')} 结束`)
    expect(out).not.toContain('<artifact_ref')
  })

  it('剥掉成对闭合标签的闭合部分', () => {
    const out = transformArtifactRefs('x <artifact_ref id="art_ABCDEFGH"></artifact_ref> y', none)
    expect(out).not.toContain('artifact_ref')
    expect(out).toContain(link('art_ABCDEFGH'))
  })

  it('剥掉流式途中结尾的半截标签，不闪现原文', () => {
    const out = transformArtifactRefs('文档已完成 <artifact_ref id="art_gRof', none)
    expect(out).toBe('文档已完成 ')
    expect(out).not.toContain('<artifact_ref')
  })

  it('成对标签的内文不外泄（折叠为单个引用点）', () => {
    const out = transformArtifactRefs(
      'x <artifact_ref id="art_ABCDEFGH">终稿标题文本</artifact_ref> y',
      none,
    )
    expect(out).toBe(`x ${link('art_ABCDEFGH')} y`)
    expect(out).not.toContain('终稿标题文本')
  })

  it('成对折叠限段内：两个自闭合引用间的正文不被误吞', () => {
    const out = transformArtifactRefs(
      '<artifact_ref id="art_AAAABBBB"/> 中间正文\n\n结尾 </artifact_ref>',
      none,
    )
    expect(out).toContain('中间正文')
    expect(out).toContain('结尾')
    expect(out).not.toContain('artifact_ref')
  })

  it('空 id / 异形 id（括号空白）不破坏链接语法，落到不可用 chip', () => {
    expect(transformArtifactRefs('a <artifact_ref id=""/> b', none)).toBe(`a ${link('')} b`)
    const out = transformArtifactRefs('a <artifact_ref id="art_a)b"/> b', none)
    expect(out).toBe(`a ${link('')} b`)
    expect(out).not.toContain(')b)')
  })

  it('大写标签同样被转（gi）', () => {
    const out = transformArtifactRefs('a <ARTIFACT_REF ID="art_ABCDEFGH"/> b', none)
    expect(out).toBe(`a ${link('art_ABCDEFGH')} b`)
  })

  it('单串多引用各自转写', () => {
    const out = transformArtifactRefs(
      '<artifact_ref id="art_AAAABBBB"/> 和 <artifact_ref id="art_CCCCDDDD"/>',
      none,
    )
    expect(out).toBe(`${link('art_AAAABBBB')} 和 ${link('art_CCCCDDDD')}`)
  })
})

describe('transformArtifactRefs — 裸 art_ 词', () => {
  it('命中 store 才转链接', () => {
    expect(transformArtifactRefs('产物 art_IJBBKYJUkJ0E 带出处', known('art_IJBBKYJUkJ0E'))).toBe(
      `产物 ${link('art_IJBBKYJUkJ0E')} 带出处`,
    )
  })

  it('未命中保持原文（防误伤）', () => {
    const text = '产物 art_IJBBKYJUkJ0E 带出处'
    expect(transformArtifactRefs(text, none)).toBe(text)
  })

  it('短于 8 位的 art_ 不转', () => {
    const text = '变量 art_abc 不是产物'
    expect(transformArtifactRefs(text, all)).toBe(text)
  })

  it('不二次命中已生成链接 href 里的 art_（避免嵌套改写）', () => {
    const out = transformArtifactRefs('见 <artifact_ref id="art_ABCDEFGH"/>', all)
    expect(out).toBe(`见 ${link('art_ABCDEFGH')}`)
  })
})

describe('transformArtifactRefs — 代码区不动', () => {
  it('围栏代码块里的标签 / 裸词都不转', () => {
    const text = '```\n<artifact_ref id="art_ABCDEFGH"/> art_IJBBKYJUkJ0E\n```'
    expect(transformArtifactRefs(text, all)).toBe(text)
  })

  it('行内代码里的裸词不转', () => {
    const text = '用 `art_IJBBKYJUkJ0E` 举例'
    expect(transformArtifactRefs(text, all)).toBe(text)
  })

  it('4+ 反引号 fence 内嵌 3 反引号示例也整体受保护', () => {
    const text = '````\n```\n<artifact_ref id="art_ABCDEFGH"/>\n```\n````'
    expect(transformArtifactRefs(text, all)).toBe(text)
  })

  it('原文混入哨兵控制符时被剥掉，不与占位撞车', () => {
    const dirty = `a \x010\x02 <artifact_ref id="art_ABCDEFGH"/> b`
    const out = transformArtifactRefs(dirty, none)
    expect(out).toBe(`a 0 ${link('art_ABCDEFGH')} b`)
    expect(out).not.toContain('\x01')
  })
})

describe('transformArtifactRefs — 无关文本快速返回', () => {
  it('不含产物引用的正文原样返回', () => {
    const text = '普通一句话，没有任何引用。'
    expect(transformArtifactRefs(text, all)).toBe(text)
  })
})

describe('parseArtifactRefHref', () => {
  it('识别产物引用 href 并取回 id', () => {
    expect(parseArtifactRefHref(`${ARTIFACT_REF_HREF_PREFIX}art_ABCDEFGH`)).toBe('art_ABCDEFGH')
  })

  it('普通链接返回 null', () => {
    expect(parseArtifactRefHref('https://example.com')).toBeNull()
    expect(parseArtifactRefHref('#section')).toBeNull()
    expect(parseArtifactRefHref(undefined)).toBeNull()
  })
})
