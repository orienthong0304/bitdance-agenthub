import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename } from 'node:path'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { classifyBashApproval, waitForBashApproval } from '@/server/bash-command-approval'
import { db, schema } from '@/db/client'
import { currentPlatform, type Platform } from '@/server/platform'
import { findBannedPattern } from '@/server/security'
import { getEffectiveCwd } from '@/server/workspace-utils'

import type { ToolDef, ToolResult } from './types'

const ArgsSchema = z.object({
  command: z.string().min(1),
})

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 10_000
const POSIX_ORPHANED_STDIO_GRACE_MS = 500
const POSIX_LOGIN_INTERACTIVE_SHELLS = new Set(['bash', 'zsh'])

interface ShellInvocation {
  cmd: string
  args: string[]
}

function readUserInfoShell(): string | null {
  try {
    return userInfo().shell ?? null
  } catch {
    return null
  }
}

function resolvePosixUserShell(): string | null {
  const candidates = [process.env.SHELL, readUserInfoShell()]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('/') && existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function buildPosixShellInvocation(command: string): ShellInvocation {
  const userShell = resolvePosixUserShell()
  if (!userShell) {
    return { cmd: 'sh', args: ['-c', command] }
  }

  const shellName = basename(userShell)
  if (POSIX_LOGIN_INTERACTIVE_SHELLS.has(shellName)) {
    return { cmd: userShell, args: ['-l', '-i', '-c', command] }
  }

  return { cmd: 'sh', args: ['-c', command] }
}

function buildShellInvocation(command: string, platform: Platform): ShellInvocation {
  if (platform === 'windows') {
    // 设置 Console 与 $OutputEncoding 为 UTF-8。比 `chcp 65001` 更彻底——chcp 在
    // PowerShell 初始化输出流之后才生效，导致命令本身的错误信息仍是 GBK。
    const preamble =
      "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();"
    return {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', `${preamble} ${command}`],
    }
  }
  return buildPosixShellInvocation(command)
}

function killProcessTree(
  child: ChildProcess,
  platform: Platform,
  signal: NodeJS.Signals = 'SIGTERM',
) {
  if (platform === 'windows' && typeof child.pid === 'number') {
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true })
    // 极少数 Win 镜像（Server Core 缩减版）没 taskkill.exe，吃 ENOENT 防 unhandled error 崩 worker
    killer.on('error', () => {})
    return
  }
  if (typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : null
      if (code !== 'ESRCH') {
        child.kill(signal)
      }
      return
    }
  }
  child.kill(signal)
}

const PLATFORM = currentPlatform()

const DESCRIPTION_POSIX =
  'Run a shell command inside the workspace (cwd is set automatically). POSIX uses the user login shell for zsh/bash ($SHELL -l -i -c) when available, otherwise sh -c. Use POSIX syntax: ls, grep, cat, git, npm, python, etc. Output is stdout + stderr combined, truncated to 10000 chars, 30s timeout. Destructive commands (rm -rf /, sudo, fork bombs, curl | sh) are blocked. No interactive stdin. Do not leave persistent background servers running; start test servers only inside a command that cleans them up.'

const DESCRIPTION_WINDOWS =
  'Run a Windows PowerShell 5.1 command inside the workspace (cwd is set automatically). ' +
  'CRITICAL: this is Windows, not Linux/macOS. You MUST use PowerShell syntax — POSIX flags like `-la`, `-rf` do not work. ' +
  'Examples of correct commands: `Get-ChildItem -Force` (NOT `ls -la`), `Get-Content file.txt` (NOT `cat`), ' +
  '`Select-String pattern file.txt` (NOT `grep`), `Remove-Item path` (NOT `rm`), `New-Item -ItemType Directory` (NOT `mkdir -p`), ' +
  '`Copy-Item src dst` (NOT `cp`), `Move-Item src dst` (NOT `mv`). git/npm/python/node work as usual. ' +
  'Output is UTF-8, stdout + stderr combined, truncated to 10000 chars, 30s timeout. ' +
  'Destructive commands (Remove-Item -Recurse -Force, format, shutdown, iex(iwr ...), reg delete, Set-ExecutionPolicy Unrestricted) are blocked. No interactive stdin. ' +
  'Do not leave persistent background servers running; start test servers only inside a command that cleans them up.'

