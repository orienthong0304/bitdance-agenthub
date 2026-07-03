import { expect, type Page } from '@playwright/test'

export const MOCK_AGENT = 'E2E Mock'

export async function createSingleChat(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建对话' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button').filter({ hasText: MOCK_AGENT }).first().click()
  await expect(dialog.getByText(/将创建单聊/)).toBeVisible()
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(dialog).toBeHidden()
}

export const lastCompleteAgentMsg = (page: Page) =>
  page.locator('[data-role="agent"][data-status="complete"]').last()
