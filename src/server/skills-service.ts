import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db, schema } from '@/db/client'
import { newSkillPackageId } from '@/server/ids'
import type { SkillPackage, SkillSummary } from '@/shared/types'

const execFileAsync = promisify(execFile)

/**
 * Agent Skills 服务 — skill 包的发现 / 导入 / 注册与 per-agent 解析。
 *
 * skill 包以 SDK local plugin 目录形态存放（.claude-plugin/plugin.json + skills/<name>/SKILL.md），
 * builtin 包在只读资源目录，imported 包在 <dataDir>/agent-skills/ 下。
 * 导入只做文件拷贝，绝不执行包内容；skill 引发的命令仍走既有 canUseTool 安全桥。
 * 详见 openspec agent-skills spec 与 specs/05。
 */

// Electron main 注入 AGENTHUB_RESOURCES_DIR；web / dev 走 cwd 兜底（同 Spec 12 dataDir 约定）
const RESOURCES_DIR =
  process.env.AGENTHUB_RESOURCES_DIR ??
  path.resolve(/* turbopackIgnore: true */ process.cwd(), 'resources')
const BUILTIN_SKILLS_DIR = path.join(RESOURCES_DIR, 'agent-skills')

const DATA_DIR =
  process.env.AGENTHUB_DATA_DIR ??
  path.resolve(/* turbopackIgnore: true */ process.cwd(), '.agenthub-data')
const IMPORTED_SKILLS_DIR = path.join(DATA_DIR, 'agent-skills')

const GIT_CLONE_TIMEOUT_MS = 120_000

const FrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, 'skill name must be alphanumeric/dash'),
  description: z.string().min(1).max(4096),
})

/** 解析 SKILL.md frontmatter（仅支持单行 `key: value` 的 YAML 子集，够覆盖官方 skill 格式）。 */
export function parseSkillFrontmatter(
  content: string,
): { name: string; description: string } | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const fields: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields[kv[1]] = value
  }
  const parsed = FrontmatterSchema.safeParse(fields)
  return parsed.success ? parsed.data : null
}

interface DiscoveredSkill {
  summary: Omit<SkillSummary, 'qualifiedName'>
  /** skill 目录绝对路径（含 SKILL.md） */
  dir: string
}

// 在一个源目录里发现 skill：根 SKILL.md（单 skill）→ skills/<name>/SKILL.md → 一级子目录 SKILL.md

export function discoverSkillsInDir(sourceDir: string): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = []
  const tryDir = (dir: string) => {
    const skillMd = path.join(dir, 'SKILL.md')
    if (!fs.existsSync(skillMd)) return
    const parsed = parseSkillFrontmatter(fs.readFileSync(skillMd, 'utf-8'))
    if (parsed) found.push({ summary: parsed, dir })
  }

  tryDir(sourceDir)
  if (found.length > 0) return found

  for (const base of [path.join(sourceDir, 'skills'), sourceDir]) {
    if (!fs.existsSync(base)) continue
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      tryDir(path.join(base, entry.name))
    }
    if (found.length > 0) return found
  }
  return found
}

function toSkillPackage(row: typeof schema.skillPackages.$inferSelect): SkillPackage {
  return { ...row, source: row.source as SkillPackage['source'] }
}

