import type { ArtifactContent, ArtifactType, DiffHunk, PptLayout, PptSlide, PptTheme } from '@/shared/types'

/**
 * 把 LLM 或用户给的松散 content 规整成强类型 ArtifactContent;非法返回 null。
 *
 * write_artifact 工具(agent 路径)与 artifact-service.createArtifactVersion(用户面板路径)
 * 共用本函数,保证产物内容的校验/规整是单一来源。
 */
export function buildArtifactContent(type: ArtifactType, rawInput: unknown): ArtifactContent | null {
  // 模型有时把整个 content 对象 JSON.stringify 成字符串(典型 LLM 工具调用毛病),
  // 先保守解包一层:仅当字符串「看起来像被字符串化的 content 包装对象」时才解。
  const raw = unwrapStringifiedContent(rawInput)

  if (type === 'web_app') {
    // 情况 1: 标准 { files, entry }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>

      if (obj.files && typeof obj.files === 'object' && !Array.isArray(obj.files)) {
        const files = obj.files as Record<string, unknown>
        const normalised: Record<string, string> = {}
        for (const [k, v] of Object.entries(files)) {
          if (typeof v === 'string') normalised[k] = v
        }
        if (Object.keys(normalised).length === 0) return null
        return {
          type: 'web_app',
          files: normalised,
          entry: typeof obj.entry === 'string' ? obj.entry : 'index.html',
        }
      }

      // 情况 2: 扁平 { html, css, js }
      if (
        typeof obj.html === 'string' ||
        typeof obj.css === 'string' ||
        typeof obj.js === 'string'
      ) {
        const files: Record<string, string> = {}
        if (typeof obj.html === 'string') files['index.html'] = obj.html
        if (typeof obj.css === 'string') files['style.css'] = obj.css
        if (typeof obj.js === 'string') files['script.js'] = obj.js
        return { type: 'web_app', files, entry: 'index.html' }
      }

      // 情况 3: { content: '<html>...</html>' } 或 { code: '...' }
      if (typeof obj.content === 'string') {
        return {
          type: 'web_app',
          files: { 'index.html': obj.content },
          entry: 'index.html',
        }
      }
      if (typeof obj.code === 'string') {
        return {
          type: 'web_app',
          files: { 'index.html': obj.code },
          entry: 'index.html',
        }
      }
    }

    // 情况 4: 直接传 HTML 字符串
    if (typeof raw === 'string') {
      return { type: 'web_app', files: { 'index.html': raw }, entry: 'index.html' }
    }

    return null
  }

  if (type === 'document') {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.content === 'string') {
        return { type: 'document', format: 'markdown', content: obj.content }
      }
      if (typeof obj.markdown === 'string') {
        return { type: 'document', format: 'markdown', content: obj.markdown }
      }
      if (typeof obj.text === 'string') {
        return { type: 'document', format: 'markdown', content: obj.text }
      }
    }
    if (typeof raw === 'string') {
      return { type: 'document', format: 'markdown', content: raw }
    }
    return null
  }

  if (type === 'image') {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.url === 'string') {
        return {
          type: 'image',
          url: obj.url,
          alt: typeof obj.alt === 'string' ? obj.alt : '',
        }
      }
    }
    if (typeof raw === 'string') {
      return { type: 'image', url: raw, alt: '' }
    }
    return null
  }

  if (type === 'diff') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const obj = raw as Record<string, unknown>
    const targetArtifactId = readString(obj.targetArtifactId) ?? readString(obj.targetId)
    if (!targetArtifactId) return null

    const hunks = Array.isArray(obj.hunks)
      ? normaliseHunks(obj.hunks)
      : parseUnifiedDiff(readString(obj.diff) ?? readString(obj.patch))

    if (hunks.length === 0) return null
    return {
      type: 'diff',
      targetArtifactId,
      hunks,
      applied: typeof obj.applied === 'boolean' ? obj.applied : false,
    }
  }

  if (type === 'code_file') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const obj = raw as Record<string, unknown>
    const workspacePath = readString(obj.workspacePath) ?? readString(obj.path)
    if (!workspacePath) return null
    return {
      type: 'code_file',
      workspacePath,
      language: readString(obj.language) ?? guessLanguage(workspacePath),
      sizeBytes: readNonNegativeNumber(obj.sizeBytes) ?? 0,
      checksum: readString(obj.checksum) ?? '',
    }
  }

  if (type === 'ppt') {
    const obj =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null
    const rawSlides = Array.isArray(raw)
      ? raw
      : Array.isArray(obj?.slides)
        ? (obj!.slides as unknown[])
        : null
    if (!rawSlides) return null

    const slides: PptSlide[] = []
    for (const item of rawSlides) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const s = item as Record<string, unknown>
      const title = readString(s.title) ?? undefined
      let bullets: string[] | undefined
      if (Array.isArray(s.bullets)) {
        bullets = s.bullets.filter((b): b is string => typeof b === 'string')
      } else if (typeof s.bullets === 'string') {
        bullets = s.bullets.split('\n').map((x) => x.trim()).filter(Boolean)
      } else if (Array.isArray(s.points)) {
        bullets = s.points.filter((b): b is string => typeof b === 'string')
      }
      const notes = readString(s.notes) ?? undefined
      const layout = normalisePptLayout(s.layout)
      if (!title && (!bullets || bullets.length === 0)) continue
      slides.push({
        ...(title ? { title } : {}),
        ...(bullets && bullets.length > 0 ? { bullets } : {}),
        ...(notes ? { notes } : {}),
        ...(layout ? { layout } : {}),
      })
    }
    if (slides.length === 0) return null

    const deckTitle = obj ? (readString(obj.title) ?? undefined) : undefined
    const theme = obj ? normalisePptTheme(obj.theme) : undefined
    return {
      type: 'ppt',
      ...(deckTitle ? { title: deckTitle } : {}),
      ...(theme ? { theme } : {}),
      slides,
    }
  }

  return null
}

