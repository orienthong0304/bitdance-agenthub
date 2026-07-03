'use client'

import { ChatPanel } from '@/components/chat-panel'
import { UsagePage } from '@/components/usage-page'
import { useAppStore } from '@/stores/app-store'

/**
 * MainView — 主区分支容器（client 边界）。
 *
 * page.tsx 是 server component；rail「分析」激活时主区渲染用量页，否则聊天面板。
 * ChatPanel 只做 CSS 隐藏不卸载：卸载会丢输入框未发草稿等组件态（Task 2 审查 Minor）。
 */
export function MainView() {
  const railMode = useAppStore((s) => s.railMode)
  const analytics = railMode === 'analytics'
  return (
    <>
      <div className={analytics ? 'hidden' : 'contents'}>
        <ChatPanel />
      </div>
      {analytics && <UsagePage />}
    </>
  )
}
