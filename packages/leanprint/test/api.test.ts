import assert from 'node:assert/strict'
import test from 'node:test'
import {
    ecmascript,
    format,
    InvalidConfigError,
    registerLanguage,
    UnsupportedLanguageError,
    UnsupportedNodeError,
} from '../src/index.js'
const sample = `export function selectActiveUsers(users:readonly User[]):readonly User[]{if(users.length===0){return [];}return users.filter((user)=>{return user.active&&user.email!==null;});}`
test('formats the documented TypeScript example deterministically', () => {
    const output = format(sample, { filepath: 'example.ts' })
    assert.equal(
        output,
        `export function selectActiveUsers(users:readonly User[]):readonly User[]{\n  if(users.length===0)return []\n  return users.filter(user=>{\n    return user.active&&user.email!==null\n  })\n}\n`
    )
    assert.equal(format(output, { filepath: 'example.ts' }), output)
})
test('uses an explicit, strongly typed language object', () => {
    assert.equal(format('const value = 1;', { language: ecmascript }), 'const value=1\n')
})
test('retains configured semicolons', () => {
    assert.equal(
        format('const value = 1;', { language: ecmascript, filepath: 'x.js', tokens: { semicolons: true } }),
        'const value=1;\n'
    )
})
test('validates options through the language schema without mutating callers', () => {
    const source = { indent: 4 }
    assert.equal(format('if(ok){work()}', { language: ecmascript, filepath: 'x.js', source }), 'if(ok)work()\n')
    assert.deepEqual(source, { indent: 4 })
    assert.throws(
        () => format('work()', { language: ecmascript, filepath: 'x.js', source: { indent: -1 } }),
        InvalidConfigError
    )
})
test('rejects unknown extensions', () => {
    assert.throws(() => format('x', { filepath: 'x.py' }), UnsupportedLanguageError)
})
test('rejects duplicate language identifiers and extension ownership', () => {
    assert.throws(() => {
        registerLanguage(ecmascript)
    }, /already registered/u)
    assert.throws(() => {
        registerLanguage({ ...ecmascript, id: 'duplicate-extension', extensions: Object.freeze(['.JS']) })
    }, /already registered by language/u)
})
test('fails explicitly for unknown AST nodes', () => {
    const ast = ecmascript.parser.parse('value', { sourceType: 'unambiguous', filepath: 'x.js' })
    Object.assign(ast.program.body[0] ?? {}, { type: 'UnknownTestNode' })
    assert.throws(
        () => [...ecmascript.tokenPrinter.print(ast, { ...ecmascript.defaults.tokens, filepath: 'x.js' })],
        UnsupportedNodeError
    )
})
test('protects statement boundaries that begin with brackets', () => {
    const output = format('foo();\n[1].forEach(bar)', { filepath: 'x.js' })
    assert.match(output, /foo\(\);\n\[1\]/)
    assert.doesNotThrow(() => format(output, { filepath: 'x.js' }))
})
test('formats representative JSX and TSX', () => {
    const jsx = format('export const view = <Panel active={ok}> Hello {name} </Panel>;', { filepath: 'view.tsx' })
    assert.equal(jsx, 'export const view=<Panel active={ok}> Hello {name} </Panel>\n')
    assert.equal(format(jsx, { filepath: 'view.tsx' }), jsx)
})
test('formats representative classes', () => {
    const output = format('class Counter { private value: number = 0; increment(): number { return ++this.value; } }', {
        filepath: 'x.ts',
    })
    assert.match(output, /class Counter\{/)
    assert.equal(format(output, { filepath: 'x.ts' }), output)
})
