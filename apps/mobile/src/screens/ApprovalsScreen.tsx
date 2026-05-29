import { useState } from 'react'

import type { MobileAskUserAnswers, MobilePendingQuestion, MobileSnapshot } from '../types'

export function ApprovalsScreen({
  connected,
  busyId,
  snapshot,
  onWriteDecision,
  onQuestionAnswer,
}: {
  connected: boolean
  busyId: string | null
  snapshot: MobileSnapshot | null
  onWriteDecision: (id: string, action: 'approve' | 'reject') => void
  onQuestionAnswer: (id: string, answers: MobileAskUserAnswers) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, MobileAskUserAnswers>>({})

  if (!connected) {
    return <div className="empty-state">先在设置中配对桌面端。</div>
  }

  const writes = snapshot?.pendingWrites ?? []
  const questions = snapshot?.pendingQuestions ?? []

  return (
    <div className="screen-stack">
      <section className="card-list">
        <h2 className="section-title">文件修改审批</h2>
        {writes.length > 0 ? (
          writes.map((write) => (
            <article key={write.id} className="approval-card">
              <div>
                <h3>{write.path}</h3>
                <p>
                  {write.oldContent === null ? '新建文件' : '修改文件'} · {formatTime(write.createdAt)}
                </p>
              </div>
              <details className="content-preview">
                <summary>查看内容</summary>
                {write.oldContent !== null && (
                  <>
                    <div className="preview-label">原内容</div>
                    <pre>{write.oldContent}</pre>
                  </>
                )}
                <div className="preview-label">新内容</div>
                <pre>{write.newContent}</pre>
              </details>
              <div className="approval-actions">
                <button
                  type="button"
                  className="danger-action"
                  disabled={busyId === write.id}
                  onClick={() => onWriteDecision(write.id, 'reject')}
                >
                  {busyId === write.id ? '处理中' : '拒绝'}
                </button>
                <button
                  type="button"
                  className="primary-action small"
                  disabled={busyId === write.id}
                  onClick={() => onWriteDecision(write.id, 'approve')}
                >
                  {busyId === write.id ? '处理中' : '批准'}
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">暂无待审批文件修改。</div>
        )}
      </section>

      <section className="card-list">
        <h2 className="section-title">Agent 提问</h2>
        {questions.length > 0 ? (
          questions.map((item) => {
            const draft = drafts[item.id] ?? emptyAnswers(item)
            const canSubmit = item.questions.every((question) => {
              const answer = draft[question.question]
              return answer && answer.selectedLabels.length > 0
            })

            return (
              <article key={item.id} className="approval-card">
                <div>
                  <h3>{item.questions[0]?.header ?? '待回答问题'}</h3>
                  <p>{item.questions[0]?.question ?? 'Agent 正在等待用户选择。'}</p>
                </div>

                {item.questions.map((question) => (
                  <div key={question.question} className="question-block">
                    <div className="question-title">{question.header}</div>
                    <p>{question.question}</p>
                    <div className="option-grid">
                      {question.options.map((option) => {
                        const selected = draft[question.question]?.selectedLabels.includes(option.label)
                        return (
                          <button
                            key={option.label}
                            type="button"
                            className={selected ? 'option-button selected' : 'option-button'}
                            onClick={() =>
                              setDrafts((prev) => ({
                                ...prev,
                                [item.id]: toggleOption(draft, question.question, option.label, !!question.multiSelect),
                              }))
                            }
                          >
                            <span>{option.label}</span>
                            {option.description && <small>{option.description}</small>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="primary-action full"
                  disabled={!canSubmit || busyId === item.id}
                  onClick={() => onQuestionAnswer(item.id, draft)}
                >
                  {busyId === item.id ? '提交中' : '提交回答'}
                </button>
              </article>
            )
          })
        ) : (
          <div className="empty-state">暂无待回答问题。</div>
        )}
      </section>
    </div>
  )
}

function emptyAnswers(item: MobilePendingQuestion): MobileAskUserAnswers {
  return Object.fromEntries(
    item.questions.map((question) => [question.question, { selectedLabels: [] }]),
  )
}

function toggleOption(
  current: MobileAskUserAnswers,
  question: string,
  label: string,
  multiSelect: boolean,
): MobileAskUserAnswers {
  const answer = current[question] ?? { selectedLabels: [] }
  const exists = answer.selectedLabels.includes(label)
  const selectedLabels = multiSelect
    ? exists
      ? answer.selectedLabels.filter((item) => item !== label)
      : [...answer.selectedLabels, label]
    : [label]

  return {
    ...current,
    [question]: {
      ...answer,
      selectedLabels,
    },
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
