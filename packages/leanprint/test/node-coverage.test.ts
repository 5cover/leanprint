import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as babelTypes from '@babel/types'

test('TokenPrinter has explicit dispatch branches for Babel standardized, TypeScript, and JSX nodes', async () => {
    const source = await readFile(new URL('../src/ecmascript/TokenPrinter.ts', import.meta.url), 'utf8')
    const covered = new Set([...source.matchAll(/case '([^']+)'/gu)].map(match => match[1]))
    const aliases = ['Standardized', 'TypeScript', 'JSX']
    const expected = new Set(aliases.flatMap(alias => babelTypes.FLIPPED_ALIAS_KEYS[alias] ?? []))
    assert.deepEqual([...expected].filter(nodeType => !covered.has(nodeType)).sort(), [])
})
