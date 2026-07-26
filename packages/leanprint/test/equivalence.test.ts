import assert from 'node:assert/strict'
import test from 'node:test'
import { ecmascript, format } from '../src/index.js'

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(
                ([key]) =>
                    ![
                        'start',
                        'end',
                        'loc',
                        'extra',
                        'errors',
                        'leadingComments',
                        'innerComments',
                        'trailingComments',
                    ].includes(key)
            )
            .map(([key, child]) => [key, normalize(child)])
    )
}

function assertEquivalent(source: string, filepath: string): void {
    const output = format(source, { filepath })
    const config = { ...ecmascript.defaults.parser, filepath }
    assert.deepEqual(
        normalize(ecmascript.parser.parse(output, config)),
        normalize(ecmascript.parser.parse(source, config))
    )
    assert.equal(format(output, { filepath }), output)
}

const javascriptFixtures = [
    `'use strict';for(let index=0;index<3;index++){if(index===1)continue;work(index)}`,
    `label:for(const value of values){if(value)break label}`,
    `switch(value){case 1:one();break;case 2:caseTwo();default:other()}`,
    `try{work()}catch(error){handle(error)}finally{cleanup()}`,
    `const {value:renamed,...rest}=input;const [first,,third]=items`,
    `export * from "./all.js";export {value as renamed} from "./value.js" with {type:"json"}`,
    `const meta=import.meta;const loaded=import("./module.js")`,
    `class Example extends Base{static count=0;#value=1;static{this.count++}get value(){return this.#value}}`,
    `class Generated{field=build();*values(){yield this.field}}`,
    `@sealed class Decorated{@logged method(value){return value}}`,
    `using resource=open();async function work(){await using connection=connect()}`,
]

for (const [index, fixture] of javascriptFixtures.entries()) {
    test(`preserves JavaScript fixture ${index + 1}`, () => assertEquivalent(fixture, 'fixture.js'))
}

const precedenceFixtures = [
    `const value=(a+b)*c`,
    `const value=a*(b+c)`,
    `const value=a+(b+c)`,
    `const value=(a**b)**c`,
    `const value=a**(b**c)`,
    `const value=(a??b)||c`,
    `const value=a??(b&&c)`,
    `const value=(a?b:c)?d:e`,
    `const value=(a=b)?c:d`,
    `const value=x=>(a,b)`,
    `const values=[(a,b),c];call((a,b),c);const object={value:(a,b)}`,
]

for (const [index, fixture] of precedenceFixtures.entries()) {
    test(`preserves precedence fixture ${index + 1}`, () => assertEquivalent(fixture, 'precedence.js'))
}

test('preserves every pair of binary operator precedence levels', () => {
    const operators = [
        '||',
        '??',
        '&&',
        '|',
        '^',
        '&',
        '==',
        '!=',
        '===',
        '!==',
        '<',
        '<=',
        '>',
        '>=',
        'in',
        'instanceof',
        '<<',
        '>>',
        '>>>',
        '+',
        '-',
        '*',
        '/',
        '%',
        '**',
    ]
    for (const parent of operators) {
        for (const child of operators) {
            assertEquivalent(`const left=(a ${child} b) ${parent} c`, 'operators.js')
            assertEquivalent(`const right=a ${parent} (b ${child} c)`, 'operators.js')
        }
    }
})

test('preserves grammar-sensitive call, member, new, and exponentiation operands', () => {
    for (const fixture of [
        `const value=(condition?left:right).property`,
        `const value=(condition?left:right)()`,
        `const value=new (factory())()`,
        `const value=(-operand)**power`,
        `const value=(await operand)**power`,
    ])
        assertEquivalent(`async function check(){${fixture}}`, 'grammar.js')
})

test('does not assemble legacy HTML comments from expression tokens', () => {
    assertEquivalent('a < ! --b', 'legacy-comment.js')
    assert.notEqual(format('a < ! --b', { filepath: 'legacy-comment.js' }).trim(), 'a<!--b')
})

const typescriptFixtures = [
    `type Pair<T extends object={}>=[first:T,second?:T,...rest:T[]]`,
    `type Result<T>=T extends string?{readonly [K in keyof T as \`x${'${K & string}'}\`]?:T[K]}:never`,
    `type Factory=abstract new<T>(value:T)=>T`,
    `interface Service<T>{readonly [key:string]:T;get value():T;method?<U>(value:U):value is U;new():Service<T>}`,
    `const value=<Result<string>>input;const checked=input satisfies Result<string>;const fn=identity<string>`,
    `const enum Direction{Up=1,Down}namespace Tools{export type Value=string}`,
    `import Alias=require("alias");export=Alias`,
    `type Lazy=import("./types",{with:{type:"json"}}).Value<string>`,
    `namespace Outer.Inner{export interface Value{item:string}}`,
    `declare function parse<const T>(value:unknown):asserts value is T`,
    `abstract class Service{abstract method<T>(value:T):T;constructor(public readonly value:string){} accessor?:string}`,
    `type Query=typeof import("./types").value;type Indexed<T>=T[keyof T];type Inferred<T>=T extends infer U?U:never`,
    `import value,{type Kind as OtherKind,named as renamed} from "pkg" with {type:"json"};import * as ns from "other"`,
]

for (const [index, fixture] of typescriptFixtures.entries()) {
    test(`preserves TypeScript fixture ${index + 1}`, () => assertEquivalent(fixture, 'fixture.ts'))
}

test('preserves comment text and order', () => {
    const source = `/* license */\nconst first=1 // trailing\n// leading\nconst second=/* inline */2`
    const output = format(source, { filepath: 'comments.js' })
    const comments = [...output.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu)].map(match => match[0])
    assert.deepEqual(comments, ['/* license */', '// trailing', '// leading', '/* inline */'])
    assert.equal(format(output, { filepath: 'comments.js' }), output)
})

test('preserves advanced JSX', () => {
    assertEquivalent(`const view=<><Panel data-id="value" {...props}>{condition?<A/>:<B/>}</Panel></>`, 'fixture.jsx')
})

test('preserves significant JSX spaces while removing indentation-only whitespace', () => {
    const inline = format(`const view=<p>Hello {name} world</p>`, { filepath: 'fixture.jsx' })
    assert.match(inline, /<p>Hello \{name\} world<\/p>/u)
    const multiline = format(`const view=<p>\n  Hello\n  world\n</p>`, { filepath: 'fixture.jsx' })
    assert.match(multiline, /<p>Hello world<\/p>/u)
})

test('preserves comments inside empty delimiters', () => {
    const source = `const array=[/* array */];const object={/* object */};function empty(){/* block */}`
    const output = format(source, { filepath: 'comments.js' })
    assert.match(output, /\/\* array \*\//u)
    assert.match(output, /\/\* object \*\//u)
    assert.match(output, /\/\* block \*\//u)
})
