import { describe, expect, it } from 'vitest'
import { xmlEscape } from './atom.ts'

describe('xmlEscape', () => {
  it('escapes markup and both quote marks', () => {
    expect(xmlEscape(`<a href="x">Tom & 'Jo'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jo&apos;&lt;/a&gt;')
  })

  it('drops characters XML 1.0 cannot hold and keeps tab, newline and paired surrogates', () => {
    expect(xmlEscape('a\u0000b\u0007c￾d\tline\nnext')).toBe('abcd\tline\nnext')
    expect(xmlEscape('lone \uD800 high, lone \uDC00 low, pair 😀')).toBe('lone  high, lone  low, pair 😀')
  })
})
