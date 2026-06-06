import { describe, expect, it } from 'vitest'

import { slidesToPptxBuffer } from './ppt-export'

describe('slidesToPptxBuffer', () => {
  it('produces a non-empty .pptx (ZIP) buffer', async () => {
    const buf = await slidesToPptxBuffer(
      {
        type: 'ppt',
        title: 'Test Deck',
        slides: [
          { title: '封面', layout: 'title' },
          { title: '要点', bullets: ['一', '二'], notes: '备注' },
        ],
      },
      'fallback',
    )
    expect(buf.length).toBeGreaterThan(0)
    // .pptx 是 ZIP 容器，前两字节为 ZIP 魔数 'PK'
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })
})
