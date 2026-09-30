import { describe, expect, it } from 'vitest'
import { inputBoxRows } from './inputBox'

const rule = '─'.repeat(40)

describe('claude input box detection', () => {
  it('finds the prompt box above the status line', () => {
    expect(inputBoxRows(['⏺ done', rule, '❯ ', rule, '  ⏵⏵ auto mode on (shift+tab to cycle)'])).toEqual([1, 3])
  })

  it('accepts task text in the top rule and multi-line drafts', () => {
    expect(inputBoxRows(['output', `──── Fix login ${'─'.repeat(20)}`, '❯ first line', '  second line', rule, ''])).toEqual([1, 4])
  })

  it('ignores screens without the prompt box', () => {
    expect(inputBoxRows(['output', rule, ' Do you want to proceed?', ' ❯ 1. Yes', rule])).toBeNull()
    expect(inputBoxRows(['just', 'shell', 'output'])).toBeNull()
  })
})
