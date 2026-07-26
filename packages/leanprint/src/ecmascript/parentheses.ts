import type * as t from '@babel/types'
const precedence: Record<string, number> = {
    SequenceExpression: 1,
    YieldExpression: 2,
    AssignmentExpression: 2,
    ArrowFunctionExpression: 2,
    ConditionalExpression: 3,
    LogicalExpression: 4,
    BinaryExpression: 7,
    TSAsExpression: 8,
    TSSatisfiesExpression: 8,
    UnaryExpression: 14,
    AwaitExpression: 14,
    UpdateExpression: 15,
    CallExpression: 17,
    OptionalCallExpression: 17,
    NewExpression: 17,
    MemberExpression: 18,
    OptionalMemberExpression: 18,
    TSNonNullExpression: 18,
}
export type ExpressionPosition = 'left' | 'right' | 'test' | 'callee' | 'object' | 'argument' | 'other'
const binary = (node: t.Node): node is t.BinaryExpression | t.LogicalExpression =>
    node.type === 'BinaryExpression' || node.type === 'LogicalExpression'
const rank = (node: t.Node) => precedence[node.type] ?? 20
export function needsParentheses(child: t.Expression, parent: t.Node, position: ExpressionPosition): boolean {
    if (
        parent.type === 'ExpressionStatement' &&
        (child.type === 'ObjectExpression' || child.type === 'FunctionExpression' || child.type === 'ClassExpression')
    )
        return true
    if ((parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') && position === 'callee')
        return rank(child) < 17
    if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && position === 'object')
        return rank(child) < 18
    if (parent.type === 'NewExpression' && position === 'callee')
        return rank(child) < 17 || child.type === 'CallExpression'
    if (
        parent.type === 'BinaryExpression' &&
        parent.operator === '**' &&
        position === 'left' &&
        (child.type === 'UnaryExpression' || child.type === 'AwaitExpression')
    )
        return true
    if (binary(parent) && binary(child)) {
        if (
            (parent.operator === '??' && ['&&', '||'].includes(child.operator)) ||
            (child.operator === '??' && ['&&', '||'].includes(parent.operator))
        )
            return true
        const cp = rank(child),
            pp = rank(parent)
        if (cp < pp) return true
        if (cp > pp) return false
        if (position === 'right') return true
    }
    if (precedence[parent.type] === undefined) return false
    return rank(child) < rank(parent)
}
