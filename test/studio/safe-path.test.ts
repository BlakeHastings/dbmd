import { describe, expect, it } from 'vitest'
import { isAbsolute, join, sep } from 'node:path'
import { isSafeSegment, resolveWithin } from '../../src/studio/safe-path.js'

/**
 * The studio writes files a web page asked it to write, so these are the two
 * checks that stand between a table name and somebody's `~/.ssh/authorized_keys`.
 * They are tested here separately from the server because a refusal that only
 * exists at the routing layer is one route away from not existing.
 */

const ROOT = join(process.cwd(), 'db-model')

describe('isSafeSegment', () => {
  it('accepts the names a table actually has', () => {
    for (const name of ['orders', 'order_items', 'Orders', 'a', 'v2.orders', 'naïve']) {
      expect(isSafeSegment(name), name).toBe(true)
    }
  })

  it('refuses anything that is not one path segment', () => {
    for (const name of [
      '',
      '.',
      '..',
      '../../etc/x',
      '..\\..\\etc\\x',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'C:/Windows/System32/x',
      'stream:name',
    ]) {
      expect(isSafeSegment(name), name).toBe(false)
    }
  })

  it('refuses names Windows would quietly turn into something else', () => {
    // A trailing dot or space is stripped by the filesystem, so `orders ` and
    // `orders` become one file and a rename becomes an overwrite.
    for (const name of ['orders.', 'orders ', 'nul', 'NUL.md', 'con', 'lpt1', 'aux']) {
      expect(isSafeSegment(name), name).toBe(false)
    }
  })

  it('refuses a name carrying a control character', () => {
    expect(isSafeSegment(`orders${String.fromCharCode(0)}.md`)).toBe(false)
    expect(isSafeSegment(`orders${String.fromCharCode(10)}`)).toBe(false)
  })
})

describe('resolveWithin', () => {
  it('resolves a name inside the root to a path inside the root', () => {
    const target = resolveWithin(ROOT, 'tables', 'orders.md')
    expect(target).toBe(join(ROOT, 'tables', 'orders.md'))
  })

  it('refuses a traversal even though `isSafeSegment` would have caught it first', () => {
    // Called directly, with the name check bypassed, because that is the point
    // of having two: this one is the check that asks where the file really is.
    expect(resolveWithin(ROOT, 'tables', '../../etc/x.md')).toBeUndefined()
    expect(resolveWithin(ROOT, '..', 'x.md')).toBeUndefined()
    expect(resolveWithin(ROOT, `..${sep}x.md`)).toBeUndefined()
  })

  it('refuses an absolute path, which no amount of joining makes relative', () => {
    expect(resolveWithin(ROOT, 'tables', join(process.cwd(), 'x.md'))).toBeUndefined()
    if (process.platform === 'win32') expect(resolveWithin(ROOT, 'D:\\x.md')).toBeUndefined()
    else expect(resolveWithin(ROOT, '/etc/passwd')).toBeUndefined()
  })

  it('refuses the root itself, since a caller always wants a file in it', () => {
    expect(resolveWithin(ROOT, '.')).toBeUndefined()
    expect(resolveWithin(ROOT)).toBeUndefined()
  })

  it('lets a name climb back to where it started, which is still inside', () => {
    const target = resolveWithin(ROOT, 'tables', '..', 'notes', 'why.md')
    expect(target).toBe(join(ROOT, 'notes', 'why.md'))
    expect(isAbsolute(target as string)).toBe(true)
  })
})
