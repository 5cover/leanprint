import type * as t from '@babel/types'

export type ExpressionPosition = 'left' | 'right' | 'test' | 'callee' | 'object' | 'argument' | 'other'

const binaryPrecedence: Record<string, number> = {
    '||': 3,
    '??': 3,
    '&&': 4,
    '|': 5,
    '^': 6,
    '&': 7,
    '==': 8,
    '!=': 8,
    '===': 8,
    '!==': 8,
    '<': 9,
    '<=': 9,
    '>': 9,
    '>=': 9,
    in: 9,
    instanceof: 9,
    '<<': 10,
    '>>': 10,
    '>>>': 10,
    '+': 11,
    '-': 11,
    '*': 12,
    '/': 12,
    '%': 12,
    '**': 13,
}

function precedence(node: t.Node): number {
    if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression')
        return binaryPrecedence[node.operator] ?? 0
    switch (node.type) {
        case 'SequenceExpression':
            return 1
        case 'YieldExpression':
        case 'AssignmentExpression':
        case 'ArrowFunctionExpression':
            return 2
        case 'ConditionalExpression':
            return 2
        case 'TSAsExpression':
        case 'TSSatisfiesExpression':
        case 'TSTypeAssertion':
            return 9
        case 'UnaryExpression':
        case 'AwaitExpression':
            return 14
        case 'UpdateExpression':
            return 15
        case 'NewExpression':
            return 16
        case 'CallExpression':
        case 'OptionalCallExpression':
        case 'ImportExpression':
            return 17
        case 'MemberExpression':
        case 'OptionalMemberExpression':
        case 'TaggedTemplateExpression':
        case 'TSNonNullExpression':
        case 'TSInstantiationExpression':
            return 18
        default:
            return 20
    }
}

function isBinary(node: t.Node): node is t.BinaryExpression | t.LogicalExpression {
    return node.type === 'BinaryExpression' || node.type === 'LogicalExpression'
}

export function needsParentheses(child: t.Expression, parent: t.Node, position: ExpressionPosition): boolean {
    if (
        child.type === 'SequenceExpression' &&
        ['ArrayExpression', 'CallExpression', 'NewExpression', 'OptionalCallExpression', 'ObjectProperty'].includes(
            parent.type
        )
    )
        return true
    if (
        position === 'argument' &&
        ['ArrayExpression', 'CallExpression', 'NewExpression', 'OptionalCallExpression'].includes(parent.type)
    )
        return false
    if (parent.type === 'ObjectProperty' && position === 'right') return false
    if (
        parent.type === 'ExpressionStatement' &&
        ['ObjectExpression', 'FunctionExpression', 'ClassExpression'].includes(child.type)
    )
        return true

    if ((parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') && position === 'callee')
        return precedence(child) < 17
    if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && position === 'object')
        return precedence(child) < 18
    if (parent.type === 'NewExpression' && position === 'callee')
        return precedence(child) < 16 || child.type === 'CallExpression' || child.type === 'OptionalCallExpression'

    if (parent.type === 'BinaryExpression' && parent.operator === '**' && position === 'left') {
        if (child.type === 'UnaryExpression' || child.type === 'AwaitExpression') return true
        if (isBinary(child) && child.operator === '**') return true
    }

    if (isBinary(parent) && isBinary(child)) {
        if (
            (parent.operator === '??' && (child.operator === '&&' || child.operator === '||')) ||
            (child.operator === '??' && (parent.operator === '&&' || parent.operator === '||'))
        )
            return true
        const childPrecedence = precedence(child)
        const parentPrecedence = precedence(parent)
        if (childPrecedence < parentPrecedence) return true
        if (childPrecedence > parentPrecedence) return false
        if (parent.operator === '**') return position === 'left'
        return position === 'right'
    }

    if (parent.type === 'ConditionalExpression') {
        if (position === 'test' && precedence(child) <= 2) return true
        if (child.type === 'ConditionalExpression') return position === 'test' || position === 'left'
    }

    const parentPrecedence = precedence(parent)
    if (parentPrecedence === 20) return false
    return precedence(child) < parentPrecedence
}
