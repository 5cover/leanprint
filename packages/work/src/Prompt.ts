import type { SourceConfig } from './types.js'
export default class Prompt {
    static generate(config: SourceConfig, inLeandir: boolean): string {
        const parts = [
            inLeandir
                ? 'You are working inside a generated LeanPrint leandir.'
                : 'Use the LeanPrint compact source style in supported files.',
            `Use ${config.source?.indent === 2 ? 'two-space' : `${String(config.source?.indent)}-space`} indentation.`,
        ]
        if (config.source?.lineWrapping === false) parts.push('Do not wrap lines based on length.')
        if (config.tokens?.semicolons === false) parts.push('Omit optional semicolons.')
        if (config.tokens?.trailingCommas === false) parts.push('Omit trailing commas.')
        if (config.source?.spaceAroundOperators === false && config.source.spaceAfterControlKeywords === false)
            parts.push(
                'Omit optional horizontal whitespace, including spaces around operators and after control-flow keywords.'
            )
        parts.push(
            `Keep at most ${String(config.source?.maxEmptyLines ?? 1)} consecutive empty line${config.source?.maxEmptyLines === 1 ? '' : 's'}.`,
            `Preserve spaces required to prevent lexical tokens from merging.`
        )
        if (config.tokens?.parentheses === 'required-only')
            parts.push('Emit parentheses only when required to preserve syntax and expression structure.')
        if (config.tokens?.collapseSingleStatementBlocks)
            parts.push('Simple single-statement control-flow bodies may remain collapsed.')
        parts.push('Keep comments and valid language syntax.')
        if (inLeandir)
            parts.push(
                'Do not run Prettier or apply conventional human formatting inside this leandir.',
                'Do not edit the generated config file or its workspace metadata.',
                "A separate sync step will apply the source project's human formatter; LeanPrint does not restore original formatting."
            )
        return `${parts.join(' ')}\n`
    }
}
