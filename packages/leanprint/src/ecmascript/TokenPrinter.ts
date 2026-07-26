import * as t from '@babel/types'
import { UnsupportedNodeError } from '../errors.js'
import { needsParentheses, type ExpressionPosition } from './parentheses.js'
import type { EcmascriptTokenConfig } from './types.js'
import type { FixedTokenType, Token } from './tokens.js'
type Ctx = { parent?: t.Node; position?: ExpressionPosition }
function cleanJsxText(value: string): string {
    const lines = value.split(/\r\n|\n|\r/u)
    let lastNonEmptyLine = 0
    for (let index = 0; index < lines.length; index++) {
        if (/[^ \t]/u.test(lines[index]!)) lastNonEmptyLine = index
    }
    let result = ''
    for (let index = 0; index < lines.length; index++) {
        let line = lines[index]!.replace(/\t/gu, ' ')
        if (index !== 0) line = line.replace(/^ +/u, '')
        if (index !== lines.length - 1) line = line.replace(/ +$/u, '')
        if (line) {
            if (index !== lastNonEmptyLine) line += ' '
            result += line
        }
    }
    return result
}
export default class TokenPrinter {
    print(file: t.File, config: EcmascriptTokenConfig): Iterable<Token> {
        return new TokenPrintSession(config).print(file)
    }
}

class TokenPrintSession {
    private readonly emittedComments = new Set<string>()

    constructor(private readonly config: EcmascriptTokenConfig) {}

