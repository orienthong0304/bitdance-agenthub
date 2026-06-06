import type { ArtifactContent } from '@/shared/types'

type PptContent = Extract<ArtifactContent, { type: 'ppt' }>

/**
 * 把 ppt artifact 的结构化 slides JSON 转成真正的 .pptx 二进制（Office 可打开）。
 *
 * pptxgenjs 动态 import：仅导出时加载，且配合 next.config serverExternalPackages
 * 避免 standalone bundle 踩 CJS / 动态 require 坑（详见计划「风险」节）。
 */
export async function slidesToPptxBuffer(
  content: PptContent,
  fallbackTitle: string,
): Promise<Uint8Array> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.title = content.title || fallbackTitle
  pptx.layout = 'LAYOUT_16x9'

  const primary = content.theme?.primaryColor || '1E40AF'
  const font = content.theme?.fontFace || 'Arial'

  for (const s of content.slides) {
    const slide = pptx.addSlide()
    const layout = s.layout ?? 'title-bullets'

    if (layout === 'title' || layout === 'section') {
      // 封面 / 章节页：标题居中放大，不渲染 bullets
      if (s.title) {
        slide.addText(s.title, {
          x: 0.5,
          y: '40%',
          w: '90%',
          h: 1.5,
          fontSize: layout === 'title' ? 40 : 32,
          bold: true,
          color: primary,
          fontFace: font,
          align: 'center',
        })
      }
    } else {
      // 内容页：顶部标题 + 要点列表
      if (s.title) {
        slide.addText(s.title, {
          x: 0.5,
          y: 0.4,
          w: '90%',
          h: 1,
          fontSize: 28,
          bold: true,
          color: primary,
          fontFace: font,
        })
      }
      if (s.bullets && s.bullets.length > 0) {
        slide.addText(
          s.bullets.map((t) => ({ text: t, options: { bullet: true } })),
          {
            x: 0.7,
            y: 1.6,
            w: '85%',
            h: 4.5,
            fontSize: 18,
            color: '333333',
            fontFace: font,
            valign: 'top',
          },
        )
      }
    }

    if (s.notes) slide.addNotes(s.notes)
  }

  // outputType 'nodebuffer' 返回 Node Buffer（Uint8Array 子类）
  return (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array
}
