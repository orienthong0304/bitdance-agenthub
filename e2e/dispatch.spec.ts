import { expect, test, type Page } from '@playwright/test'

const MOCK_AGENT = 'E2E Mock'
const ORCH_AGENT = 'E2E Orchestrator'

async function createGroupChat(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建对话' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button').filter({ hasText: ORCH_AGENT }).first().click()
  await dialog.getByRole('button').filter({ hasText: MOCK_AGENT }).first().click()
  await expect(dialog.getByText(/将创建群聊/)).toBeVisible()
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(dialog).toBeHidden()
}

test('群聊调度：plan 审批 → 子任务执行完成 → 聚合回复', async ({ page }) => {
  await createGroupChat(page)

  const input = page.getByTestId('composer-input')
  await input.fill('请帮大家安排一下这项工作')
  await input.press('Enter')

  // Stage 1: 计划审批卡出现（mock orchestrator 发单任务 plan）
  await expect(page.getByText(/计划待确认/)).toBeVisible({ timeout: 30_000 })

  // 批准执行
  await page.getByRole('button', { name: '执行计划' }).click()

  // Stage 2: 执行卡显示任务全部终态（1 / 1）
  const card = page.locator('div').filter({ hasText: /^任务拆解 · 1 项/ }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 30_000 })

  // Stage 3: 聚合回复完成（最后一条 agent 消息 complete）
  await expect(
    page.locator('[data-role="agent"][data-status="complete"]').last(),
  ).toBeVisible({ timeout: 30_000 })
})
