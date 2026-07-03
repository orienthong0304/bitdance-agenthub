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
