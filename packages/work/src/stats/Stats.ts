import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { glob } from 'glob'
import Config from '../Config.js'
import { compareStrings } from '../hash.js'
import { configuredLanguage, leanify } from '../languages.js'
import Tiktoken from './Tiktoken.js'
import type { TiktokenStatsOptions, TokenStats } from './types.js'
export default class Stats {
    static async tiktoken(options: TiktokenStatsOptions): Promise<TokenStats> {
        const filename = options.configFilename ?? 'leanprint.json',
            { config, sourceRoot } = await Config.source(options.root, filename),
            files = (await glob('**/*', { cwd: sourceRoot, dot: true, nodir: true, ignore: config.ignore }))
                .filter(path => configuredLanguage(path, config))
                .sort(compareStrings),
            tokenizer = new Tiktoken(options.modelOrEncoding)
        let originalTokens = 0,
            leanTokens = 0
        try {
            for (const path of files) {
                const source = await readFile(join(sourceRoot, path), 'utf8'),
                    configured = configuredLanguage(path, config)!,
                    lean = leanify(source, path, configured)
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
