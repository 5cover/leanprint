import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js'
import { ecmascriptConfigSchema, getLanguage } from 'leanprint'
import { hash, stableJson } from './hash.js'
import generatedSchema from './schemas/GeneratedConfig.json' with { type: 'json' }
import sourceSchema from './schemas/SourceConfig.json' with { type: 'json' }
import type { GeneratedConfig, ResolvedSourceConfig, SourceConfig, WorkspaceMetadata } from './types.js'
import { InvalidConfigError, InvalidLeandirError } from './types.js'

const ajv = new Ajv2020({ allErrors: true, useDefaults: true, coerceTypes: false, removeAdditional: false })
ajv.addSchema(ecmascriptConfigSchema)
ajv.addSchema(sourceSchema)
const validateSource = ajv.getSchema(sourceSchema.$id)!
const validateGenerated = ajv.compile(generatedSchema)

function describe(errors: ErrorObject[] | null | undefined): string {
    return (errors ?? [])
        .map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
        .join('; ')
}

function resolveLanguages(config: SourceConfig): ResolvedSourceConfig {
    const languages: ResolvedSourceConfig['languages'] = {}
    for (const [id, value] of Object.entries(config.languages)) {
        const language = getLanguage(id)
        if (!language) throw new InvalidConfigError(`Language "${id}" is configured but not registered.`)
        languages[id] = language.resolveConfig(value)
    }
    const { humanFormatter, ...source } = config
    const resolved: ResolvedSourceConfig = {
        ...source,
        ignore: config.ignore!,
        languages,
    }
    if (humanFormatter) resolved.humanFormatter = { command: humanFormatter.command, args: humanFormatter.args! }
    return resolved
}

export default class Config {
    static isGenerated(config: ResolvedSourceConfig | GeneratedConfig): config is GeneratedConfig {
        return 'workspace' in config && Boolean(config.workspace)
    }
    static async discover(
        start = process.cwd(),
        configFilename = 'leanprint.json'
    ): Promise<{ configPath: string; root: string }> {
        if (isAbsolute(configFilename) || configFilename.split(/[\\/]/).includes('..'))
            throw new InvalidConfigError("Config filename must be repository-relative and may not contain '..'.")
        let current = resolve(start)
        try {
            const fs = await import('node:fs/promises')
            if ((await fs.stat(current)).isFile()) current = dirname(current)
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

    static async load(path: string): Promise<ResolvedSourceConfig | GeneratedConfig> {
        let parsed: unknown
        try {
            parsed = JSON.parse(await readFile(path, 'utf8'))
        } catch (error) {
            throw new InvalidConfigError(`Could not read config file ${path}: ${(error as Error).message}`)
        }
        const generated = Boolean(parsed && typeof parsed === 'object' && 'workspace' in parsed)
        const validate = generated ? validateGenerated : validateSource
        if (!validate(parsed)) throw new InvalidConfigError(`Invalid config file ${path}: ${describe(validate.errors)}.`)
        const resolved = resolveLanguages(parsed as SourceConfig)
        return generated ? ({ ...resolved, workspace: (parsed as GeneratedConfig).workspace } as GeneratedConfig) : resolved
    }

    static async source(
        start: string,
        filename: string
    ): Promise<{ config: ResolvedSourceConfig; configPath: string; sourceRoot: string }> {
        const found = await this.discover(start, filename)
        const loaded = await this.load(found.configPath)
        if (this.isGenerated(loaded)) {
            this.validateWorkspace(loaded, found.root)
            const sourceFound = await this.discover(loaded.workspace.sourceRoot, filename)
            const source = await this.load(sourceFound.configPath)
            if (this.isGenerated(source))
                throw new InvalidConfigError(`Expected a source config file at ${sourceFound.configPath}.`)
            return { config: source, configPath: sourceFound.configPath, sourceRoot: sourceFound.root }
        }
        return { config: loaded, configPath: found.configPath, sourceRoot: found.root }
    }

    static integrity(metadata: Omit<WorkspaceMetadata, 'integrity'>): string {
        return hash(stableJson(metadata))
    }

    static resolvedHash(config: ResolvedSourceConfig): string {
        const { workspace: _workspace, ...resolved } = config
        return hash(stableJson(resolved))
    }

    static validateWorkspace(config: GeneratedConfig, root: string): void {
        const workspace = config.workspace
        if (resolve(workspace.leandir) !== resolve(root))
            throw new InvalidLeandirError(`Invalid workspace metadata in ${root}.`)
        if (workspace.resolvedConfigHash !== this.resolvedHash(config))
            throw new InvalidLeandirError(`Resolved configuration integrity check failed in ${root}.`)
        const { integrity, ...unsigned } = workspace
        if (integrity !== this.integrity(unsigned))
            throw new InvalidLeandirError(`Workspace metadata integrity check failed in ${root}.`)
    }

    static async validateLeandir(sourceRoot: string, leandir: string): Promise<void> {
        const source = await realpath(sourceRoot)
        const target = await realpath(dirname(leandir))
            .then(parent => resolve(parent, leandir.split(/[\\/]/).at(-1)!))
            .catch(() => resolve(leandir))
        if (target === source || target.startsWith(`${source}/`) || source.startsWith(`${target}/`))
            throw new InvalidConfigError('The leandir must be outside, and not an ancestor of, the source root.')
    }
}
