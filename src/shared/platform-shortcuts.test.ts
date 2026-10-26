import { expect, it } from 'vitest'
import { shortcutModifiers } from './platform-shortcuts'

it('keeps Windows terminal control keys available and uses Ctrl+Shift for app actions', () => {
  expect(shortcutModifiers('c', false, true, false, false, false).active).toBe(false)
  expect(shortcutModifiers('d', false, true, false, false, false).active).toBe(false)
  expect(shortcutModifiers('T', false, true, true, false, false)).toEqual({ active: true, shift: false })
  expect(shortcutModifiers('R', false, true, true, false, false)).toEqual({ active: true, shift: true })
  expect(shortcutModifiers('t', true, false, false, false, true)).toEqual({ active: true, shift: false })
})
