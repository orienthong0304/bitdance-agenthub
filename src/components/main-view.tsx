'use client'

import { ChatPanel } from '@/components/chat-panel'
import { UsagePage } from '@/components/usage-page'
import { useAppStore } from '@/stores/app-store'

/**
 * MainView — 主区分支容器（client 边界）。
 *
 * page.tsx 是 server component；rail「分析」激活时主区渲染用量页，否则聊天面板。
 */
export function MainView() {
  const railMode = useAppStore((s) => s.railMode)
  return railMode === 'analytics' ? <UsagePage /> : <ChatPanel />
}
