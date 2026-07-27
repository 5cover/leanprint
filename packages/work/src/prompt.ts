import type { ResolvedSourceConfig } from './types.js'

export function generate(config: ResolvedSourceConfig, inLeandir: boolean): string {
    const parts = [
        inLeandir
            ? 'You are working inside a generated LeanPrint leandir.'
            : 'Use the LeanPrint compact source style in supported files.',
    ]
    const ecmascript = config.languages.ecmascript
    if (ecmascript) {
        const { source, tokens } = ecmascript
        parts.push(
            `For ECMAScript-family files, use ${source.indent === 2 ? 'two-space' : `${String(source.indent)}-space`} indentation.`
        )
        parts.push('Do not wrap lines based on length.')
        if (!tokens.semicolons) parts.push('Omit optional semicolons.')
        parts.push('Omit trailing commas.')
        if (!source.spaceAroundOperators && !source.spaceAfterControlKeywords)
            parts.push(
                'Omit optional horizontal whitespace, including spaces around operators and after control-flow keywords.'
            )
        parts.push(
            'Preserve spaces required to prevent lexical tokens from merging.',
            'Emit parentheses only when required to preserve syntax and expression structure.'
        )
        if (tokens.collapseSingleStatementBlocks)
            parts.push('Simple single-statement control-flow bodies may remain collapsed.')
        parts.push('Keep comments and valid language syntax.')
    }
    const json = config.languages.json
    if (json) {
        const { source } = json
        parts.push(
            `For JSON files, keep containers with recursive complexity up to ${String(source.inlineComplexity)} inline and expand more complex containers with ${source.indent === 2 ? 'two-space' : `${String(source.indent)}-space`} indentation.`,
            'Omit optional JSON whitespace and use canonical safe string escapes while preserving strict JSON syntax.'
        )
    }
    if (inLeandir)
        parts.push(
            'Do not run Prettier or apply conventional human formatting inside this leandir.',
            'Do not edit the generated config file or its workspace metadata.',
            "A separate sync step will apply the source project's human formatter; LeanPrint does not restore original formatting."
        )
    return `${parts.join(' ')}\n`
}
