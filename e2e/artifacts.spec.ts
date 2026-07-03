import { expect, test } from '@playwright/test'

import { createSingleChat, lastCompleteAgentMsg } from './helpers'

test('产物：发「做个网页」→ artifact 卡片 → 预览面板 iframe', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('做个网页')
  await input.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })

  const card = msg.getByRole('button').filter({ hasText: 'Mock 计数器页面' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('web_app · v1')

  await card.click()
  await expect(page.getByTitle('关闭预览')).toBeVisible()
  await expect(page.locator('iframe[title="Artifact preview"]')).toBeVisible()

  await page.getByTitle('关闭预览').click()
  await expect(page.getByTitle('关闭预览')).toBeHidden()
})

test('产物：发「写一份文档」→ document 卡片 → markdown 预览', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('写一份文档')
  await input.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })

  const card = msg.getByRole('button').filter({ hasText: 'Mock 说明文档' })
  await expect(card).toBeVisible()
  await card.click()

  await expect(page.getByTitle('关闭预览')).toBeVisible()
  // markdown 渲染出的 h1 / 列表内容
  await expect(page.getByRole('heading', { name: 'Mock 说明文档' })).toBeVisible()
  await expect(page.getByText('走真实 write_artifact 工具落库')).toBeVisible()
})

test('产物库：创建产物后出现在侧栏产物库并可跳转预览', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('写一份文档')
  await input.press('Enter')
  await expect(lastCompleteAgentMsg(page)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '产物库', exact: true }).click()
  const libraryItem = page.getByText('Mock 说明文档').first()
  await expect(libraryItem).toBeVisible()

  await libraryItem.click()
  await expect(page.getByTitle('关闭预览')).toBeVisible({ timeout: 15_000 })
})
