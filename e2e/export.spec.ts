import { expect, test, type Page } from '@playwright/test'

const MOCK_AGENT = 'E2E Mock'

async function createSingleChat(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建对话' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button').filter({ hasText: MOCK_AGENT }).first().click()
  await expect(dialog.getByText(/将创建单聊/)).toBeVisible()
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(dialog).toBeHidden()
}

const lastCompleteAgentMsg = (page: Page) =>
  page.locator('[data-role="agent"][data-status="complete"]').last()

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
