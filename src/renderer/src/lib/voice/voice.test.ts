import { describe, expect, it } from 'vitest'
import { cleanTranscript, voiceCommands } from './voice'

describe('voiceCommands', () => {
  it('"send" at the end presses Enter after', () => {
    expect(voiceCommands('Fix the login page. Send.')).toEqual({ text: 'Fix the login page', send: true, discard: false })
    expect(voiceCommands('Add tests, send it')).toEqual({ text: 'Add tests', send: true, discard: false })
    expect(voiceCommands('Submit!')).toEqual({ text: '', send: true, discard: false })
  })
  it('only at the end', () => {
    expect(voiceCommands('Send the email to the user first.')).toEqual({ text: 'Send the email to the user first.', send: false, discard: false })
  })
  it('turns "new line" and "new paragraph" into line breaks', () => {
    expect(voiceCommands('First thing. New line. Second thing.').text).toBe('First thing\nSecond thing.')
    expect(voiceCommands('Intro, new paragraph, details').text).toBe('Intro\n\ndetails')
  })
  it('"scratch that" at the end drops it all', () => {
    expect(voiceCommands('Delete the database, scratch that.')).toEqual({ text: '', send: false, discard: true })
  })
})

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
