import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { glob } from 'glob'
import { format } from 'leanprint'
import Config from '../Config.js'
import Tiktoken from './Tiktoken.js'
import type { TiktokenStatsOptions, TokenStats } from './types.js'
const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
export default class Stats {
    static async tiktoken(options: TiktokenStatsOptions): Promise<TokenStats> {
        const filename = options.configFilename ?? 'leanprint.json',
            { config, sourceRoot } = await Config.source(options.root, filename),
            files = (await glob('**/*', { cwd: sourceRoot, dot: true, nodir: true, ignore: config.ignore }))
                .filter(path => extensions.has(extname(path).toLowerCase()))
                .sort(),
            tokenizer = new Tiktoken(options.modelOrEncoding)
        let originalTokens = 0,
            leanTokens = 0
        try {
            for (const path of files) {
                const source = await readFile(join(sourceRoot, path), 'utf8'),
                    lean = format(source, {
                        filepath: path,
                        parser: config.parser,
                        tokens: config.tokens,
                        source: config.source,
                    })
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