    *print(file: t.File): Iterable<Token> {
        if (file.program.interpreter) yield { type: 'shebang', value: file.program.interpreter.value }
        yield* this.node(file.program, {})
    }
    private fixed(value: FixedTokenType): Token {
        return { type: value }
    }
    private *list(nodes: readonly (t.Node | null)[], separator: FixedTokenType = ','): Iterable<Token> {
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i]
            if (n) yield* this.node(n, {})
            if (i < nodes.length - 1) yield this.fixed(separator)
        }
    }
    private *expressionList(nodes: readonly (t.Node | null)[], parent: t.Node): Iterable<Token> {
        for (let index = 0; index < nodes.length; index++) {
            const element = nodes[index]
            if (element) {
                if (t.isExpression(element)) yield* this.expr(element, parent, 'argument')
                else yield* this.node(element, {})
            }
            if (index < nodes.length - 1) yield this.fixed(',')
        }
    }
    private *arrayElements(
        nodes: readonly (t.Node | null)[],
        parent: t.ArrayExpression | t.ArrayPattern
    ): Iterable<Token> {
        for (let index = 0; index < nodes.length; index++) {
            const element = nodes[index]
            if (element) {
                if (parent.type === 'ArrayExpression' && t.isExpression(element))
                    yield* this.expr(element, parent, 'argument')
                else yield* this.node(element, {})
            }
            if (index < nodes.length - 1 || element === null) yield this.fixed(',')
        }
    }
    private *comments(comments: t.Comment[] | null | undefined): Iterable<Token> {
        for (const comment of comments ?? []) {
            const key = `${String(comment.start)}:${String(comment.end)}:${comment.value}`
            if (this.emittedComments.has(key)) continue
            this.emittedComments.add(key)
            yield {
                type: 'comment',
                kind: comment.type === 'CommentLine' ? 'line' : 'block',
                value: comment.value,
            }
        }
    }
    private *expr(node: t.Expression, parent: t.Node, position: ExpressionPosition): Iterable<Token> {
        const parens = needsParentheses(node, parent, position)
        if (parens) yield this.fixed('(')
        yield* this.node(node, { parent, position })
        if (parens) yield this.fixed(')')
    }
    private *block(node: t.BlockStatement): Iterable<Token> {
        yield* this.comments(node.leadingComments)
        yield this.fixed('{')
        yield* this.comments(node.innerComments)
        if (node.directives.length || node.body.length || node.innerComments?.length) {
            yield { type: 'line', kind: 'hard' }
            yield { type: 'indent' }
            for (const directive of node.directives) yield* this.node(directive, {})
            for (const s of node.body) yield* this.node(s, {})
            yield { type: 'dedent' }
        }
        yield this.fixed('}')
        yield* this.comments(node.trailingComments)
    }
    private canCollapse(node: t.Statement): boolean {
        return (
            this.config.collapseSingleStatementBlocks &&
            node.type === 'BlockStatement' &&
            node.body.length === 1 &&
            [
                'ExpressionStatement',
                'ReturnStatement',
                'ThrowStatement',
                'BreakStatement',
                'ContinueStatement',
            ].includes(node.body[0]!.type) &&
            !node.body[0]!.leadingComments?.length
        )
    }
    private *body(node: t.Statement): Iterable<Token> {
        if (this.canCollapse(node)) yield* this.node((node as t.BlockStatement).body[0]!, {})
        else yield* this.node(node, {})
    }
    private *node(node: t.Node, ctx: Ctx): Iterable<Token> {
        yield* this.comments(node.leadingComments)
        if ('decorators' in node && Array.isArray(node.decorators)) {
            for (const decorator of node.decorators) yield* this.node(decorator, {})
        }
        yield* this.nodeContent(node, ctx)
        yield* this.comments(node.trailingComments)
    }
    private *nodeContent(node: t.Node, _ctx: Ctx): Iterable<Token> {
        switch (node.type) {
            case 'File':
                yield* this.node(node.program, {})
                return
            case 'InterpreterDirective':
                yield { type: 'shebang', value: node.value }
                return
            case 'Decorator':
                yield this.fixed('@')
                yield* this.node(node.expression, {})
                yield { type: 'line', kind: 'hard' }
                return
            case 'Program':
                for (const directive of node.directives) yield* this.node(directive, {})
                for (const s of node.body) yield* this.node(s, {})
                return
            case 'Directive':
                yield* this.node(node.value, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'DirectiveLiteral':
                yield { type: 'string-literal', value: JSON.stringify(node.value) }
                return
            case 'Identifier':
                yield { type: 'ident', value: node.name }
                if (node.optional) yield this.fixed('?')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'PrivateName':
                yield { type: 'private-ident', value: (node.id as t.Identifier).name }
                return
            case 'StringLiteral':
                yield { type: 'string-literal', value: JSON.stringify(node.value) }
                return
            case 'NumericLiteral':
                yield { type: 'number-literal', value: Number.isFinite(node.value) ? String(node.value) : '1e999' }
                return
            case 'BigIntLiteral':
                yield { type: 'bigint-literal', value: `${node.value}n` }
                return
            case 'BooleanLiteral':
                yield this.fixed(node.value ? 'true' : 'false')
                return
            case 'NullLiteral':
                yield this.fixed('null')
                return
            case 'RegExpLiteral':
                yield { type: 'regex', pattern: node.pattern, flags: node.flags }
                return
            case 'ExpressionStatement':
                yield* this.expr(node.expression, node, 'other')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'BlockStatement':
                yield* this.block(node)
                return
            case 'EmptyStatement':
                yield { type: 'statement-boundary', mode: 'required' }
                return
            case 'VariableDeclaration':
                if (node.kind === 'await using') {
                    yield this.fixed('await')
                    yield this.fixed('using')
                } else yield this.fixed(node.kind)
                for (let i = 0; i < node.declarations.length; i++) {
                    if (i) yield this.fixed(',')
                    yield* this.node(node.declarations[i]!, {})
                }
                if (!['ForStatement', 'ForInStatement', 'ForOfStatement'].includes(_ctx.parent?.type ?? ''))
                    yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'VariableDeclarator':
                yield* this.node(node.id, {})
                if (node.init) {
                    yield this.fixed('=')
                    yield* this.expr(node.init, node, 'right')
                }
                return
            case 'ReturnStatement':
                yield this.fixed('return')
                if (node.argument) yield* this.expr(node.argument, node, 'argument')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ThrowStatement':
                yield this.fixed('throw')
                yield* this.expr(node.argument, node, 'argument')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'BreakStatement':
                yield this.fixed('break')
                if (node.label) yield* this.node(node.label, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ContinueStatement':
                yield this.fixed('continue')
                if (node.label) yield* this.node(node.label, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'DebuggerStatement':
                yield this.fixed('debugger')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'LabeledStatement':
                yield* this.node(node.label, {})
                yield this.fixed(':')
                yield* this.node(node.body, {})
                return
            case 'WithStatement':
                yield this.fixed('with')
                yield this.fixed('(')
                yield* this.expr(node.object, node, 'test')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'SwitchStatement':
                yield this.fixed('switch')
                yield this.fixed('(')
                yield* this.expr(node.discriminant, node, 'test')
                yield this.fixed(')')
                yield this.fixed('{')
                if (node.cases.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const switchCase of node.cases) yield* this.node(switchCase, {})
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                yield { type: 'line', kind: 'hard' }
                return
            case 'SwitchCase':
                if (node.test) {
                    yield this.fixed('case')
                    yield* this.expr(node.test, node, 'test')
                } else yield this.fixed('default')
                yield this.fixed(':')
                if (node.consequent.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const statement of node.consequent) yield* this.node(statement, {})
                    yield { type: 'dedent' }
                }
                return
            case 'TryStatement':
                yield this.fixed('try')
                yield* this.block(node.block)
                if (node.handler) yield* this.node(node.handler, {})
                if (node.finalizer) {
                    yield this.fixed('finally')
                    yield* this.block(node.finalizer)
                }
                yield { type: 'line', kind: 'hard' }
                return
            case 'CatchClause':
                yield this.fixed('catch')
                if (node.param) {
                    yield this.fixed('(')
                    yield* this.node(node.param, {})
                    yield this.fixed(')')
                }
                yield* this.block(node.body)
                return
            case 'IfStatement':
                yield this.fixed('if')
                yield this.fixed('(')
                yield* this.expr(node.test, node, 'test')
                yield this.fixed(')')
                yield* this.body(node.consequent)
                if (node.alternate) {
                    yield this.fixed('else')
                    yield* this.body(node.alternate)
                }
                if (node.consequent.type === 'BlockStatement' && !node.alternate) yield { type: 'line', kind: 'hard' }
                return
            case 'WhileStatement':
                yield this.fixed('while')
                yield this.fixed('(')
                yield* this.expr(node.test, node, 'test')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'DoWhileStatement':
                yield this.fixed('do')
                yield* this.body(node.body)
                yield this.fixed('while')
                yield this.fixed('(')
                yield* this.expr(node.test, node, 'test')
                yield this.fixed(')')
                yield { type: 'statement-boundary', mode: 'required' }
                return
            case 'ForStatement':
                yield this.fixed('for')
                yield this.fixed('(')
                if (node.init) yield* this.node(node.init, { parent: node })
                yield this.fixed(';')
                if (node.test) yield* this.expr(node.test, node, 'test')
                yield this.fixed(';')
                if (node.update) yield* this.expr(node.update, node, 'right')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'ForInStatement':
            case 'ForOfStatement':
                yield this.fixed('for')
                if (node.type === 'ForOfStatement' && node.await) yield this.fixed('await')
                yield this.fixed('(')
                yield* this.node(node.left, { parent: node })
                yield this.fixed(node.type === 'ForOfStatement' ? 'of' : 'in')
                yield* this.expr(node.right, node, 'right')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'FunctionDeclaration':
            case 'FunctionExpression':
                if (node.async) yield this.fixed('async')
                yield this.fixed('function')
                if (node.generator) yield this.fixed('*')
                if (node.id) yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                yield* this.block(node.body)
                if (node.type === 'FunctionDeclaration') yield { type: 'line', kind: 'hard' }
                return
            case 'TSDeclareFunction':
                if (node.declare) yield this.fixed('declare')
                if (node.async) yield this.fixed('async')
                yield this.fixed('function')
                if (node.generator) yield this.fixed('*')
                if (node.id) yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ArrowFunctionExpression':
                if (node.async) yield this.fixed('async')
                if (node.typeParameters) yield* this.node(node.typeParameters, { parent: node })
                if (node.params.length === 1 && node.params[0]?.type === 'Identifier' && !node.params[0].typeAnnotation)
                    yield* this.node(node.params[0], {})
                else {
                    yield this.fixed('(')
                    yield* this.list(node.params)
                    yield this.fixed(')')
                }
                if (node.returnType) yield* this.node(node.returnType, {})
                yield this.fixed('=>')
                if (node.body.type === 'ObjectExpression') {
                    yield this.fixed('(')
                    yield* this.node(node.body, {})
                    yield this.fixed(')')
                } else if (node.body.type === 'BlockStatement') yield* this.node(node.body, {})
                else yield* this.expr(node.body, node, 'right')
                return
            case 'CallExpression':
            case 'OptionalCallExpression':
                yield* this.expr(node.callee as t.Expression, node, 'callee')
                if (node.type === 'OptionalCallExpression' && node.optional) yield this.fixed('?.')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.comments(node.innerComments)
                yield* this.expressionList(node.arguments as t.Node[], node)
                yield this.fixed(')')
                return
            case 'NewExpression':
                yield this.fixed('new')
                yield* this.expr(node.callee as t.Expression, node, 'callee')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.comments(node.innerComments)
                yield* this.expressionList(node.arguments as t.Node[], node)
                yield this.fixed(')')
                return
            case 'MemberExpression':
            case 'OptionalMemberExpression':
                yield* this.expr(node.object as t.Expression, node, 'object')
                if (node.computed) {
                    if (node.optional) yield this.fixed('?.')
                    yield this.fixed('[')
                    yield* this.node(node.property, {})
                    yield this.fixed(']')
                } else {
                    yield this.fixed(node.optional ? '?.' : '.')
                    yield* this.node(node.property, {})
                }
                return
            case 'BinaryExpression':
            case 'LogicalExpression':
                yield* this.expr(node.left as t.Expression, node, 'left')
                yield this.fixed(node.operator as FixedTokenType)
                yield* this.expr(node.right, node, 'right')
                return
            case 'AssignmentExpression':
                yield* this.node(node.left, {})
                yield this.fixed(node.operator as FixedTokenType)
                yield* this.expr(node.right, node, 'right')
                return
            case 'UnaryExpression':
                yield this.fixed(node.operator)
                yield* this.expr(node.argument, node, 'argument')
                return
            case 'UpdateExpression':
                if (node.prefix) yield this.fixed(node.operator)
                yield* this.node(node.argument, {})
                if (!node.prefix) yield this.fixed(node.operator)
                return
            case 'ConditionalExpression':
                yield* this.expr(node.test, node, 'test')
                yield this.fixed('?')
                yield* this.expr(node.consequent, node, 'right')
                yield this.fixed(':')
                yield* this.expr(node.alternate, node, 'right')
                return
            case 'SequenceExpression':
                yield* this.list(node.expressions)
                return
            case 'AwaitExpression':
                yield this.fixed('await')
                yield* this.expr(node.argument, node, 'argument')
                return
            case 'YieldExpression':
                yield this.fixed('yield')
                if (node.delegate) yield this.fixed('*')
                if (node.argument) yield* this.expr(node.argument, node, 'argument')
                return
            case 'ThisExpression':
                yield this.fixed('this')
                return
            case 'Super':
                yield this.fixed('super')
                return
            case 'ArrayExpression':
                yield this.fixed('[')
                yield* this.comments(node.innerComments)
                yield* this.arrayElements(node.elements, node)
                yield this.fixed(']')
                return
            case 'ArrayPattern':
                yield this.fixed('[')
                yield* this.comments(node.innerComments)
                yield* this.arrayElements(node.elements, node)
                yield this.fixed(']')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'ObjectExpression':
                yield this.fixed('{')
                yield* this.comments(node.innerComments)
                yield* this.list(node.properties)
                yield this.fixed('}')
                return
            case 'ObjectPattern':
                yield this.fixed('{')
                yield* this.comments(node.innerComments)
                yield* this.list(node.properties)
                yield this.fixed('}')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'ObjectProperty':
                if (node.computed) {
                    yield this.fixed('[')
                    yield* this.node(node.key, {})
                    yield this.fixed(']')
                } else yield* this.node(node.key, {})
                if (node.shorthand) return
                yield this.fixed(':')
                if (t.isExpression(node.value)) yield* this.expr(node.value, node, 'right')
                else yield* this.node(node.value, {})
                return
            case 'ObjectMethod':
                if (node.async) yield this.fixed('async')
                if (node.kind && node.kind !== 'method') yield this.fixed(node.kind)
                if (node.generator) yield this.fixed('*')
                if (node.computed) yield this.fixed('[')
                yield* this.node(node.key, {})
                if (node.computed) yield this.fixed(']')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                yield* this.block(node.body)
                return
            case 'ClassDeclaration':
            case 'ClassExpression':
                if ('abstract' in node && node.abstract) yield this.fixed('abstract')
                yield this.fixed('class')
                if (node.id) yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                if (node.superClass) {
                    yield this.fixed('extends')
                    yield* this.node(node.superClass, {})
                    if (node.superTypeParameters) yield* this.node(node.superTypeParameters, {})
                }
                if (node.implements?.length) {
                    yield this.fixed('implements')
                    yield* this.list(node.implements)
                }
                yield* this.node(node.body, {})
                if (node.type === 'ClassDeclaration') yield { type: 'line', kind: 'hard' }
                return
            case 'ClassBody':
                yield this.fixed('{')
                yield* this.comments(node.innerComments)
                if (node.body.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const member of node.body) {
                        yield* this.node(member, {})
                        if (!['ClassMethod', 'ClassPrivateMethod'].includes(member.type))
                            yield { type: 'statement-boundary', mode: 'normal' }
                    }
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                return
            case 'ClassMethod':
            case 'ClassPrivateMethod':
                if (node.accessibility) yield this.fixed(node.accessibility)
                if (node.override) yield this.fixed('override')
                if (node.static) yield this.fixed('static')
                if (node.abstract) yield this.fixed('abstract')
                if (node.async) yield this.fixed('async')
                if (node.kind !== 'method' && node.kind !== 'constructor') yield this.fixed(node.kind)
                if (node.generator) yield this.fixed('*')
                if (node.computed) yield this.fixed('[')
                yield* this.node(node.key, {})
                if (node.computed) yield this.fixed(']')
                if (node.optional) yield this.fixed('?')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                yield* this.block(node.body)
                return
            case 'ClassProperty':
            case 'ClassPrivateProperty':
                if ('accessibility' in node && node.accessibility) yield this.fixed(node.accessibility)
                if ('override' in node && node.override) yield this.fixed('override')
                if (node.static) yield this.fixed('static')
                if (node.readonly) yield this.fixed('readonly')
                if ('declare' in node && node.declare) yield this.fixed('declare')
                if ('computed' in node && node.computed) yield this.fixed('[')
                yield* this.node(node.key, {})
                if ('computed' in node && node.computed) yield this.fixed(']')
                if (node.optional) yield this.fixed('?')
                if (node.definite) yield this.fixed('!')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                if (node.value) {
                    yield this.fixed('=')
                    yield* this.node(node.value, {})
                }
                return
            case 'ClassAccessorProperty':
                if (node.accessibility) yield this.fixed(node.accessibility)
                if (node.override) yield this.fixed('override')
                if (node.static) yield this.fixed('static')
                if (node.abstract) yield this.fixed('abstract')
                yield this.fixed('accessor')
                yield* this.node(node.key, {})
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                if (node.value) {
                    yield this.fixed('=')
                    yield* this.node(node.value, {})
                }
                return
            case 'StaticBlock':
                yield this.fixed('static')
                yield this.fixed('{')
                if (node.body.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const statement of node.body) yield* this.node(statement, {})
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                return
            case 'TSDeclareMethod':
                if (node.accessibility) yield this.fixed(node.accessibility)
                if (node.override) yield this.fixed('override')
                if (node.static) yield this.fixed('static')
                if (node.abstract) yield this.fixed('abstract')
                if (node.async) yield this.fixed('async')
                if (node.kind && node.kind !== 'method' && node.kind !== 'constructor') yield this.fixed(node.kind)
                if (node.generator) yield this.fixed('*')
                yield* this.node(node.key, {})
                if (node.optional) yield this.fixed('?')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                return
            case 'TSParameterProperty':
                if (node.accessibility) yield this.fixed(node.accessibility)
                if (node.readonly) yield this.fixed('readonly')
                if (node.override) yield this.fixed('override')
                yield* this.node(node.parameter, {})
                return
            case 'SpreadElement':
            case 'RestElement':
                yield this.fixed('...')
                yield* this.node(node.argument, {})
                if (node.type === 'RestElement' && node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'AssignmentPattern':
                yield* this.node(node.left, {})
                yield this.fixed('=')
                yield* this.node(node.right, {})
                return
            case 'TemplateLiteral':
                yield this.fixed('`')
                for (let i = 0; i < node.quasis.length; i++) {
                    yield { type: 'template-chunk', value: node.quasis[i]!.value.raw }
                    if (i < node.expressions.length) {
                        yield this.fixed('${')
                        yield* this.node(node.expressions[i]!, {})
                        yield this.fixed('}')
                    }
                }
                yield this.fixed('`')
                return
            case 'TemplateElement':
                yield { type: 'template-chunk', value: node.value.raw }
                return
            case 'TaggedTemplateExpression':
                yield* this.node(node.tag, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield* this.node(node.quasi, {})
                return
            case 'JSXIdentifier':
                yield { type: 'ident', value: node.name }
                return
            case 'JSXMemberExpression':
                yield* this.node(node.object, {})
                yield this.fixed('.')
                yield* this.node(node.property, {})
                return
            case 'JSXNamespacedName':
                yield* this.node(node.namespace, {})
                yield this.fixed(':')
                yield* this.node(node.name, {})
                return
            case 'JSXElement':
                yield* this.node(node.openingElement, {})
                for (const child of node.children) yield* this.node(child, {})
                if (node.closingElement) yield* this.node(node.closingElement, {})
                return
            case 'JSXOpeningElement':
                yield this.fixed('<')
                yield* this.node(node.name, {})
                for (const attribute of node.attributes) yield* this.node(attribute, {})
                if (node.selfClosing) yield this.fixed('/')
                yield this.fixed('>')
                return
            case 'JSXClosingElement':
                yield this.fixed('<')
                yield this.fixed('/')
                yield* this.node(node.name, {})
                yield this.fixed('>')
                return
            case 'JSXFragment':
                yield this.fixed('<')
                yield this.fixed('>')
                for (const child of node.children) yield* this.node(child, {})
                yield this.fixed('<')
                yield this.fixed('/')
                yield this.fixed('>')
                return
            case 'JSXOpeningFragment':
                yield this.fixed('<')
                yield this.fixed('>')
                return
            case 'JSXClosingFragment':
                yield this.fixed('<')
                yield this.fixed('/')
                yield this.fixed('>')
                return
            case 'JSXEmptyExpression':
                yield* this.comments(node.innerComments)
                return
            case 'JSXAttribute':
                yield* this.node(node.name, {})
                if (node.value) {
                    yield this.fixed('=')
                    yield* this.node(node.value, {})
                }
                return
            case 'JSXSpreadAttribute':
                yield this.fixed('{')
                yield this.fixed('...')
                yield* this.node(node.argument, {})
                yield this.fixed('}')
                return
            case 'JSXExpressionContainer':
                yield this.fixed('{')
                if (node.expression.type !== 'JSXEmptyExpression') yield* this.node(node.expression, {})
                yield this.fixed('}')
                return
            case 'JSXSpreadChild':
                yield this.fixed('{')
                yield this.fixed('...')
                yield* this.node(node.expression, {})
                yield this.fixed('}')
                return
            case 'JSXText': {
                const value = cleanJsxText(node.value)
                if (value) yield { type: 'jsx-text', value }
                return
            }
            case 'ImportDeclaration':
                yield this.fixed('import')
                if (node.importKind === 'type') yield this.fixed('type')
                if (node.specifiers.length) {
                    if (node.specifiers[0]?.type === 'ImportDefaultSpecifier') {
                        yield* this.node(node.specifiers[0].local, {})
                        if (node.specifiers.length > 1) yield this.fixed(',')
                    }
                    const named = node.specifiers.filter(s => s.type === 'ImportSpecifier')
                    const ns = node.specifiers.find(s => s.type === 'ImportNamespaceSpecifier')
                    if (ns) {
                        yield this.fixed('*')
                        yield this.fixed('as')
                        yield* this.node(ns.local, {})
                    }
                    if (named.length) {
                        yield this.fixed('{')
                        yield* this.list(named)
                        yield this.fixed('}')
                    }
                    yield this.fixed('from')
                }
                yield* this.node(node.source, {})
                if (node.attributes?.length) {
                    yield this.fixed('with')
                    yield this.fixed('{')
                    yield* this.list(node.attributes)
                    yield this.fixed('}')
                }
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ImportDefaultSpecifier':
            case 'ImportNamespaceSpecifier':
                yield* this.node(node.local, {})
                return
            case 'ImportSpecifier':
                if (node.importKind === 'type') yield this.fixed('type')
                yield* this.node(node.imported, {})
                if (node.imported.type !== 'Identifier' || node.local.name !== node.imported.name) {
                    yield this.fixed('as')
                    yield* this.node(node.local, {})
                }
                return
            case 'ImportAttribute':
                yield* this.node(node.key, {})
                yield this.fixed(':')
                yield* this.node(node.value, {})
                return
            case 'ImportExpression':
                yield this.fixed('import')
                yield this.fixed('(')
                yield* this.node(node.source, {})
                if (node.options) {
                    yield this.fixed(',')
                    yield* this.node(node.options, {})
                }
                yield this.fixed(')')
                return
            case 'Import':
                yield this.fixed('import')
                return
            case 'MetaProperty':
                yield* this.node(node.meta, {})
                yield this.fixed('.')
                yield* this.node(node.property, {})
                return
            case 'ExportNamedDeclaration':
                yield this.fixed('export')
                if (node.exportKind === 'type' && !node.declaration) yield this.fixed('type')
                if (node.declaration) {
                    yield* this.node(node.declaration, {})
                } else {
                    yield this.fixed('{')
                    yield* this.list(node.specifiers)
                    yield this.fixed('}')
                    if (node.source) {
                        yield this.fixed('from')
                        yield* this.node(node.source, {})
                    }
                    if (node.attributes?.length) {
                        yield this.fixed('with')
                        yield this.fixed('{')
                        yield* this.list(node.attributes)
                        yield this.fixed('}')
                    }
                    yield { type: 'statement-boundary', mode: 'normal' }
                }
                return
            case 'ExportDefaultDeclaration':
                yield this.fixed('export')
                yield this.fixed('default')
                yield* this.node(node.declaration, {})
                if (!['FunctionDeclaration', 'ClassDeclaration'].includes(node.declaration.type))
                    yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ExportAllDeclaration':
                yield this.fixed('export')
                if (node.exportKind === 'type') yield this.fixed('type')
                yield this.fixed('*')
                yield this.fixed('from')
                yield* this.node(node.source, {})
                if (node.attributes?.length) {
                    yield this.fixed('with')
                    yield this.fixed('{')
                    yield* this.list(node.attributes)
                    yield this.fixed('}')
                }
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ExportSpecifier':
                if (node.exportKind === 'type') yield this.fixed('type')
                yield* this.node(node.local, {})
                if (
                    node.local.type !== 'Identifier' ||
                    node.exported.type !== 'Identifier' ||
                    node.exported.name !== node.local.name
                ) {
                    yield this.fixed('as')
                    yield* this.node(node.exported, {})
                }
                return
            case 'ExportDefaultSpecifier':
            case 'ExportNamespaceSpecifier':
                if (node.type === 'ExportNamespaceSpecifier') yield this.fixed('*')
                yield this.fixed('as')
                yield* this.node(node.exported, {})
                return
            case 'TSAsExpression':
            case 'TSSatisfiesExpression':
                yield* this.expr(node.expression, node, 'left')
                yield this.fixed(node.type === 'TSAsExpression' ? 'as' : 'satisfies')
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSTypeAssertion':
                yield this.fixed('<')
                yield* this.node(node.typeAnnotation, {})
                yield this.fixed('>')
                yield* this.expr(node.expression, node, 'right')
                return
            case 'TSInstantiationExpression':
                yield* this.node(node.expression, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSNonNullExpression':
                yield* this.node(node.expression, {})
                yield this.fixed('!')
                return
            case 'TSTypeAnnotation':
                yield this.fixed(':')
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSStringKeyword':
                yield this.fixed('string')
                return
            case 'TSNumberKeyword':
                yield this.fixed('number')
                return
            case 'TSBooleanKeyword':
                yield this.fixed('boolean')
                return
            case 'TSAnyKeyword':
                yield this.fixed('any')
                return
            case 'TSUnknownKeyword':
                yield this.fixed('unknown')
                return
            case 'TSNeverKeyword':
                yield this.fixed('never')
                return
            case 'TSVoidKeyword':
                yield this.fixed('void')
                return
            case 'TSUndefinedKeyword':
                yield this.fixed('undefined')
                return
            case 'TSNullKeyword':
                yield this.fixed('null')
                return
            case 'TSBigIntKeyword':
                yield this.fixed('bigint')
                return
            case 'TSSymbolKeyword':
                yield this.fixed('symbol')
                return
            case 'TSObjectKeyword':
                yield this.fixed('object')
                return
            case 'TSIntrinsicKeyword':
                yield this.fixed('intrinsic')
                return
            case 'TSThisType':
                yield this.fixed('this')
                return
            case 'TSQualifiedName':
                yield* this.node(node.left, {})
                yield this.fixed('.')
                yield* this.node(node.right, {})
                return
            case 'TSTypeReference':
                yield* this.node(node.typeName, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSTypeParameterInstantiation':
            case 'TSTypeParameterDeclaration':
                yield this.fixed('<')
                yield* this.list(node.params)
                if (
                    node.type === 'TSTypeParameterDeclaration' &&
                    _ctx.parent?.type === 'ArrowFunctionExpression' &&
                    /\.tsx$/iu.test(this.config.filepath ?? '') &&
                    node.params.length === 1 &&
                    !node.params[0]!.constraint &&
                    !node.params[0]!.default
                )
                    yield this.fixed(',')
                yield this.fixed('>')
                return
            case 'TSTypeParameter':
                if (node.const) yield this.fixed('const')
                if (node.in) yield this.fixed('in')
                if (node.out) yield this.fixed('out')
                yield { type: 'ident', value: node.name }
                if (node.constraint) {
                    yield this.fixed('extends')
                    yield* this.node(node.constraint, {})
                }
                if (node.default) {
                    yield this.fixed('=')
                    yield* this.node(node.default, {})
                }
                return
            case 'TSArrayType':
                yield* this.node(node.elementType, {})
                yield this.fixed('[')
                yield this.fixed(']')
                return
            case 'TSTupleType':
                yield this.fixed('[')
                yield* this.list(node.elementTypes)
                yield this.fixed(']')
                return
            case 'TSNamedTupleMember':
                if (node.elementType.type === 'TSRestType') yield this.fixed('...')
                yield* this.node(node.label, {})
                if (node.optional) yield this.fixed('?')
                yield this.fixed(':')
                yield* this.node(
                    node.elementType.type === 'TSRestType' ? node.elementType.typeAnnotation : node.elementType,
                    {}
                )
                return
            case 'TSOptionalType':
                yield* this.node(node.typeAnnotation, {})
                yield this.fixed('?')
                return
            case 'TSRestType':
                yield this.fixed('...')
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSTypeOperator':
                yield this.fixed(node.operator as FixedTokenType)
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSIndexedAccessType':
                yield* this.node(node.objectType, {})
                yield this.fixed('[')
                yield* this.node(node.indexType, {})
                yield this.fixed(']')
                return
            case 'TSConditionalType':
                yield* this.node(node.checkType, {})
                yield this.fixed('extends')
                yield* this.node(node.extendsType, {})
                yield this.fixed('?')
                yield* this.node(node.trueType, {})
                yield this.fixed(':')
                yield* this.node(node.falseType, {})
                return
            case 'TSInferType':
                yield this.fixed('infer')
                yield* this.node(node.typeParameter, {})
                return
            case 'TSTypeQuery':
                yield this.fixed('typeof')
                yield* this.node(node.exprName, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSTypePredicate':
                if (node.asserts) yield this.fixed('asserts')
                yield* this.node(node.parameterName, {})
                if (node.typeAnnotation) {
                    yield this.fixed('is')
                    yield* this.node(node.typeAnnotation.typeAnnotation, {})
                }
                return
            case 'TSParenthesizedType':
                yield this.fixed('(')
                yield* this.node(node.typeAnnotation, {})
                yield this.fixed(')')
                return
            case 'TSLiteralType':
                yield* this.node(node.literal, {})
                return
            case 'TSFunctionType':
            case 'TSConstructorType':
                if (node.type === 'TSConstructorType') {
                    if (node.abstract) yield this.fixed('abstract')
                    yield this.fixed('new')
                }
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.parameters)
                yield this.fixed(')')
                yield this.fixed('=>')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation.typeAnnotation, {})
                return
            case 'TSCallSignatureDeclaration':
            case 'TSConstructSignatureDeclaration':
                if (node.type === 'TSConstructSignatureDeclaration') yield this.fixed('new')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.parameters)
                yield this.fixed(')')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'TSMethodSignature':
                if (node.kind !== 'method') yield this.fixed(node.kind)
                if (node.computed) yield this.fixed('[')
                yield* this.node(node.key, {})
                if (node.computed) yield this.fixed(']')
                if (node.optional) yield this.fixed('?')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.parameters)
                yield this.fixed(')')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'TSIndexSignature':
                if (node.readonly) yield this.fixed('readonly')
                if (node.static) yield this.fixed('static')
                yield this.fixed('[')
                yield* this.list(node.parameters)
                yield this.fixed(']')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'TSTypeAliasDeclaration':
                if (node.declare) yield this.fixed('declare')
                yield this.fixed('type')
                yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('=')
                yield* this.node(node.typeAnnotation, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'TSEnumDeclaration':
                if (node.declare) yield this.fixed('declare')
                if (node.const) yield this.fixed('const')
                yield this.fixed('enum')
                yield* this.node(node.id, {})
                if (node.body) yield* this.node(node.body, {})
                else {
                    yield this.fixed('{')
                    yield* this.list(node.members)
                    yield this.fixed('}')
                }
                yield { type: 'line', kind: 'hard' }
                return
            case 'TSEnumBody':
                yield this.fixed('{')
                yield* this.list(node.members)
                yield this.fixed('}')
                return
            case 'TSEnumMember':
                yield* this.node(node.id, {})
                if (node.initializer) {
                    yield this.fixed('=')
                    yield* this.node(node.initializer, {})
                }
                return
            case 'TSModuleDeclaration':
                if (_ctx.parent?.type === 'TSModuleDeclaration') yield this.fixed('.')
                else {
                    if (node.declare) yield this.fixed('declare')
                    if (node.global) yield this.fixed('global')
                    else yield this.fixed(node.kind === 'module' ? 'module' : 'namespace')
                }
                yield* this.node(node.id, {})
                yield* this.node(node.body, { parent: node })
                if (_ctx.parent?.type !== 'TSModuleDeclaration') yield { type: 'line', kind: 'hard' }
                return
            case 'TSModuleBlock':
                yield this.fixed('{')
                yield* this.comments(node.innerComments)
                if (node.body.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const statement of node.body) yield* this.node(statement, {})
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                return
            case 'TSImportType':
                yield this.fixed('import')
                yield this.fixed('(')
                yield* this.node(node.argument, {})
                if (node.options) {
                    yield this.fixed(',')
                    yield* this.node(node.options, {})
                }
                yield this.fixed(')')
                if (node.qualifier) {
                    yield this.fixed('.')
                    yield* this.node(node.qualifier, {})
                }
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSImportEqualsDeclaration':
                if (node.isExport) yield this.fixed('export')
                yield this.fixed('import')
                if (node.importKind === 'type') yield this.fixed('type')
                yield* this.node(node.id, {})
                yield this.fixed('=')
                yield* this.node(node.moduleReference, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'TSExternalModuleReference':
                yield this.fixed('require')
                yield this.fixed('(')
                yield* this.node(node.expression, {})
                yield this.fixed(')')
                return
            case 'TSExportAssignment':
                yield this.fixed('export')
                yield this.fixed('=')
                yield* this.node(node.expression, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'TSNamespaceExportDeclaration':
                yield this.fixed('export')
                yield this.fixed('as')
                yield this.fixed('namespace')
                yield* this.node(node.id, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'TSInterfaceDeclaration':
                if (node.declare) yield this.fixed('declare')
                yield this.fixed('interface')
                yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                if (node.extends?.length) {
                    yield this.fixed('extends')
                    yield* this.list(node.extends)
                }
                yield* this.node(node.body, {})
                yield { type: 'line', kind: 'hard' }
                return
            case 'TSInterfaceBody':
            case 'TSTypeLiteral': {
                const members = node.type === 'TSInterfaceBody' ? node.body : node.members
                yield this.fixed('{')
                yield* this.comments(node.innerComments)
                if (members.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const member of members) {
                        yield* this.node(member, {})
                        yield { type: 'statement-boundary', mode: 'normal' }
                    }
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                return
            }
            case 'TSPropertySignature':
                if (node.readonly) yield this.fixed('readonly')
                if (node.kind) yield this.fixed(node.kind)
                if (node.computed) yield this.fixed('[')
                yield* this.node(node.key, {})
                if (node.computed) yield this.fixed(']')
                if (node.optional) yield this.fixed('?')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'TSMappedType':
                yield this.fixed('{')
                yield* this.comments(node.innerComments)
                if (node.readonly) {
                    if (node.readonly === '+' || node.readonly === '-') yield this.fixed(node.readonly)
                    yield this.fixed('readonly')
                }
                yield this.fixed('[')
                if (node.typeParameter.const) yield this.fixed('const')
                yield { type: 'ident', value: node.typeParameter.name }
                if (node.typeParameter.constraint) {
                    yield this.fixed('in')
                    yield* this.node(node.typeParameter.constraint, {})
                }
                if (node.nameType) {
                    yield this.fixed('as')
                    yield* this.node(node.nameType, {})
                }
                yield this.fixed(']')
                if (node.optional) {
                    if (node.optional === '+' || node.optional === '-') yield this.fixed(node.optional)
                    yield this.fixed('?')
                }
                if (node.typeAnnotation) {
                    yield this.fixed(':')
                    yield* this.node(node.typeAnnotation, {})
                }
                yield this.fixed('}')
                return
            case 'TSTemplateLiteralType':
                yield this.fixed('`')
                for (let index = 0; index < node.quasis.length; index++) {
                    yield { type: 'template-chunk', value: node.quasis[index]!.value.raw }
                    if (index < node.types.length) {
                        yield this.fixed('${')
                        yield* this.node(node.types[index]!, {})
                        yield this.fixed('}')
                    }
                }
                yield this.fixed('`')
                return
            case 'TSExpressionWithTypeArguments':
                yield* this.node(node.expression, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSUnionType':
            case 'TSIntersectionType':
                for (let i = 0; i < node.types.length; i++) {
                    if (i) yield this.fixed(node.type === 'TSUnionType' ? '|' : '&')
                    yield* this.node(node.types[i]!, {})
                }
                return
            case 'ParenthesizedExpression':
                yield this.fixed('(')
                yield* this.node(node.expression, {})
                yield this.fixed(')')
                return
            default:
                throw new UnsupportedNodeError(
                    `Unsupported Babel AST node ${node.type}${this.config.filepath ? ` in ${this.config.filepath}` : ''}${node.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : ''}`
                )
        }
    }
}
