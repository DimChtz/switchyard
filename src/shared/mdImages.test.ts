import { describe, expect, it } from 'vitest'
import { forAgent, localImages } from './mdImages'

describe('pictures in Markdown, for an agent', () => {
  it('finds the local ones - encoded, file: links, not web ones', () => {
    const md = 'A ![shot](C:/Users/Me%20Too/attachments/a.png) and ![](file:///Users/me/b.png) and ![web](https://x.io/c.png)'
    expect(localImages(md)).toEqual(['C:/Users/Me Too/attachments/a.png', '/Users/me/b.png'])
  })
  it('names them by their file, and lists them to open', () => {
    const out = forAgent('The button:\n![misaligned](/Users/me/s.png)\nFix it.')
    expect(out).toBe('The button:\n[image: misaligned - /Users/me/s.png]\nFix it.\n\nImages (open and look at them): /Users/me/s.png')
    expect(forAgent('No pictures here.')).toBe('No pictures here.')
  })
})

describe("the agent's first message", () => {
  it('gets the pictures of the description as files to open', async () => {
    const { firstMessage } = await import('./constants')
    const msg = firstMessage('{key}: {desc}', { key: 'SYT-1', title: 't', desc: 'Fix it ![shot](/tmp/a.png) - costs $5' }, 'b')
    expect(msg).toBe('SYT-1: Fix it [image: shot - /tmp/a.png] - costs $5\n\nImages (open and look at them): /tmp/a.png')
  })
})
