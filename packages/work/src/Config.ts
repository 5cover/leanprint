import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { GeneratedConfig, SourceConfig, WorkspaceMetadata } from './types.js'
import { InvalidConfigError, InvalidLeandirError } from './types.js'
import { hash, stableJson } from './hash.js'
const defaults = {
    ignore: ['.git/**', 'node_modules/**', 'dist/**', 'coverage/**'],
    parser: {},
    tokens: {
        semicolons: false,
        trailingCommas: false,
        collapseSingleStatementBlocks: true,
        parentheses: 'required-only' as const,
    },
    source: {
        indent: 2,
        lineWrapping: false,
        maxEmptyLines: 1,
        spaceAroundOperators: false,
        spaceAfterControlKeywords: false,
        lineEnding: 'lf' as const,
    },
}
export default class Config {
    static async discover(
        start = process.cwd(),
        configFilename = 'leanprint.json'
    ): Promise<{ configPath: string; root: string }> {
        if (isAbsolute(configFilename) || configFilename.split(/[\\/]/).includes('..'))
            throw new InvalidConfigError("Config filename must be repository-relative and may not contain '..'.")
        let current = resolve(start)
        try {
            const s = await import('node:fs/promises')
            if ((await s.stat(current)).isFile()) current = dirname(current)
        } catch {
            /* A nonexistent start path is handled by upward discovery. */
        }
        while (true) {
            const candidate = resolve(current, configFilename)
            try {
                await readFile(candidate)
                return { configPath: candidate, root: current }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
            const parent = dirname(current)
            if (parent === current)
                throw new InvalidConfigError(`No config file "${configFilename}" found from ${start}.`)
            current = parent
        }
    }
    static async load(path: string): Promise<SourceConfig | GeneratedConfig> {
        let parsed: unknown
        try {
            parsed = JSON.parse(await readFile(path, 'utf8'))
        } catch (error) {
            throw new InvalidConfigError(`Could not read config file ${path}: ${(error as Error).message}`)
        }
        if (!parsed || typeof parsed !== 'object' || typeof (parsed as any).leandir !== 'string')
            throw new InvalidConfigError(`Config file ${path} must define leandir.`)
        const raw = parsed as any
        return {
            ...raw,
            ignore: raw.ignore ?? defaults.ignore,
            parser: { ...defaults.parser, ...raw.parser },
            tokens: { ...defaults.tokens, ...raw.tokens },
            source: { ...defaults.source, ...raw.source },
        }
    }
    static async source(
        start: string,
        filename: string
    ): Promise<{ config: SourceConfig; configPath: string; sourceRoot: string }> {
        const found = await this.discover(start, filename),
            loaded = await this.load(found.configPath)
        if ('workspace' in loaded) {
            this.validateWorkspace(loaded as GeneratedConfig, found.root)
            const sourceFound = await this.discover((loaded as GeneratedConfig).workspace.sourceRoot, filename)
            return {
                config: (await this.load(sourceFound.configPath)) as SourceConfig,
                configPath: sourceFound.configPath,
                sourceRoot: sourceFound.root,
            }
        }
        return { config: loaded, configPath: found.configPath, sourceRoot: found.root }
    }
    static integrity(metadata: Omit<WorkspaceMetadata, 'integrity'>): string {
        return hash(stableJson(metadata))
    }
    static validateWorkspace(config: GeneratedConfig, root: string): void {
        const w = config.workspace
        if (!w || w.schemaVersion !== 1 || resolve(w.leandir) !== resolve(root))
            throw new InvalidLeandirError(`Invalid workspace metadata in ${root}.`)
        const { integrity, ...unsigned } = w
        if (integrity !== this.integrity(unsigned))
            throw new InvalidLeandirError(`Workspace metadata integrity check failed in ${root}.`)
    }
    static async validateLeandir(sourceRoot: string, leandir: string): Promise<void> {
        const source = await realpath(sourceRoot),
            target = await realpath(dirname(leandir))
                .then(parent => resolve(parent, leandir.split(/[\\/]/).at(-1)!))
                .catch(() => resolve(leandir))
        if (target === source || target.startsWith(`${source}/`) || source.startsWith(`${target}/`))
            throw new InvalidConfigError('The leandir must be outside, and not an ancestor of, the source root.')
    }
}
