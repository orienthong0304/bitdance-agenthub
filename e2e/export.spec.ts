import { expect, test } from '@playwright/test'

import { createSingleChat, lastCompleteAgentMsg } from './helpers'

test('导出：发「做个幻灯片」→ ppt 产物卡 → 预览面板 → 下载按钮产出 .pptx', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('做个幻灯片')
  await input.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })

  const card = msg.getByRole('button').filter({ hasText: 'Mock 演示文稿' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('ppt · v1')

  await card.click()
  await expect(page.getByTitle('关闭预览')).toBeVisible()

  const downloadButton = page.getByTitle(/下载/)
  await expect(downloadButton).toBeVisible()

  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()])
  expect(download.suggestedFilename()).toMatch(/\.pptx$/)
})
