import { expect, test } from '@playwright/test'

import { createSingleChat, lastCompleteAgentMsg } from './helpers'

test('单聊：发「你好」→ mock 流式回复 → 完成', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('你好')
  await input.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })
  await expect(msg).toContainText('我是 Mock Agent')
})

test('单聊：发「写代码」→ 回复含代码块', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('写代码')
  await input.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })
  await expect(msg).toContainText('React 计数器')
  await expect(msg.locator('pre')).toBeVisible()
})

test('单聊：重新生成最后一条回复', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('你好')
  await input.press('Enter')
  await expect(lastCompleteAgentMsg(page)).toBeVisible({ timeout: 30_000 })

  const msg = lastCompleteAgentMsg(page)
  await msg.hover()
  await msg.getByTitle(/重新生成/).click()

  await expect(lastCompleteAgentMsg(page)).toContainText('我是 Mock Agent', { timeout: 30_000 })
})
