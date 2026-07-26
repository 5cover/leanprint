import assert from 'node:assert/strict'
import test from 'node:test'
import SourcePrinter, { requiredSeparator } from '../src/ecmascript/SourcePrinter.js'
import { isSymbolToken, isVirtualToken, isWordToken, type Token } from '../src/ecmascript/tokens.js'
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
            lineWrapping: false,
            maxEmptyLines: 1,
            spaceAroundOperators: false,
            spaceAfterControlKeywords: false,
            lineEnding: 'lf',
        }),
        'if(ok)return 1\n'
    )
})
