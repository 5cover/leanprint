import assert from 'node:assert/strict'
import test from 'node:test'
import { format, InvalidConfigError, json, ParseError } from '../src/index.js'

test('formats JSON through extension detection and preserves simple containers inline', () => {
    const source = '{ "a": 1, "b": [ 2, 3 ] }'
    const output = format(source, { filepath: 'fixture.json' })
    assert.equal(output, '{"a":1,"b":[2,3]}\n')
    assert.equal(format(output, { filepath: 'fixture.json' }), output)
})

test('expands containers above the recursive complexity budget', () => {
    const fourProperties = '{"a":1,"b":2,"c":3,"d":4}'
    assert.equal(format(fourProperties, { language: json }), `${fourProperties}\n`)

    const fiveProperties = '{"a":1,"b":2,"c":3,"d":4,"e":5}'
    assert.equal(
        format(fiveProperties, { language: json }),
        '{\n  "a":1,\n  "b":2,\n  "c":3,\n  "d":4,\n  "e":5\n}\n'
    )
    assert.equal(
        format('{"outer":{"a":1,"b":2}}', {
            language: json,
            source: { inlineComplexity: 3, indent: 4, lineEnding: 'crlf' },
        }),
        '{\r\n    "outer":{\r\n        "a":1,\r\n        "b":2\r\n    }\r\n}\r\n'
    )

    const nested = format('{"items":[1,2,3,4,5,6,7,8,9],"meta":{"ok":true}}', { language: json })
    assert.match(nested, /"items":\[\n(?: {4}\d,?\n)+ {2}\]/u)
    assert.match(nested, /"meta":\{"ok":true\}/u)
})

test('canonicalizes safe JSON string escapes without emitting controls or lone surrogates', () => {
    const source = String.raw`{"slash":"\/","letter":"\u00e9","emoji":"\ud83d\ude00","nul":"\u0000","joiner":"\u200d","lone":"\ud800"}`
    assert.equal(
        format(source, { language: json, source: { inlineComplexity: 20 } }),
        '{"slash":"/","letter":"é","emoji":"😀","nul":"\\u0000","joiner":"\\u200D","lone":"\\uD800"}\n'
    )
})

test('preserves duplicate object members and raw numeric spellings', () => {
    const source = '{"n":123456789012345678901234567890,"n":1e+09,"negativeZero":-0}'
    assert.equal(format(source, { language: json, source: { inlineComplexity: 20 } }), `${source}\n`)
})

test('rejects non-JSON syntax with filepath-aware parse errors', () => {
    for (const source of ['{"a":1,}', '{/* comment */"a":1}', '{a:1}', '[01]', 'NaN'])
        assert.throws(() => format(source, { filepath: 'invalid.json' }), ParseError)
})

test('validates JSON rendering options without mutating callers', () => {
    const source = { inlineComplexity: 0 }
    assert.equal(format('[]', { language: json, source }), '[]\n')
    assert.deepEqual(source, { inlineComplexity: 0 })
    assert.throws(
        () => format('{}', { language: json, source: { inlineComplexity: -1 } }),
        InvalidConfigError
    )
})
