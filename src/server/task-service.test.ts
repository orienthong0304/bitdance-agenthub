import { describe, expect, it } from 'vitest'

import { mapDispatchStatusToBoard } from './task-service'

describe('mapDispatchStatusToBoard', () => {
  it('maps pending to open', () => {
    expect(mapDispatchStatusToBoard('pending')).toBe('open')
  })

  it('maps running to in_progress', () => {
    expect(mapDispatchStatusToBoard('running')).toBe('in_progress')
  })

  it('maps complete to done', () => {
    expect(mapDispatchStatusToBoard('complete')).toBe('done')
  })

  it('maps failed, aborted, blocked and skipped to blocked', () => {
    expect(mapDispatchStatusToBoard('failed')).toBe('blocked')
    expect(mapDispatchStatusToBoard('aborted')).toBe('blocked')
    expect(mapDispatchStatusToBoard('blocked')).toBe('blocked')
    expect(mapDispatchStatusToBoard('skipped')).toBe('blocked')
  })
})
