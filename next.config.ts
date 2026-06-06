import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Electron 打包用：生成 .next/standalone 自包含 server（详见 Spec 12 §2 / §6）
  output: 'standalone',

  // 不让 webpack bundle native / SDK 依赖；运行时走 require/import，保留 native binding 与子进程能力
  serverExternalPackages: [
    'better-sqlite3',
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex-sdk',
    '@openai/codex',
    '@modelcontextprotocol/sdk',
    'pptxgenjs',
  ],

  outputFileTracingIncludes: {
    '/*': ['scripts/agenthub-codex-mcp.mjs'],
  },

  outputFileTracingExcludes: {
    '/*': [
      '.agenthub-data/**',
      '.claude/**',
      '.git/**',
      '.understand-anything/**',
      '*.md',
      '*.txt',
      'components.json',
      'drizzle.config.ts',
      'eslint.config.mjs',
      'apps/**',
      'dist-electron/**',
      'electron/**',
      'next.config.ts',
      'openspec/**',
      'packages/**',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'postcss.config.mjs',
      'public/**',
      'release/**',
      'scripts/electron-*.mjs',
      'scripts/run-electron-node.mjs',
      'skills/**',
      'specs/**',
      'src/**',
      'tsconfig*.json',
      'tsconfig.tsbuildinfo',
    ],
  },
}

export default nextConfig
