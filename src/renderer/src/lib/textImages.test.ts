import { describe, expect, it } from 'vitest'
import { imageRefs, withImagesNote } from './textImages'
import { commentMessage, reviewMessage } from './review'
import type { ReviewComment } from '@shared/types'

describe('images in messages to an agent', () => {
  it('finds the images a text names', () => {
    expect(imageRefs('Wrong colour [image: C:/a/one.png] and [image: /b/two.png], see [image: C:/a/one.png]')).toEqual(['C:/a/one.png', '/b/two.png'])
  })
  it('lists them at the end, to open', () => {
    expect(withImagesNote('Look [image: /x/a.png]')).toBe('Look [image: /x/a.png] Images (open and look at them): /x/a.png')
    expect(withImagesNote('Nothing to see')).toBe('Nothing to see')
  })
  it("in a review comment and a whole review", () => {
    const c = { id: '1', taskId: 't', path: 'app.css', newLine: 4, text: 'This looks wrong [image: /s/shot.png]', ref: 3, createdAt: 0 } as unknown as ReviewComment
    expect(commentMessage(c)).toMatch(/This looks wrong \[image: \/s\/shot\.png\].* Images \(open and look at them\): \/s\/shot\.png$/)
    expect(reviewMessage([c], 'Overall fine [image: /s/two.png]')).toMatch(/Images \(open and look at them\): \/s\/shot\.png, \/s\/two\.png$/)
  })
})
