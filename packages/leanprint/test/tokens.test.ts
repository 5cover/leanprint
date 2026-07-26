import assert from 'node:assert/strict'
import test from 'node:test'
import SourcePrinter from '../src/ecmascript/SourcePrinter.js'
import { requiredSeparator } from '../src/ecmascript/lexical.js'
import { isSymbolToken, isVirtualToken, isWordToken, symbolTokenTypes, type Token } from '../src/ecmascript/tokens.js'
test('classifies typed tokens', () => {
    assert.equal(isWordToken({ type: 'ident', value: 'x' }), true)
    assert.equal(isSymbolToken({ type: '+' }), true)
    assert.equal(isVirtualToken({ type: 'indent' }), true)
})
test('separates unsafe token pairs', () => {
    assert.equal(requiredSeparator({ type: '+' }, { type: '+' }), ' ')
    assert.equal(requiredSeparator({ type: '/' }, { type: '*' }), ' ')
    assert.equal(requiredSeparator({ type: 'ident', value: 'a' }, { type: 'ident', value: 'b' }), ' ')
})
test('separates every symbol pair that would form a longer punctuator', () => {
    for (const left of symbolTokenTypes) {
        for (const right of symbolTokenTypes) {
            const combined = left + right
            const merges = symbolTokenTypes.some(token => token.length > left.length && combined.startsWith(token))
            if (merges) assert.equal(requiredSeparator({ type: left }, { type: right }), ' ', `${left} + ${right}`)
        }
    }
})
test('separates division from a regular-expression literal', () => {
    assert.equal(requiredSeparator({ type: '/' }, { type: 'regex', pattern: 'x', flags: '' }), ' ')
})
test('source printer consumes only tokens', () => {
    const tokens: Token[] = [
        { type: 'if' },
        { type: '(' },
        { type: 'ident', value: 'ok' },
        { type: ')' },
        { type: 'return' },
        { type: 'number-literal', value: '1' },
        { type: 'statement-boundary', mode: 'normal' },
    ]
    assert.equal(
        new SourcePrinter().print(tokens, {
            indent: 2,
            spaceAroundOperators: false,
            spaceAfterControlKeywords: false,
            lineEnding: 'lf',
        }),
        'if(ok)return 1\n'
    )
})
