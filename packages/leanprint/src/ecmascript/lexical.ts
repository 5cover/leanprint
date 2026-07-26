import { isSymbolToken, isWordToken, symbolTokenTypes, type ConcreteToken } from './tokens.js'

const punctuatorsByLength = [...symbolTokenTypes].sort((left, right) => right.length - left.length)

export function tokenText(token: ConcreteToken): string {
    switch (token.type) {
        case 'ident':
        case 'number-literal':
        case 'bigint-literal':
        case 'string-literal':
        case 'template-chunk':
        case 'jsx-text':
            return token.value
        case 'private-ident':
            return `#${token.value}`
        case 'regex':
            return `/${token.pattern}/${token.flags}`
        case 'comment':
            return token.kind === 'line' ? `//${token.value}` : `/*${token.value}*/`
        case 'shebang':
            return `#!${token.value}`
        default:
            return token.type
    }
}

export function requiredSeparator(
    previous: ConcreteToken,
    next: ConcreteToken,
    currentLine = tokenText(previous)
): '' | ' ' {
    if (previous.type === 'comment' || previous.type === 'shebang') return ''
    if (isWordToken(previous) && isWordToken(next)) return ' '
    if (['return', 'throw', 'yield', 'await', 'new', 'delete', 'void', 'typeof'].includes(previous.type)) return ' '

    const left = tokenText(previous)
    const right = tokenText(next)
    if (isSymbolToken(previous)) {
        const combined = left + right
        if (punctuatorsByLength.some(punctuator => punctuator.length > left.length && combined.startsWith(punctuator)))
            return ' '
    }
    if (
        (previous.type === 'number-literal' && next.type === '.') ||
        (previous.type === '/' && (next.type === '/' || next.type === '*' || next.type === 'regex'))
    )
        return ' '

    // Annex B recognizes these as HTML-style comments. They can be assembled
    // from three ordinary AST tokens even though no adjacent pair is unsafe.
    if ((currentLine.endsWith('<!') && right.startsWith('--')) || (currentLine.trimStart() === '--' && right === '>'))
        return ' '

    return ''
}
