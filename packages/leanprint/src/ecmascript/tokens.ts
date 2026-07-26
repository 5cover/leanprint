export const wordTokenTypes = [
    'ident',
    'private-ident',
    'number-literal',
    'bigint-literal',
    'string-literal',
    'regex',
    'template-chunk',
    'jsx-text',
] as const
export const virtualTokenTypes = ['statement-boundary', 'line', 'indent', 'dedent'] as const
export const symbolTokenTypes = [
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '.',
    '?.',
    ',',
    ':',
    ';',
    '?',
    '=>',
    '+',
    '-',
    '*',
    '/',
    '%',
    '**',
    '++',
    '--',
    '=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '**=',
    '==',
    '!=',
    '===',
    '!==',
    '<',
    '>',
    '<=',
    '>=',
    '<<',
    '>>',
    '>>>',
    '<<=',
    '>>=',
    '>>>=',
    '&',
    '|',
    '^',
    '~',
    '!',
    '&&',
    '||',
    '??',
    '&=',
    '|=',
    '^=',
    '&&=',
    '||=',
    '??=',
    '|>',
    '...',
    '@',
    '#',
    '${',
    '`',
] as const
export type WordTokenType = (typeof wordTokenTypes)[number]
export type SymbolTokenType = (typeof symbolTokenTypes)[number]
export type VirtualTokenType = (typeof virtualTokenTypes)[number]
export type FixedTokenType =
    | SymbolTokenType
    | 'if'
    | 'else'
    | 'for'
    | 'while'
    | 'do'
    | 'switch'
    | 'case'
    | 'default'
    | 'return'
    | 'throw'
    | 'break'
    | 'continue'
    | 'try'
    | 'catch'
    | 'finally'
    | 'function'
    | 'class'
    | 'extends'
    | 'static'
    | 'get'
    | 'set'
    | 'async'
    | 'await'
    | 'yield'
    | 'new'
    | 'this'
    | 'super'
    | 'import'
    | 'export'
     
    | 'from'
    | 'as'
    | 'satisfies'
    | 'in'
    | 'of'
    | 'instanceof'
    | 'typeof'
    | 'void'
    | 'delete'
    | 'const'
    | 'let'
    | 'var'
    | 'using'
    | 'debugger'
    | 'with'
    | 'override'
    | 'accessor'
    | 'constructor'
    | 'bigint'
    | 'intrinsic'
    | 'out'
    | 'unique'
    | 'global'
    | 'module'
    | 'require'
    | 'interface'
    | 'type'
    | 'enum'
    | 'implements'
    | 'public'
    | 'private'
    | 'protected'
    | 'readonly'
    | 'abstract'
    | 'declare'
    | 'namespace'
    | 'keyof'
    | 'infer'
    | 'is'
    | 'asserts'
    | 'unknown'
    | 'never'
    | 'any'
    | 'boolean'
    | 'number'
    | 'string'
    | 'symbol'
    | 'object'
    | 'undefined'
    | 'null'
    | 'true'
    | 'false'
export type Token =
    | { type: FixedTokenType }
    | {
          type: 'ident' | 'private-ident' | 'number-literal' | 'bigint-literal' | 'string-literal' | 'jsx-text'
          value: string
      }
    | { type: 'regex'; pattern: string; flags: string }
    | { type: 'template-chunk'; value: string }
    | { type: 'comment'; kind: 'line' | 'block'; value: string }
    | { type: 'shebang'; value: string }
    | { type: 'statement-boundary'; mode: 'normal' | 'required' }
    | { type: 'line'; kind: 'soft' | 'hard' }
    | { type: 'indent' }
    | { type: 'dedent' }
export type ConcreteToken = Exclude<Token, { type: VirtualTokenType }>
export type WordToken = Extract<Token, { type: WordTokenType }> | Extract<Token, { type: FixedTokenType }>
export type SymbolToken = Extract<Token, { type: SymbolTokenType }>
const words = new Set<string>(wordTokenTypes),
    symbols = new Set<string>(symbolTokenTypes),
    virtuals = new Set<string>(virtualTokenTypes)
export const isWordToken = (token: Token): token is WordToken =>
    words.has(token.type) ||
    (!symbols.has(token.type) && !virtuals.has(token.type) && token.type !== 'comment' && token.type !== 'shebang')
export const isSymbolToken = (token: Token): token is SymbolToken => symbols.has(token.type)
export const isVirtualToken = (token: Token): token is Extract<Token, { type: VirtualTokenType }> =>
    virtuals.has(token.type)
