import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverSkillsInDir, parseSkillFrontmatter } from './skills-service'

describe('parseSkillFrontmatter', () => {
  it('parses name and description', () => {
    expect(
      parseSkillFrontmatter('---\nname: docx\ndescription: Work with Word documents\n---\n# Body'),
    ).toEqual({ name: 'docx', description: 'Work with Word documents' })
  })

  it('strips surrounding quotes from values', () => {
    expect(
      parseSkillFrontmatter('---\nname: pdf\ndescription: "Use this skill for PDFs: read, edit"\n---'),
    ).toEqual({ name: 'pdf', description: 'Use this skill for PDFs: read, edit' })
  })

  it('ignores extra frontmatter fields', () => {
    expect(
      parseSkillFrontmatter('---\nname: docx\ndescription: d\nlicense: Proprietary\n---'),
    ).toEqual({ name: 'docx', description: 'd' })
  })

  it('rejects content without frontmatter', () => {
    expect(parseSkillFrontmatter('# Just a heading')).toBeNull()
  })

  it('rejects frontmatter missing name or description', () => {
    expect(parseSkillFrontmatter('---\nname: docx\n---')).toBeNull()
    expect(parseSkillFrontmatter('---\ndescription: d\n---')).toBeNull()
  })

  it('rejects invalid skill names', () => {
    expect(parseSkillFrontmatter('---\nname: "bad name!"\ndescription: d\n---')).toBeNull()
  })
})

describe('discoverSkillsInDir', () => {
  const tmpDirs: string[] = []
  const makeTmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-skills-test-'))
    tmpDirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  const writeSkill = (dir: string, name: string) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d-${name}\n---\n`)
  }

  it('finds a single root-level skill', () => {
    const dir = makeTmp()
    writeSkill(dir, 'docx')
    const found = discoverSkillsInDir(dir)
    expect(found.map((s) => s.summary.name)).toEqual(['docx'])
    expect(found[0].dir).toBe(dir)
  })

  it('finds skills under skills/<name>/ (repo layout)', () => {
    const dir = makeTmp()
    writeSkill(path.join(dir, 'skills', 'docx'), 'docx')
    writeSkill(path.join(dir, 'skills', 'pdf'), 'pdf')
    const names = discoverSkillsInDir(dir)
      .map((s) => s.summary.name)
      .sort()
    expect(names).toEqual(['docx', 'pdf'])
  })

  it('falls back to first-level subdirectories', () => {
    const dir = makeTmp()
    writeSkill(path.join(dir, 'my-skill'), 'my-skill')
    expect(discoverSkillsInDir(dir).map((s) => s.summary.name)).toEqual(['my-skill'])
  })

  it('skips hidden dirs, node_modules, and invalid SKILL.md', () => {
    const dir = makeTmp()
    writeSkill(path.join(dir, '.git'), 'hidden')
    writeSkill(path.join(dir, 'node_modules', 'x'), 'dep')
    fs.mkdirSync(path.join(dir, 'broken'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'broken', 'SKILL.md'), 'no frontmatter')
    expect(discoverSkillsInDir(dir)).toEqual([])
  })

  it('returns empty for a dir without skills', () => {
    expect(discoverSkillsInDir(makeTmp())).toEqual([])
  })

  it('discovers the bundled anthropics-document-skills package', () => {
    const pkgDir = path.resolve(process.cwd(), 'resources/agent-skills/anthropics-document-skills')
    const found = discoverSkillsInDir(pkgDir)
    expect(found.map((s) => s.summary.name)).toContain('docx')
    expect(found.find((s) => s.summary.name === 'docx')?.summary.description).toMatch(/Word/i)
  })
})
