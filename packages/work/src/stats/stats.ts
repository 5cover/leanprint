import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cfg from '../config.js'
import { configuredLanguage } from '../languages.js'
import { collectRegularLanguageFiles } from '../scanner.js'
import Tiktoken from './Tiktoken.js'
import type { TiktokenStatsOptions, TokenCountStats, TokenStats } from './types.js'
import { InvalidConfigError } from '../types.js'
function totals(files: number, originalTokens: number, leanTokens: number): TokenCountStats {
    const tokensSaved = originalTokens - leanTokens
    return {
        files,
        originalTokens,
        leanTokens,
        tokensSaved,
        reductionPercentage: originalTokens === 0 ? 0 : (tokensSaved / originalTokens) * 100,
    }
}
export async function tiktoken(options: TiktokenStatsOptions): Promise<TokenStats> {
    const filename = options.configFilename ?? 'leanprint.json',
        { config, sourceRoot } = await cfg.source(options.root, filename),
        files = await collectRegularLanguageFiles(sourceRoot, config, filename, path =>
            Boolean(configuredLanguage(path, config))
        ),
        tokenizer = new Tiktoken(options.modelOrEncoding)
    let originalTokens = 0,
        leanTokens = 0
    const languageCounts = new Map<string, { files: number; originalTokens: number; leanTokens: number }>()
    try {
        for (const path of files) {
            const source = await readFile(join(sourceRoot, path), 'utf8'),
                configured = configuredLanguage(path, config)
            if (!configured) throw new InvalidConfigError(`language not found for config and file ${path}`)
            const lean = configured.leanify(source, path)
            const originalCount = tokenizer.count(source),
                leanCount = tokenizer.count(lean),
                language = languageCounts.get(configured.id) ?? { files: 0, originalTokens: 0, leanTokens: 0 }
            originalTokens += originalCount
            leanTokens += leanCount
            language.files++
            language.originalTokens += originalCount
            language.leanTokens += leanCount
            languageCounts.set(configured.id, language)
        }
    } finally {
        tokenizer.free()
    }
    const languages: Record<string, TokenCountStats> = {}
    for (const [id, counts] of [...languageCounts].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
    )) {
        languages[id] = totals(counts.files, counts.originalTokens, counts.leanTokens)
    }
    return {
        backend: 'tiktoken',
        requested: tokenizer.requested,
        encoding: tokenizer.encoding,
        ...totals(files.length, originalTokens, leanTokens),
        languages,
    }
}