/**
 * bash —— 在 workspace 内跑 shell 命令。详见 specs/07-tools.md, specs/11-platform.md。
 *
 * cwd 强制为 workspace effective cwd（local → boundPath，sandbox → rootPath）；
 * 命令前匹配双平台黑名单；30s 超时；stdout + stderr 合并截断 10000 字符。
 * AbortSignal 触发立即 kill 进程树（Windows 走 taskkill /F /T，POSIX 走进程组 SIGTERM）。
 */
export const bashTool: ToolDef = {
  name: 'bash',
  description: PLATFORM === 'windows' ? DESCRIPTION_WINDOWS : DESCRIPTION_POSIX,
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description:
          PLATFORM === 'windows'
            ? 'PowerShell command to execute. cwd is the workspace; do not Set-Location elsewhere.'
            : 'Shell command to execute. cwd is the workspace; do not cd elsewhere.',
      },
    },
  },
  async handler(args, ctx) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `Invalid args: ${parsed.error.message}` }
    }

    const command = parsed.data.command
    const banned = findBannedPattern(command, PLATFORM)
    if (banned) {
      return { ok: false, error: `Command rejected by safety policy: ${banned.source}` }
    }

    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.conversationId, ctx.conversationId),
    })
    if (!workspace) return { ok: false, error: 'Workspace not found' }

    const cwd = getEffectiveCwd(workspace)
    const approval = classifyBashApproval(command, PLATFORM)
    if (approval.required) {
      const approved = await waitForBashApproval({
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        runId: ctx.runId,
        command,
        cwd,
        reason: approval.reason,
        signal: ctx.abortSignal,
      })
      if (!approved) {
        return { ok: false, error: `User rejected command execution: ${approval.reason}` }
      }
    }

    return runShellCommand(command, cwd, PLATFORM, ctx.abortSignal)
  },
}

function runShellCommand(
  command: string,
  cwd: string,
  platform: Platform,
  signal: AbortSignal,
): Promise<ToolResult> {
  const shell = buildShellInvocation(command, platform)

  return new Promise((resolve) => {
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: platform !== 'windows',
    })

    let buffer = ''
    let truncated = false
    let resolved = false
    let timedOut = false
    let aborted = false
    let orphanedStdio = false
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    let orphanedStdioTimer: ReturnType<typeof setTimeout> | null = null
    const append = (chunk: Buffer) => {
      if (truncated) return
      const text = chunk.toString('utf8')
      if (buffer.length + text.length <= MAX_OUTPUT_CHARS) {
        buffer += text
      } else {
        buffer = (buffer + text).slice(0, MAX_OUTPUT_CHARS)
        truncated = true
      }
    }

    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (orphanedStdioTimer) clearTimeout(orphanedStdioTimer)
      signal.removeEventListener('abort', onAbort)
    }

    const finish = (
      exitCode: number | null,
      closeSignal: NodeJS.Signals | null,
    ) => {
      if (resolved) return
      resolved = true
      cleanup()
      const note = timedOut
        ? `\n\n[KILLED after ${TIMEOUT_MS / 1000}s timeout]`
        : aborted
          ? '\n\n[KILLED after run abort]'
          : closeSignal
            ? `\n\n[KILLED by signal ${closeSignal}]`
            : ''
      const orphanNote = orphanedStdio
        ? '\n\n[STOPPED background processes after shell exit to close inherited stdio]'
        : ''
      const truncNote = truncated ? `\n\n[TRUNCATED at ${MAX_OUTPUT_CHARS} chars]` : ''
      resolve({
        ok: true,
        value: {
          cwd,
          command,
          exitCode,
          output: buffer + truncNote + note + orphanNote,
          truncated,
          timedOut,
        },
      })
    }

    const closeInheritedStdio = () => {
      child.stdout?.destroy()
      child.stderr?.destroy()
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true
      killProcessTree(child, platform)
      closeInheritedStdio()
    }, TIMEOUT_MS)

    const onAbort = () => {
      aborted = true
      killProcessTree(child, platform)
      closeInheritedStdio()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    child.on('error', (err) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({
        ok: false,
        error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    })

    child.on('exit', (exitCode, closeSignal) => {
      if (platform === 'windows') return
      orphanedStdioTimer = setTimeout(() => {
        if (resolved) return
        orphanedStdio = true
        killProcessTree(child, platform)
        closeInheritedStdio()
        finish(exitCode ?? null, closeSignal)
      }, POSIX_ORPHANED_STDIO_GRACE_MS)
    })

    child.on('close', (exitCode, closeSignal) => {
      finish(exitCode ?? null, closeSignal)
    })
  })
}