/** 扫描只读资源目录，把 bundled 包 upsert 进注册表（幂等，每次 list 前调用）。 */
async function ensureBuiltinPackages(): Promise<void> {
  if (!fs.existsSync(BUILTIN_SKILLS_DIR)) return
  for (const entry of fs.readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const pkgDir = path.join(BUILTIN_SKILLS_DIR, entry.name)
    const skills = discoverSkillsInDir(pkgDir)
    if (skills.length === 0) continue

    const manifest = readPluginManifest(pkgDir)
    const name = manifest?.name ?? entry.name
    const summaries: SkillSummary[] = skills.map((s) => ({
      ...s.summary,
      qualifiedName: `${name}:${s.summary.name}`,
    }))
    const id = `skpkg_builtin_${entry.name}`
    const existing = await db.query.skillPackages.findFirst({
      where: eq(schema.skillPackages.id, id),
    })
    const row = {
      id,
      name,
      description: manifest?.description ?? `Bundled skill package: ${name}`,
      source: 'builtin' as const,
      sourceRef: entry.name,
      installPath: pkgDir,
      skills: summaries,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    if (existing) {
      await db.update(schema.skillPackages).set(row).where(eq(schema.skillPackages.id, id))
    } else {
      await db.insert(schema.skillPackages).values(row)
    }
  }
}

function readPluginManifest(pkgDir: string): { name?: string; description?: string } | null {
  const manifestPath = path.join(pkgDir, '.claude-plugin', 'plugin.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const parsed = z
      .object({ name: z.string().optional(), description: z.string().optional() })
      .safeParse(raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function listSkillPackages(): Promise<SkillPackage[]> {
  await ensureBuiltinPackages()
  const rows = await db.query.skillPackages.findMany({
    // 'builtin' < 'imported' 字典序，asc 让 builtin 在前
    orderBy: [asc(schema.skillPackages.source), desc(schema.skillPackages.createdAt)],
  })
  return rows.map(toSkillPackage)
}

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/

export interface ImportSkillPackageArgs {
  /** 二选一：GitHub 仓库 HTTPS URL */
  gitUrl?: string
  /** 二选一：本地目录绝对路径 */
  localPath?: string
}

/** 导入 skill 包（install-only：clone / 拷贝 + 校验 + 注册，绝不执行包内容）。 */
export async function importSkillPackage(args: ImportSkillPackageArgs): Promise<SkillPackage> {
  const id = newSkillPackageId()
  const tmpDir = path.join(IMPORTED_SKILLS_DIR, `.tmp-${id}`)
  const installDir = path.join(IMPORTED_SKILLS_DIR, id)

  try {
    let sourceDir: string
    let sourceRef: string
    if (args.gitUrl) {
      const url = args.gitUrl.trim()
      if (!GITHUB_URL_RE.test(url)) {
        throw new Error(`Invalid GitHub repository URL: ${url} (expected https://github.com/<owner>/<repo>)`)
      }
      fs.mkdirSync(tmpDir, { recursive: true })
      try {
        await execFileAsync('git', ['clone', '--depth', '1', '--', url, tmpDir], {
          timeout: GIT_CLONE_TIMEOUT_MS,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`git clone failed for ${url}: ${msg}`)
      }
      sourceDir = tmpDir
      sourceRef = url
    } else if (args.localPath) {
      const p = args.localPath.trim()
      if (!path.isAbsolute(p)) throw new Error(`Local skill path must be absolute: ${p}`)
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
        throw new Error(`Local skill path is not a directory: ${p}`)
      }
      sourceDir = p
      sourceRef = p
    } else {
      throw new Error('Either gitUrl or localPath is required')
    }

    const skills = discoverSkillsInDir(sourceDir)
    if (skills.length === 0) {
      throw new Error(
        'No valid skill found: expected SKILL.md with `name` + `description` frontmatter at the root, under skills/<name>/, or in a first-level subdirectory',
      )
    }

    // 组装成 SDK local plugin 形态：.claude-plugin/plugin.json + skills/<name>/
    const pkgName = derivePackageName(sourceRef)
    fs.mkdirSync(path.join(installDir, '.claude-plugin'), { recursive: true })
    const seen = new Set<string>()
    const summaries: SkillSummary[] = []
    for (const skill of skills) {
      if (seen.has(skill.summary.name)) continue
      seen.add(skill.summary.name)
      fs.cpSync(skill.dir, path.join(installDir, 'skills', skill.summary.name), {
        recursive: true,
        filter: (src) => path.basename(src) !== '.git',
      })
      summaries.push({ ...skill.summary, qualifiedName: `${pkgName}:${skill.summary.name}` })
    }
    fs.writeFileSync(
      path.join(installDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(
        { name: pkgName, description: `Imported skill package from ${sourceRef}`, version: '0.0.0' },
        null,
        2,
      ),
    )

    const row = {
      id,
      name: pkgName,
      description: summaries.map((s) => s.name).join(', '),
      source: 'imported' as const,
      sourceRef,
      installPath: installDir,
      skills: summaries,
      createdAt: Date.now(),
    }
    await db.insert(schema.skillPackages).values(row)
    return toSkillPackage(row)
  } catch (err) {
    // 失败时清掉半成品，不注册 partial 包
    fs.rmSync(installDir, { recursive: true, force: true })
    throw err
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function derivePackageName(sourceRef: string): string {
  const base = sourceRef
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop()
  const cleaned = (base ?? 'skill-package').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return cleaned.replace(/^-+|-+$/g, '') || 'skill-package'
}

export async function deleteSkillPackage(packageId: string): Promise<void> {
  const pkg = await db.query.skillPackages.findFirst({
    where: eq(schema.skillPackages.id, packageId),
  })
  if (!pkg) throw new Error(`Skill package not found: ${packageId}`)
  if (pkg.source === 'builtin') throw new Error('Built-in skill packages cannot be removed')

  await db.delete(schema.skillPackages).where(eq(schema.skillPackages.id, packageId))
  // 只删自己管理的目录，防御 installPath 被外部改动过的情况
  if (pkg.installPath.startsWith(IMPORTED_SKILLS_DIR)) {
    fs.rmSync(pkg.installPath, { recursive: true, force: true })
  }
}

export interface ResolvedAgentSkills {
  /** 传给 SDK options.skills 的启用名单（原样保留 bare / qualified 写法） */
  skills: string[]
  /** 启用 skills 所在包的 plugin 目录（去重；SDK options.plugins） */
  pluginPaths: string[]
}

/** 把 agent.skillNames 解析成 SDK 需要的 skills + plugin 路径。未知名 / 包目录丢失时跳过并告警。 */
export async function resolveAgentSkills(skillNames: string[]): Promise<ResolvedAgentSkills> {
  if (skillNames.length === 0) return { skills: [], pluginPaths: [] }
  const packages = await listSkillPackages()

  const skills: string[] = []
  const pluginPaths = new Set<string>()
  for (const name of skillNames) {
    const pkg = packages.find((p) =>
      p.skills.some((s) => s.name === name || s.qualifiedName === name),
    )
    if (!pkg) {
      console.warn(`[skills-service] enabled skill "${name}" not found in any installed package; skipping`)
      continue
    }
    if (!fs.existsSync(pkg.installPath)) {
      console.warn(`[skills-service] package dir missing for skill "${name}": ${pkg.installPath}; skipping`)
      continue
    }
    skills.push(name)
    pluginPaths.add(pkg.installPath)
  }
  return { skills, pluginPaths: [...pluginPaths] }
}

/** 校验 skillNames 是否全部存在于已安装包（供 agent create/update API 用）。返回未知名列表。 */
export async function findUnknownSkillNames(skillNames: string[]): Promise<string[]> {
  if (skillNames.length === 0) return []
  const packages = await listSkillPackages()
  const known = new Set<string>()
  for (const pkg of packages) {
    for (const s of pkg.skills) {
      known.add(s.name)
      known.add(s.qualifiedName)
    }
  }
  return skillNames.filter((n) => !known.has(n))
}
