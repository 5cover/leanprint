import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Config from '../Config.js'
import { configuredLanguage } from '../languages.js'
import { collectRegularLanguageFiles } from '../scanner.js'
import Tiktoken from './Tiktoken.js'
import type { TiktokenStatsOptions, TokenStats } from './types.js'
import { InvalidConfigError } from '../types.js'
export default class Stats {
    static async tiktoken(options: TiktokenStatsOptions): Promise<TokenStats> {
        const filename = options.configFilename ?? 'leanprint.json',
            { config, sourceRoot } = await Config.source(options.root, filename),
            files = await collectRegularLanguageFiles(sourceRoot, config, filename, path =>
                Boolean(configuredLanguage(path, config))
            ),
            tokenizer = new Tiktoken(options.modelOrEncoding)
        let originalTokens = 0,
            leanTokens = 0
        try {
            for (const path of files) {
                const source = await readFile(join(sourceRoot, path), 'utf8'),
                    configured = configuredLanguage(path, config)
                if (!configured) throw new InvalidConfigError(`language not found for config and file ${path}`)
                const lean = configured.leanify(source, path)
                originalTokens += tokenizer.count(source)
                leanTokens += tokenizer.count(lean)
            }
        } finally {
            tokenizer.free()
        }
        const tokensSaved = originalTokens - leanTokens
        return {
            backend: 'tiktoken',
            requested: tokenizer.requested,
            encoding: tokenizer.encoding,
            files: files.length,
            originalTokens,
            leanTokens,
            tokensSaved,
            reductionPercentage: originalTokens === 0 ? 0 : (tokensSaved / originalTokens) * 100,
        }
    }
}
