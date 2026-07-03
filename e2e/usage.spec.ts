import { expect, test } from '@playwright/test'

import { createSingleChat, lastCompleteAgentMsg } from './helpers'

/**
 * 用量成本自算全链路：mock adapter 发 run.usage（model `mock-model`，不入默认价目表）
 * → 主区用量页显示 tokens → mock-model「未定价」→ 行内现填单价 → 成本自算出现
 * → 会话 UsageBadge 弹层的「成本（自算）」行。
 *
 * 注：runsByConv 只由本会话本次 SSE 填（无重放），故成本徽章只在本次创建的会话上可验；
 * 「从分析跳回会话」侧栏导航单独作为 spec scenario 断言（任一按会话行都能回聊天）。
 */
test('用量成本自算：run.usage → 主区用量页 → 行内定价 → 徽章成本行', async ({ page }) => {
  await createSingleChat(page)
  const composer = page.getByTestId('composer-input')
  await composer.fill('你好')
  await composer.press('Enter')

  const msg = lastCompleteAgentMsg(page)
  await expect(msg).toBeVisible({ timeout: 30_000 })

  // run.usage 已落 store：header UsageBadge 出现（runCount>0 才渲染）
  await expect(page.getByTitle('点击查看 token 用量明细')).toBeVisible({ timeout: 15_000 })

  // rail「分析」→ 主区 880px 用量页
  await page.getByRole('button', { name: '分析', exact: true }).click()

  // 总 tokens 卡非零（mock run.usage 聚合进 allTime）
  const totalTokens = page.getByTestId('usage-metric-total-tokens')
  await expect(totalTokens).toBeVisible()
  await expect(totalTokens).toContainText(/[1-9]/)

  // mock-model 未定价（不在 DEFAULT_MODEL_PRICES）
  const costCell = page.getByTestId('usage-model-cost-mock-model')
  await expect(costCell).toContainText('未定价')

  // 行内现填单价 $1 / $2 USD 并保存
  const row = page.getByTestId('usage-model-row-mock-model')
  await row.getByRole('button', { name: '编辑 mock-model 价目' }).click()
  await row.getByLabel('输入单价').fill('1')
  await row.getByLabel('输出单价').fill('2')
  await row.getByLabel('币种').selectOption('USD')
  await row.getByRole('button', { name: '保存' }).click()

  // 成本自算出现：mock-model 行成本 + 总成本卡均转为 $ 金额
  await expect(costCell).not.toContainText('未定价')
  await expect(costCell).toContainText('$')
  await expect(page.getByTestId('usage-metric-total-cost')).toContainText('$')

  // rail「会话」回到本次会话（仍是 active），打开 UsageBadge 断言「成本（自算）」行
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await expect(composer).toBeVisible()
  await page.getByTitle('点击查看 token 用量明细').click()
  await expect(page.getByText('成本（自算）')).toBeVisible()
  // 本会话单 run：1200×$1 + 800×$2 = $0.0028 → 经 formatCost <$0.01 边界呈现
  await expect(page.getByText('<$0.01')).toBeVisible()
  await page.keyboard.press('Escape')

  // 从分析跳回会话（spec scenario）：侧栏按会话行点击后主区恢复聊天视图
  await page.getByRole('button', { name: '分析', exact: true }).click()
  await page.locator('button[title^="点击跳转"]').first().click()
  await expect(page.getByTestId('composer-input')).toBeVisible()
})
