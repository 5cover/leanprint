import { mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import * as cfg from './config.js'
import * as formatter from './formatter.js'
import { ensureEmpty, replaceFile, replaceSymlink } from './filesystem.js'
import { compareStrings, hash } from './hash.js'
import { configuredLanguage } from './languages.js'
import { collectPaths, sameSnapshot, snapshot } from './scanner.js'
import type {
    Change,
    EntrySnapshot,
    FileRecord,
    ResolvedSourceConfig,
    WorkspaceLock,
    WorkspaceStatus,
} from './types.js'
import { FormatterError, InvalidLeandirError, WorkspaceConflictError } from './types.js'
import assert from 'node:assert'

const WORKSPACE_VERSION = 2 as const
type StoredEntry = Exclude<EntrySnapshot, { kind: 'missing' | 'special' }>
type Prepared =
    { kind: 'file'; bytes: Buffer; mode: number; transformed: boolean } | { kind: 'symlink'; target: string }
type BatchCandidate = {
    relativePath: string
    path: string
    leanBytes: Buffer
    mode: number
    language: NonNullable<ReturnType<typeof configuredLanguage>>
}

export { create, open, pull, push, status }

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

async function saveWorkspace(root: string, workspace: WorkspaceLock): Promise<void> {
    const { integrity: _integrity, ...unsigned } = workspace
    Object.assign(workspace, { ...unsigned, integrity: cfg.checksum(unsigned) })
    await replaceFile(join(root, cfg.WORKSPACE_LOCK_FILENAME), `${JSON.stringify(workspace, null, 2)}\n`)
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

async function create(
    start = process.cwd(),
    configFilename = 'leanprint.json',
    force = false
): Promise<WorkspaceLock> {
    const { config, sourceRoot } = await cfg.source(start, configFilename)
    const target = cfg.requireLeandir(config, configFilename)
    await cfg.validateLeandir(sourceRoot, target)
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

    const unsigned: Omit<WorkspaceLock, 'integrity'> = {
        schemaVersion: WORKSPACE_VERSION,
        state: 'active',
        toolVersion: packageJson.version,
        sourceRoot,
        leandir: target,
        configFilename,
        createdAt: new Date().toISOString(),
        resolvedConfigHash: cfg.resolvedHash(config),
        files,
    }
    const workspace: WorkspaceLock = { ...unsigned, integrity: cfg.checksum(unsigned) }
    await saveWorkspace(target, workspace)
    return workspace
}

async function open(
    start = process.cwd(),
    _filename = 'leanprint.json'
): Promise<{ root: string; workspace: WorkspaceLock }> {
    const found = await cfg.discoverWorkspace(start)
    if (!found.lockPath)
        throw new InvalidLeandirError(`No ${cfg.WORKSPACE_LOCK_FILENAME} found from ${start}.`)
    const workspace = await cfg.loadWorkspace(found.lockPath)
    cfg.validateWorkspace(workspace, found.root)
    return { root: found.root, workspace }
}

async function context(
    start: string,
    filename: string
): Promise<{
    opened: { root: string; workspace: WorkspaceLock }
    currentConfig: ResolvedSourceConfig
    context: WorkspaceStatus['context']
}> {
    const found = await cfg.discoverWorkspace(start)
    if (found.lockPath) {
        const opened = await open(found.root, filename)
        const source = await cfg.source(opened.workspace.sourceRoot, opened.workspace.configFilename)
        const currentLeandir = cfg.requireLeandir(source.config, filename)
        if (resolve(currentLeandir) !== resolve(found.root))
            throw new InvalidLeandirError(
                `Source configuration now points to ${currentLeandir}, not this leandir (${found.root}).`
            )
        return {
            opened,
            currentConfig: source.config,
            context: 'leandir',
        }
    }
    const source = await cfg.source(start, filename)
    const configuredLeandir = cfg.requireLeandir(source.config, filename)
    return {
        opened: await open(configuredLeandir, filename),
        currentConfig: source.config,
        context: 'source project',
    }
}

async function statusOpened(
    opened: { root: string; workspace: WorkspaceLock },
    currentConfig: ResolvedSourceConfig,
    context: WorkspaceStatus['context'],
    filename: string
): Promise<WorkspaceStatus> {
    const workspace = opened.workspace
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
            if (sourceChanged) change.conflict = change.conflict ?? 'path changed in both source project and leandir'
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
        configChanged: cfg.resolvedHash(currentConfig) !== workspace.resolvedConfigHash,
        changes: leandirChanges,
        conflicts,
    }
}

async function status(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
    const { opened, currentConfig, context: workspaceContext } = await context(start, filename)
    return await statusOpened(opened, currentConfig, workspaceContext, filename)
}

async function push(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
    const { opened, currentConfig, context: workspaceContext } = await context(start, filename)
    if (opened.workspace.state !== 'active')
        throw new InvalidLeandirError(
            `Cannot push to a workspace in state "${opened.workspace.state}". Create a new leandir session.`
        )
    const status = await statusOpened(opened, currentConfig, workspaceContext, filename)
    if (status.conflicts.length) throw new WorkspaceConflictError(status.conflicts, 'Push')

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
            throw new WorkspaceConflictError([{ ...change, conflict: 'path changed after push planning' }], 'Push')
    }

    opened.workspace.state = 'updating'
    await saveWorkspace(opened.root, opened.workspace)
    for (const change of status.sourceChanges) {
        const target = join(opened.root, change.path)
        const item = prepared.get(change.path)
        assert((change.kind === 'deleted') === (item === undefined))
        if (item === undefined) {
            await rm(target, { force: true })
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete opened.workspace.files[change.path]
            continue
        }
        await mkdir(dirname(target), { recursive: true })
        if (item.kind === 'file') await replaceFile(target, item.bytes, item.mode)
        else await replaceSymlink(target, item.target)
        opened.workspace.files[change.path] = {
            source: stored(await snapshot(join(status.sourceRoot, change.path)), change.path),
            lean: stored(await snapshot(target), target),
            transformed: item.kind === 'file' && item.transformed,
        }
    }

    const workspace = opened.workspace
    workspace.state = 'active'
    workspace.resolvedConfigHash = cfg.resolvedHash(currentConfig)
    await saveWorkspace(opened.root, workspace)
    return status
}

