import { describe, expect, it } from 'vitest'
import { cleanTranscript } from './voice'

describe('cleanTranscript', () => {
  it('drops what Whisper says for silence', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('')
    expect(cleanTranscript('Thank you.')).toBe('')
    expect(cleanTranscript('(silence)')).toBe('')
  })
  it('keeps what was said, tidied', () => {
    expect(cleanTranscript('  Fix the login   page [BLANK_AUDIO] ')).toBe('Fix the login page')
    expect(cleanTranscript('Thank you for the review, now add tests.')).toBe('Thank you for the review, now add tests.')
  })
})
