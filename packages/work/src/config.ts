import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import { ecmascriptConfigSchema, getLanguage, getLanguages, jsonConfigSchema } from 'leanprint'
import { hash, stableJson } from './hash.js'
import sourceSchema from './schemas/SourceConfig.json' with { type: 'json' }
import workspaceSchema from './schemas/WorkspaceLock.json' with { type: 'json' }
import type { ResolvedSourceConfig, SourceConfig, WorkspaceLock } from './types.js'
import { InvalidConfigError, InvalidLeandirError } from './types.js'

const ajv = new Ajv2020({ allErrors: true, useDefaults: true, coerceTypes: false, removeAdditional: false })
ajv.addSchema(ecmascriptConfigSchema)
ajv.addSchema(jsonConfigSchema)
ajv.addSchema(sourceSchema)
const validateSource: ValidateFunction<SourceConfig> = ajv.compile(sourceSchema)
const validateWorkspaceLock: ValidateFunction<WorkspaceLock> = ajv.compile(workspaceSchema)
export const WORKSPACE_LOCK_FILENAME = 'leandir-lock.json'

export async function discover(
    start = process.cwd(),
    configFilename = 'leanprint.json'
): Promise<{ configPath?: string; root: string }> {
    if (isAbsolute(configFilename) || configFilename.split(/[\\/]/).includes('..'))
        throw new InvalidConfigError("Config filename must be repository-relative and may not contain '..'.")
    let current = resolve(start)
    try {
        const fs = await import('node:fs/promises')
        if ((await fs.stat(current)).isFile()) current = dirname(current)
    } catch {
        /* A nonexistent start path is handled by upward discovery. */
    }
    const fallbackRoot = current
    while (true) {
        const candidate = resolve(current, configFilename)
        try {
            await readFile(candidate)
            return { configPath: candidate, root: current }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const parent = dirname(current)
        if (parent === current) return { root: fallbackRoot }
        current = parent
    }
}

export async function load(path: string): Promise<{ kind: 'source'; config: ResolvedSourceConfig }> {
    let parsed: unknown
    try {
        parsed = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
        throw new InvalidConfigError(`Could not read config file ${path}: ${(error as Error).message}`)
    }
    if (!validateSource(parsed))
        throw new InvalidConfigError(`Invalid config file ${path}: ${describe(validateSource.errors)}.`)
    const resolved = await resolveSource(parsed, path)
    return { kind: 'source', config: resolved }
}

export async function loadWorkspace(path: string): Promise<WorkspaceLock> {
    let parsed: unknown
    try {
        parsed = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
        throw new InvalidLeandirError(`Could not read workspace lock ${path}: ${(error as Error).message}`)
    }
    if (!validateWorkspaceLock(parsed))
        throw new InvalidLeandirError(`Invalid workspace lock ${path}: ${describe(validateWorkspaceLock.errors)}.`)
    return parsed
}

export async function discoverWorkspace(start = process.cwd()): Promise<{ lockPath?: string; root: string }> {
    const found = await discover(start, WORKSPACE_LOCK_FILENAME)
    return { root: found.root, ...(found.configPath ? { lockPath: found.configPath } : {}) }
}

export async function source(
    start: string,
    filename: string
): Promise<{ config: ResolvedSourceConfig; configPath?: string; sourceRoot: string }> {
    const workspaceFound = await discoverWorkspace(start)
    if (workspaceFound.lockPath) {
        const workspace = await loadWorkspace(workspaceFound.lockPath)
        validateWorkspace(workspace, workspaceFound.root)
        return await source(workspace.sourceRoot, workspace.configFilename)
    }
    const found = await discover(start, filename)
    if (!found.configPath) {
        const empty: unknown = {}
        if (!validateSource(empty))
            throw new InvalidConfigError(`Invalid default configuration: ${describe(validateSource.errors)}.`)
        return {
            config: await resolveSource(empty, resolve(found.root, filename)),
            sourceRoot: found.root,
        }
    }
    const loaded = await load(found.configPath)
    return {
        config: resolveLeandir(loaded.config, dirname(found.configPath)),
        configPath: found.configPath,
        sourceRoot: found.root,
    }
}

export function requireLeandir(config: ResolvedSourceConfig, filename = 'leanprint.json'): string {
    if (!config.leandir)
        throw new InvalidConfigError(`No leandir is configured; add a non-empty "leandir" property to ${filename}.`)
    return config.leandir
}

export function checksum(metadata: Omit<WorkspaceLock, 'integrity'>): string {
    return hash(stableJson(metadata))
}

export function resolvedHash(config: ResolvedSourceConfig): string {
    const { workspace: _workspace, ...resolved } = config
    return hash(stableJson(resolved))
}

export function validateWorkspace(workspace: WorkspaceLock, root: string): void {
    if (resolve(workspace.leandir) !== resolve(root))
        throw new InvalidLeandirError(`Invalid workspace metadata in ${root}.`)
    const { integrity, ...unsigned } = workspace
    if (integrity !== checksum(unsigned))
        throw new InvalidLeandirError(`Workspace metadata integrity check failed in ${root}.`)
}

export async function validateLeandir(sourceRoot: string, leandir: string): Promise<void> {
    const source = await realpath(sourceRoot)
    const target = await realpath(dirname(leandir))
        .then(parent => resolve(parent, leandir.split(/[\\/]/).at(-1) ?? ''))
        .catch(() => resolve(leandir))
    if (target === source || target.startsWith(`${source}/`) || source.startsWith(`${target}/`))
        throw new InvalidConfigError('The leandir must be outside, and not an ancestor of, the source root.')
}

async function resolveSource(config: SourceConfig, path: string): Promise<ResolvedSourceConfig> {
    const filenames = config.ignoreFile
        ? Array.isArray(config.ignoreFile)
            ? config.ignoreFile
            : [config.ignoreFile]
        : []
    const rules: string[] =
        config.ignore === undefined && config.ignoreFile === undefined
            ? ['.git/', 'node_modules/', 'dist/', 'coverage/']
            : []
    for (const filename of filenames) {
        const ignorePath = isAbsolute(filename) ? filename : resolve(dirname(path), filename)
        try {
            if (!(await stat(ignorePath)).isFile())
                throw new InvalidConfigError(`Ignore file is not a regular file: ${ignorePath}`)
            rules.push(await readFile(ignorePath, 'utf8'))
        } catch (error) {
            if (error instanceof InvalidConfigError) throw error
            throw new InvalidConfigError(`Could not read ignore file ${ignorePath}: ${(error as Error).message}`)
        }
    }
    if (config.ignore) rules.push(...config.ignore)
    return resolveLanguages(config, rules)
}

function resolveLanguages(config: SourceConfig, rules: string[]): ResolvedSourceConfig {
    const languages: ResolvedSourceConfig['languages'] = {}
    const configured = Object.entries(config.languages ?? {})
    const entries = configured.length ? configured : getLanguages().map(language => [language.id, {}] as const)
    for (const [id, value] of entries) {
        const language = getLanguage(id)
        if (!language) throw new InvalidConfigError(`Language "${id}" is configured but not registered.`)
        languages[id] = language.resolveConfig(value)
    }
    const { humanFormatter, ignoreFile: _ignoreFile, ...source } = config
    const resolved: ResolvedSourceConfig = {
        ...source,
        ignore: rules,
        languages,
    }
    if (humanFormatter) {
        const type = humanFormatter.type ?? 'one',
            args = humanFormatter.args ?? [],
            required = type === 'one' ? '{file}' : '{files}',
            forbidden = type === 'one' ? '{files}' : '{file}'
        if (args.filter(arg => arg === required).length !== 1)
            throw new InvalidConfigError(`humanFormatter type "${type}" requires exactly one standalone ${required} argument.`)
        if (args.includes(forbidden))
            throw new InvalidConfigError(`humanFormatter type "${type}" does not accept the ${forbidden} argument.`)
        resolved.humanFormatter = { type, command: humanFormatter.command, args }
    }
    return resolved
}

function resolveLeandir(config: ResolvedSourceConfig, base: string): ResolvedSourceConfig {
    return config.leandir ? { ...config, leandir: resolve(base, config.leandir) } : config
}

function describe(errors: ErrorObject[] | null | undefined): string {
    return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ')
}
