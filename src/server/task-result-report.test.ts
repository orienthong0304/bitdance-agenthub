import { describe, expect, it } from 'vitest'

import type { DispatchPlanItem, TaskResultReport } from '@/shared/types'

import {
  evaluateTaskResultReport,
  isTaskResultReportToolName,
  readTaskResultReportFromToolResult,
} from './task-result-report'

function task(overrides: Partial<DispatchPlanItem> = {}): DispatchPlanItem {
  return {
    id: 't1',
    agentId: 'ag_reviewer',
    task: 'Review the implementation',
    ...overrides,
  }
}

const completeReport: TaskResultReport = {
  status: 'complete',
  summary: 'Reviewed the implementation and found it acceptable.',
  acceptanceResults: [
    {
      criterion: 'Checks PRD alignment',
      passed: true,
      evidence: 'The implementation covers the required PRD scope.',
    },
  ],
}

describe('readTaskResultReportFromToolResult', () => {
  it('parses direct CustomAgent tool results', () => {
    expect(readTaskResultReportFromToolResult(completeReport)).toEqual(completeReport)
  })

  it('parses Claude MCP text content', () => {
    expect(
      readTaskResultReportFromToolResult([
        { type: 'text', text: JSON.stringify(completeReport) },
      ]),
    ).toEqual(completeReport)
  })

  it('parses Codex MCP wrapper results', () => {
    expect(
      readTaskResultReportFromToolResult({
        result: {
          structuredContent: completeReport,
        },
        status: 'completed',
      }),
    ).toEqual(completeReport)
  })
})

describe('isTaskResultReportToolName', () => {
  it('matches direct and MCP-prefixed tool names', () => {
    expect(isTaskResultReportToolName('report_task_result')).toBe(true)
    expect(isTaskResultReportToolName('mcp__agenthub__report_task_result')).toBe(true)
    expect(isTaskResultReportToolName('codex_mcp_agenthub_report_task_result')).toBe(true)
    expect(isTaskResultReportToolName('write_artifact')).toBe(false)
  })
})

describe('evaluateTaskResultReport', () => {
  it('accepts complete reports with matching acceptance criteria', () => {
    expect(
      evaluateTaskResultReport(
        task({ acceptanceCriteria: ['Checks PRD alignment'] }),
        completeReport,
      ),
    ).toEqual({ ok: true })
  })

  it('does not use expectedOutputs as a completion gate', () => {
    expect(
      evaluateTaskResultReport(
        task({ expectedOutputs: [{ id: 'report', type: 'document' }] }),
        {
          status: 'complete',
          summary: 'The review was completed in the final message.',
        },
      ),
    ).toEqual({ ok: true })
  })

  it('fails when a child task omits report_task_result', () => {
    expect(evaluateTaskResultReport(task(), undefined)).toEqual({
      ok: false,
      error: 'Task "t1" completed without report_task_result',
    })
  })

  it('fails when the child reports failed or blocked', () => {
    expect(
      evaluateTaskResultReport(task(), {
        status: 'blocked',
        summary: 'Need missing credentials.',
        blockers: ['Missing API key'],
      }),
    ).toEqual({
      ok: false,
      error: 'Task "t1" reported blocked: Need missing credentials. Blockers: Missing API key',
    })
  })

  it('fails when acceptance criteria are missing or failed', () => {
    expect(
      evaluateTaskResultReport(task({ acceptanceCriteria: ['Checks PRD alignment'] }), {
        status: 'complete',
        summary: 'Done.',
      }),
    ).toEqual({
      ok: false,
      error: 'Task "t1" report is missing acceptance criteria result(s): Checks PRD alignment',
    })

    expect(
      evaluateTaskResultReport(task(), {
        status: 'complete',
        summary: 'Done.',
        acceptanceResults: [
          {
            criterion: 'Checks PRD alignment',
            passed: false,
            evidence: 'The implementation missed the export workflow.',
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error:
        'Task "t1" did not satisfy acceptance criteria: Checks PRD alignment (The implementation missed the export workflow.)',
    })
  })
})
