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

test('任务看板：Agent 用 create_task 立单 → 手动建单 → 状态切换', async ({ page }) => {
  await createSingleChat(page)
  const input = page.getByTestId('composer-input')
  await input.fill('帮我记个任务')
  await input.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })
  await expect(msg).toContainText('任务已创建')

  // 实时性证明：不点击任务导航，rail「任务」badge 应经 task.update StreamEvent 立即出现计数
  await expect(page.getByTestId('rail-task-badge')).toHaveText('1', { timeout: 10_000 })

  // 点 rail「任务」打开看板面板
  await page.getByRole('button', { name: '任务', exact: true }).click()

  // Agent 建的任务出现在「待办」分组，带 Agent 来源徽标
  const agentRow = page.getByTitle('Mock 待办事项')
  await expect(agentRow).toBeVisible({ timeout: 10_000 })
  await expect(agentRow).toContainText('Agent')

  // 手动建一条
  const draftInput = page.getByPlaceholder('+ 新任务')
  await draftInput.fill('手动建的任务')
  await draftInput.press('Enter')

  const manualRow = page.getByTitle('手动建的任务')
  await expect(manualRow).toBeVisible({ timeout: 10_000 })
  await expect(manualRow).toContainText('手动')

  // 状态切换：把手动任务从「待办」切到「已完成」
  await manualRow.hover()
  await manualRow.getByLabel('「手动建的任务」状态').selectOption('done')

  const doneGroup = page.getByText('已完成 ·', { exact: false })
  await expect(doneGroup).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTitle('手动建的任务')).toBeVisible()
})