const CONTENT_WRAPPER_KEYS = [
  'format',
  'content',
  'markdown',
  'text',
  'files',
  'entry',
  'html',
  'css',
  'js',
  'code',
  'url',
  'targetArtifactId',
  'targetId',
  'hunks',
  'diff',
  'patch',
  'workspacePath',
  'path',
  'language',
  'sizeBytes',
  'checksum',
  'slides',
]

/**
 * 若 raw 是「被整个字符串化的 content 包装对象」,解开一层返回该对象;否则原样返回。
 *
 * - 合法 JSON 包装:直接 JSON.parse 解开(常见情形)。
 * - 非法 JSON 但带包装签名(模型转义不干净:`\|` / 未转义引号 / 尾部杂字符):
 *   修非法转义 + 花括号配平截取首个对象后再解析,尽量在写入时救回。
 *
 * 保守门槛:必须 trim 后以 `{` 开头、且解析结果是「含已知 content 键的对象」才采用;
 * 否则原样返回——真 HTML(`<` 开头)、真 markdown(非 `{` 开头)、普通字符串均不受影响。
 */
function unwrapStringifiedContent(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return raw

  // 1) 合法 JSON 包装 → 直接解开
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isWrapperObject(parsed)) return parsed
  } catch {
    // 落到容错分支
  }

  // 2) 非法 JSON 但带包装签名 → 容错救回(修转义 + 配平截取)
  if (hasWrapperSignature(trimmed)) {
    const candidate =
      firstBalancedObject(fixInvalidJsonEscapes(trimmed)) ?? firstBalancedObject(trimmed)
    if (candidate) {
      try {
        const parsed: unknown = JSON.parse(candidate)
        if (isWrapperObject(parsed)) return parsed
      } catch {
        // 放弃,原样返回(落回字面兜底)
      }
    }
  }
  return raw
}

function isWrapperObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    CONTENT_WRAPPER_KEYS.some((k) => k in (v as Record<string, unknown>))
  )
}

/** content 串里出现包装字段名 —— 用于决定是否值得做容错解析(避免误伤正常内容)。 */
function hasWrapperSignature(s: string): boolean {
  return /"(?:format|content|markdown|text|files|entry|html|targetArtifactId|targetId|hunks|diff|patch|workspacePath|path|slides)"\s*:/.test(s)
}

/** 把非法 JSON 转义 `\X`(X ∉ `"\/bfnrtu`)改成合法的 `\\X`,修掉模型常见的 `\|` 等。 */
function fixInvalidJsonEscapes(s: string): string {
  return s.replace(/\\(.)/g, (full, ch: string) => (/["\\/bfnrtu]/.test(ch) ? full : '\\\\' + ch))
}

/** 取首个花括号配平的 `{...}`(正确处理字符串字面与转义),丢弃尾部杂字符。 */
function firstBalancedObject(s: string): string | null {
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function normaliseHunks(rawHunks: unknown[]): DiffHunk[] {
  const out: DiffHunk[] = []
  for (const raw of rawHunks) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const obj = raw as Record<string, unknown>
    const lines = Array.isArray(obj.lines)
      ? obj.lines
          .filter((line): line is string => typeof line === 'string')
          .filter((line) => !isUnifiedDiffMetadataLine(line))
      : []
    if (lines.length === 0) continue
    out.push({
      oldStart: readPositiveNumber(obj.oldStart) ?? 1,
      oldLines: readNonNegativeNumber(obj.oldLines) ?? countHunkLines(lines, '+'),
      newStart: readPositiveNumber(obj.newStart) ?? 1,
      newLines: readNonNegativeNumber(obj.newLines) ?? countHunkLines(lines, '-'),
      lines,
    })
  }
  return out
}

function parseUnifiedDiff(rawDiff: string | null): DiffHunk[] {
  if (!rawDiff) return []
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null

  for (const line of rawDiff.replace(/\r\n/g, '\n').split('\n')) {
    const header = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] ? Number(header[2]) : 1,
        newStart: Number(header[3]),
        newLines: header[4] ? Number(header[4]) : 1,
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('\\ No newline') || isUnifiedDiffMetadataLine(line)) continue
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      current.lines.push(line)
    }
  }

  return hunks.filter((h) => h.lines.length > 0)
}

function countHunkLines(lines: string[], excludedPrefix: '+' | '-'): number {
  return lines.filter((line) => !line.startsWith(excludedPrefix)).length
}

function isUnifiedDiffMetadataLine(line: string): boolean {
  return /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(line)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readNonNegativeNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

function readPositiveNumber(value: unknown): number | null {
  const n = readNonNegativeNumber(value)
  return n && n > 0 ? n : null
}

function guessLanguage(workspacePath: string): string {
  const ext = workspacePath.split('.').pop()?.toLowerCase() ?? ''
  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    md: 'markdown',
    markdown: 'markdown',
    html: 'html',
    css: 'css',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
  }
  return aliases[ext] ?? (ext || 'text')
}

function normalisePptLayout(value: unknown): PptLayout | null {
  const v = readString(value)
  return v === 'title' || v === 'title-bullets' || v === 'section' || v === 'blank' ? v : null
}

function normalisePptTheme(value: unknown): PptTheme | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>
  const primaryColor = readString(obj.primaryColor)?.replace(/^#/, '')
  const fontFace = readString(obj.fontFace) ?? undefined
  if (!primaryColor && !fontFace) return undefined
  return {
    ...(primaryColor ? { primaryColor } : {}),
    ...(fontFace ? { fontFace } : {}),
  }
}