async function pull(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
    const { opened, currentConfig, context: workspaceContext } = await context(start, filename)
    if (opened.workspace.state !== 'active')
        throw new InvalidLeandirError(
            `Cannot pull from a workspace in state "${opened.workspace.state}". Create a new leandir session.`
        )
    const status = await statusOpened(opened, currentConfig, workspaceContext, filename)
    if (status.configChanged)
        throw new InvalidLeandirError(
            'Source configuration changed after the last push; run `leanprint push` first.'
        )
    if (status.conflicts.length) throw new WorkspaceConflictError(status.conflicts)

    const prepared = new Map<string, Prepared>(),
        batch: BatchCandidate[] = []
    for (const change of status.leandirChanges) {
        if (change.kind === 'deleted') continue
        const leanPath = join(opened.root, change.path)
        if (change.leanCurrent.kind === 'symlink') {
            prepared.set(change.path, { kind: 'symlink', target: change.leanCurrent.target })
            continue
        }
        if (change.leanCurrent.kind !== 'file') throw new InvalidLeandirError(`Unsupported entry: ${leanPath}`)
        const leanBytes = await readFile(leanPath)
        const record = opened.workspace.files[change.path]
        const language = configuredLanguage(change.path, currentConfig)
        if (record?.transformed ?? Boolean(language)) {
            if (!language) throw new InvalidLeandirError(`No configured language for ${change.path}.`)
            const leanSource = leanBytes.toString('utf8')
            language.leanify(leanSource, change.path)
            if (!currentConfig.humanFormatter)
                throw new InvalidLeandirError(`No human formatter configured for ${change.path}.`)
            if (currentConfig.humanFormatter.type === 'all') {
                batch.push({
                    relativePath: change.path,
                    path: leanPath,
                    leanBytes,
                    mode: change.leanCurrent.mode,
                    language,
                })
                continue
            }
            const humanSource = await formatter.formatOne(
                leanSource,
                join(status.sourceRoot, change.path),
                status.sourceRoot,
                currentConfig.humanFormatter
            )
            try {
                language.leanify(humanSource, change.path)
            } catch (error) {
                throw new FormatterError(`Human formatter produced invalid output for ${change.path}.`, {
                    cause: error,
                })
            }
            prepared.set(change.path, {
                kind: 'file',
                bytes: Buffer.from(humanSource),
                mode: change.leanCurrent.mode,
                transformed: true,
            })
            continue
        }
        prepared.set(change.path, {
            kind: 'file',
            bytes: leanBytes,
            mode: change.leanCurrent.mode,
            transformed: false,
        })
    }
    if (batch.length) {
        const humanFormatter = currentConfig.humanFormatter
        assert(humanFormatter?.type === 'all')
        try {
            await formatter.formatAll(
                batch.map(candidate => candidate.path),
                status.sourceRoot,
                humanFormatter
            )
            for (const candidate of batch) {
                const formatted = await snapshot(candidate.path)
                if (formatted.kind !== 'file')
                    throw new FormatterError(
                        `Human formatter did not leave a regular file at ${candidate.relativePath}.`
                    )
                const humanBytes = await readFile(candidate.path),
                    humanSource = humanBytes.toString('utf8')
                try {
                    candidate.language.leanify(humanSource, candidate.relativePath)
                } catch (error) {
                    throw new FormatterError(
                        `Human formatter produced invalid output for ${candidate.relativePath}.`,
                        { cause: error }
                    )
                }
                prepared.set(candidate.relativePath, {
                    kind: 'file',
                    bytes: humanBytes,
                    mode: candidate.mode,
                    transformed: true,
                })
            }
        } finally {
            for (const candidate of batch) await replaceFile(candidate.path, candidate.leanBytes, candidate.mode)
        }
    }
    for (const change of status.leandirChanges) {
        const current = await snapshot(join(status.sourceRoot, change.path))
        if (!sameSnapshot(change.sourceCurrent, current))
            throw new WorkspaceConflictError([
                { ...change, conflict: 'source entry changed after pull planning' },
            ])
    }

    opened.workspace.state = 'applying'
    await saveWorkspace(opened.root, opened.workspace)
    for (const change of status.leandirChanges) {
        const target = join(status.sourceRoot, change.path)
        const item = prepared.get(change.path)
        assert((change.kind === 'deleted') === (item === undefined))
        if (item === undefined) {
            await rm(target, { force: true })
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete opened.workspace.files[change.path]
            continue
        }
        await mkdir(dirname(target), { recursive: true })
        if (item.kind === 'file') await replaceFile(target, item.bytes, item.mode)
        else await replaceSymlink(target, item.target)
        opened.workspace.files[change.path] = {
            source: stored(await snapshot(target), target),
            lean: stored(await snapshot(join(opened.root, change.path)), change.path),
            transformed: item.kind === 'file' && item.transformed,
        }
    }
    opened.workspace.state = 'synchronized'
    await saveWorkspace(opened.root, opened.workspace)
    return status
}
