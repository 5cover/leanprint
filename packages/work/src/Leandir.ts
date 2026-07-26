import { mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import Config from './Config.js'
import Formatter from './Formatter.js'
import { ensureEmpty, replaceFile, replaceSymlink } from './filesystem.js'
import { compareStrings, hash } from './hash.js'
import { configuredLanguage } from './languages.js'
import { collectPaths, sameSnapshot, snapshot } from './scanner.js'
import type {
    Change,
    EntrySnapshot,
    FileRecord,
    GeneratedConfig,
    ResolvedSourceConfig,
    WorkspaceMetadata,
    WorkspaceStatus,
} from './types.js'
import { InvalidLeandirError, WorkspaceConflictError } from './types.js'
import assert from 'node:assert'

const WORKSPACE_VERSION = 2 as const
type StoredEntry = Exclude<EntrySnapshot, { kind: 'missing' | 'special' }>
type Prepared =
    { kind: 'file'; bytes: Buffer; mode: number; transformed: boolean } | { kind: 'symlink'; target: string }

function stored(entry: EntrySnapshot, path: string): StoredEntry {
    if (entry.kind === 'file' || entry.kind === 'symlink') return entry
    throw new InvalidLeandirError(
        `Unsupported ${entry.kind === 'special' ? entry.entryType : entry.kind} entry: ${path}`
    )
}

function changeKind(expected: EntrySnapshot, current: EntrySnapshot): Change['kind'] {
    if (current.kind === 'missing') return 'deleted'
    return expected.kind === 'missing' ? 'added' : 'modified'
}

async function saveWorkspace(root: string, filename: string, config: GeneratedConfig): Promise<void> {
    const { integrity: _integrity, ...unsigned } = config.workspace
    config.workspace = { ...unsigned, integrity: Config.integrity(unsigned) }
    await replaceFile(join(root, filename), `${JSON.stringify(config, null, 2)}\n`)
}

async function prepareSource(path: string, source: EntrySnapshot, config: ResolvedSourceConfig): Promise<Prepared> {
    if (source.kind === 'symlink') return { kind: 'symlink', target: source.target }
    if (source.kind !== 'file') throw new InvalidLeandirError(`Unsupported source entry: ${path}`)
    const bytes = await readFile(path)
    const language = configuredLanguage(path, config)
    return language
        ? {
              kind: 'file',
              bytes: Buffer.from(language.leanify(bytes.toString('utf8'), path)),
              mode: source.mode,
              transformed: true,
          }
        : { kind: 'file', bytes, mode: source.mode, transformed: false }
}

function preparedSnapshot(item: Prepared): StoredEntry {
    return item.kind === 'symlink'
        ? { kind: 'symlink', target: item.target, mode: 0o777 }
        : { kind: 'file', hash: hash(item.bytes), mode: item.mode }
}

export default class Leandir {
    static async create(
        start = process.cwd(),
        configFilename = 'leanprint.json',
        force = false
    ): Promise<GeneratedConfig> {
        const { config, sourceRoot } = await Config.source(start, configFilename)
        const target = config.leandir
        await Config.validateLeandir(sourceRoot, target)
        await ensureEmpty(target, force)

        const files: Record<string, FileRecord> = {}
        for (const relativePath of await collectPaths(sourceRoot, config, configFilename)) {
            const sourcePath = join(sourceRoot, relativePath)
            const targetPath = join(target, relativePath)
            const sourceEntry = stored(await snapshot(sourcePath), sourcePath)
            const item = await prepareSource(sourcePath, sourceEntry, config)
            await mkdir(dirname(targetPath), { recursive: true })
            if (item.kind === 'symlink') await symlink(item.target, targetPath)
            else await replaceFile(targetPath, item.bytes, item.mode)
            files[relativePath] = {
                source: sourceEntry,
                lean: stored(await snapshot(targetPath), targetPath),
                transformed: item.kind === 'file' && item.transformed,
            }
        }

        const unsigned: Omit<WorkspaceMetadata, 'integrity'> = {
            schemaVersion: WORKSPACE_VERSION,
            state: 'active',
            toolVersion: packageJson.version,
            sourceRoot,
            leandir: target,
            configFilename,
            createdAt: new Date().toISOString(),
            resolvedConfigHash: Config.resolvedHash(config),
            files,
        }
        const workspace: WorkspaceMetadata = { ...unsigned, integrity: Config.integrity(unsigned) }
        const generated: GeneratedConfig = { ...config, workspace }
        await saveWorkspace(target, configFilename, generated)
        return generated
    }

    static async open(
        start = process.cwd(),
        filename = 'leanprint.json'
    ): Promise<{ root: string; config: GeneratedConfig }> {
        const found = await Config.discover(start, filename)
        const loaded = await Config.load(found.configPath)
        if (loaded.kind !== 'leandir')
            throw new InvalidLeandirError(`${found.root} is a source project, not a leandir.`)
        Config.validateWorkspace(loaded.config, found.root)
        return { root: found.root, config: loaded.config }
    }

    private static async context(
        start: string,
        filename: string
    ): Promise<{
        opened: { root: string; config: GeneratedConfig }
        currentConfig: ResolvedSourceConfig
        context: WorkspaceStatus['context']
    }> {
        const found = await Config.discover(start, filename)
        const loaded = await Config.load(found.configPath)
        if (loaded.kind === 'leandir') {
            Config.validateWorkspace(loaded.config, found.root)
            const source = await Config.source(found.root, filename)
            if (resolve(source.config.leandir) !== resolve(found.root))
                throw new InvalidLeandirError(
                    `Source configuration now points to ${source.config.leandir}, not this leandir (${found.root}).`
                )
            return {
                opened: { root: found.root, config: loaded.config },
                currentConfig: source.config,
                context: 'leandir',
            }
        }
        const source = await Config.source(found.root, filename)
        return {
            opened: await this.open(source.config.leandir, filename),
            currentConfig: source.config,
            context: 'source project',
        }
    }

    private static async statusOpened(
        opened: { root: string; config: GeneratedConfig },
        currentConfig: ResolvedSourceConfig,
        context: WorkspaceStatus['context'],
        filename: string
    ): Promise<WorkspaceStatus> {
        const workspace = opened.config.workspace
        const sourcePaths = new Set(await collectPaths(workspace.sourceRoot, currentConfig, filename))
        const leanPaths = new Set(await collectPaths(opened.root, currentConfig, filename))
        const paths = new Set([...Object.keys(workspace.files), ...sourcePaths, ...leanPaths])
        const sourceChanges: Change[] = []
        const leandirChanges: Change[] = []
        const conflicts: Change[] = []

        for (const relativePath of [...paths].sort(compareStrings)) {
            const record = workspace.files[relativePath]
            const sourceExpected: EntrySnapshot = record?.source ?? { kind: 'missing' }
            const leanExpected: EntrySnapshot = record?.lean ?? { kind: 'missing' }
            const sourceCurrent = sourcePaths.has(relativePath)
                ? await snapshot(join(workspace.sourceRoot, relativePath))
                : { kind: 'missing' as const }
            const leanCurrent = await snapshot(join(opened.root, relativePath))
            let projectionChanged = false
            if (sourceCurrent.kind !== 'missing' && sourceCurrent.kind !== 'special') {
                const item = await prepareSource(join(workspace.sourceRoot, relativePath), sourceCurrent, currentConfig)
                projectionChanged = !sameSnapshot(preparedSnapshot(item), leanExpected)
            }
            const sourceChanged = !sameSnapshot(sourceExpected, sourceCurrent) || projectionChanged
            const leanChanged = !sameSnapshot(leanExpected, leanCurrent)
            if (sourceChanged) {
                const change: Change = {
                    path: relativePath,
                    kind: changeKind(sourceExpected, sourceCurrent),
                    sourceExpected,
                    sourceCurrent,
                    leanCurrent,
                }
                if (sourceCurrent.kind === 'special') change.conflict = `source entry is ${sourceCurrent.entryType}`
                if (leanChanged) change.conflict = change.conflict ?? 'path changed in both source project and leandir'
                sourceChanges.push(change)
                if (change.conflict) conflicts.push(change)
            }
            if (leanChanged) {
                const change: Change = {
                    path: relativePath,
                    kind: changeKind(leanExpected, leanCurrent),
                    sourceExpected,
                    sourceCurrent,
                    leanCurrent,
                }
                if (leanCurrent.kind === 'special') change.conflict = `leandir entry is ${leanCurrent.entryType}`
                if (sourceChanged)
                    change.conflict = change.conflict ?? 'path changed in both source project and leandir'
                leandirChanges.push(change)
                if (change.conflict && !conflicts.some(item => item.path === change.path)) conflicts.push(change)
            }
        }

        return {
            context,
            state: workspace.state,
            sourceRoot: workspace.sourceRoot,
            leandir: workspace.leandir,
            sourceChanges,
            leandirChanges,
            configChanged: Config.resolvedHash(currentConfig) !== workspace.resolvedConfigHash,
            changes: leandirChanges,
            conflicts,
        }
    }

    static async status(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        const { opened, currentConfig, context } = await this.context(start, filename)
        return await this.statusOpened(opened, currentConfig, context, filename)
    }

    static async update(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        const { opened, currentConfig, context } = await this.context(start, filename)
        if (opened.config.workspace.state !== 'active')
            throw new InvalidLeandirError(
                `Cannot update a workspace in state "${opened.config.workspace.state}". Create a new leandir session.`
            )
        const status = await this.statusOpened(opened, currentConfig, context, filename)
        if (status.conflicts.length) throw new WorkspaceConflictError(status.conflicts, 'Update')

        const prepared = new Map<string, Prepared>()
        for (const change of status.sourceChanges) {
            if (change.kind === 'deleted') continue
            const sourceCurrent = change.sourceCurrent
            prepared.set(
                change.path,
                await prepareSource(join(status.sourceRoot, change.path), sourceCurrent, currentConfig)
            )
        }
        const includedNow = new Set(await collectPaths(status.sourceRoot, currentConfig, filename))
        for (const change of status.sourceChanges) {
            const sourceNow = includedNow.has(change.path)
                ? await snapshot(join(status.sourceRoot, change.path))
                : { kind: 'missing' as const }
            const leanNow = await snapshot(join(opened.root, change.path))
            if (!sameSnapshot(change.sourceCurrent, sourceNow) || !sameSnapshot(change.leanCurrent, leanNow))
                throw new WorkspaceConflictError(
                    [{ ...change, conflict: 'path changed after update planning' }],
                    'Update'
                )
        }

        opened.config.workspace.state = 'updating'
        await saveWorkspace(opened.root, filename, opened.config)
        for (const change of status.sourceChanges) {
            const target = join(opened.root, change.path)
            const item = prepared.get(change.path)
            assert((change.kind === 'deleted') === (item === undefined))
            if (item === undefined) {
                await rm(target, { force: true })
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete opened.config.workspace.files[change.path]
                continue
            }
            await mkdir(dirname(target), { recursive: true })
            if (item.kind === 'file') await replaceFile(target, item.bytes, item.mode)
            else await replaceSymlink(target, item.target)
            opened.config.workspace.files[change.path] = {
                source: stored(await snapshot(join(status.sourceRoot, change.path)), change.path),
                lean: stored(await snapshot(target), target),
                transformed: item.kind === 'file' && item.transformed,
            }
        }

        const workspace = opened.config.workspace
        workspace.state = 'active'
        workspace.resolvedConfigHash = Config.resolvedHash(currentConfig)
        const generated: GeneratedConfig = { ...currentConfig, workspace }
        await saveWorkspace(opened.root, filename, generated)
        return status
    }

    static async sync(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        const { opened, currentConfig, context } = await this.context(start, filename)
        if (opened.config.workspace.state !== 'active')
            throw new InvalidLeandirError(
                `Cannot synchronize a workspace in state "${opened.config.workspace.state}". Create a new leandir session.`
            )
        const status = await this.statusOpened(opened, currentConfig, context, filename)
        if (status.configChanged)
            throw new InvalidLeandirError(
                'Source configuration changed after the last refresh; run `leanprint update` first.'
            )
        if (status.conflicts.length) throw new WorkspaceConflictError(status.conflicts)
        if (status.sourceChanges.length)
            throw new InvalidLeandirError(
                'Source project has changes pending; run `leanprint update` before `leanprint sync`.'
            )

        const prepared = new Map<string, Prepared>()
        for (const change of status.leandirChanges) {
            if (change.kind === 'deleted') continue
            const leanPath = join(opened.root, change.path)
            if (change.leanCurrent.kind === 'symlink') {
                prepared.set(change.path, { kind: 'symlink', target: change.leanCurrent.target })
                continue
            }
            if (change.leanCurrent.kind !== 'file') throw new InvalidLeandirError(`Unsupported entry: ${leanPath}`)
            let bytes = await readFile(leanPath)
            const record = opened.config.workspace.files[change.path]
            const language = configuredLanguage(change.path, opened.config)
            if (record?.transformed ?? Boolean(language)) {
                if (!language) throw new InvalidLeandirError(`No configured language for ${change.path}.`)
                language.leanify(bytes.toString('utf8'), change.path)
                if (!opened.config.humanFormatter)
                    throw new InvalidLeandirError(`No human formatter configured for ${change.path}.`)
                bytes = Buffer.from(
                    await Formatter.format(
                        bytes.toString('utf8'),
                        join(status.sourceRoot, change.path),
                        status.sourceRoot,
                        opened.config.humanFormatter
                    )
                )
                language.leanify(bytes.toString('utf8'), change.path)
            }
            prepared.set(change.path, {
                kind: 'file',
                bytes,
                mode: change.leanCurrent.mode,
                transformed: Boolean(language),
            })
        }
        for (const change of status.leandirChanges) {
            const current = await snapshot(join(status.sourceRoot, change.path))
            if (!sameSnapshot(change.sourceExpected, current))
                throw new WorkspaceConflictError([
                    { ...change, conflict: 'source entry changed after synchronization planning' },
                ])
        }

        opened.config.workspace.state = 'applying'
        await saveWorkspace(opened.root, filename, opened.config)
        for (const change of status.leandirChanges) {
            const target = join(status.sourceRoot, change.path)
            const item = prepared.get(change.path)
            assert((change.kind === 'deleted') === (item === undefined))
            if (item === undefined) {
                await rm(target, { force: true })
                continue
            }
            await mkdir(dirname(target), { recursive: true })
            if (item.kind === 'file') await replaceFile(target, item.bytes, item.mode)
            else await replaceSymlink(target, item.target)
        }
        opened.config.workspace.state = 'synchronized'
        await saveWorkspace(opened.root, filename, opened.config)
        return status
    }
}
