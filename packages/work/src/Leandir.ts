import { mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import Config from './Config.js'
import Formatter from './Formatter.js'
import { ensureEmpty, replaceFile, replaceSymlink } from './filesystem.js'
import { hash } from './hash.js'
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

const WORKSPACE_VERSION = 1 as const
type StoredEntry = Exclude<EntrySnapshot, { kind: 'missing' | 'special' }>
type Prepared = { kind: 'file'; bytes: Buffer; mode: number } | { kind: 'symlink'; target: string }

function stored(entry: EntrySnapshot, path: string): StoredEntry {
    if (entry.kind === 'file' || entry.kind === 'symlink') return entry
    throw new InvalidLeandirError(
        `Unsupported ${entry.kind === 'special' ? entry.entryType : entry.kind} entry: ${path}`
    )
}

async function saveWorkspace(root: string, filename: string, config: GeneratedConfig): Promise<void> {
    const { integrity: _integrity, ...unsigned } = config.workspace
    config.workspace = { ...unsigned, integrity: Config.integrity(unsigned) }
    await replaceFile(join(root, filename), `${JSON.stringify(config, null, 2)}\n`)
}

export default class Leandir {
    static async create(
        start = process.cwd(),
        configFilename = 'leanprint.json',
        force = false
    ): Promise<GeneratedConfig> {
        const { config, configPath, sourceRoot } = await Config.source(start, configFilename)
        const target = resolve(sourceRoot, config.leandir)
        await Config.validateLeandir(sourceRoot, target)
        await ensureEmpty(target, force)

        const files: Record<string, FileRecord> = {}
        for (const relativePath of await collectPaths(sourceRoot, config, configFilename)) {
            const sourcePath = join(sourceRoot, relativePath)
            const targetPath = join(target, relativePath)
            const sourceEntry = stored(await snapshot(sourcePath), sourcePath)
            await mkdir(dirname(targetPath), { recursive: true })

            let transformed = false
            if (sourceEntry.kind === 'symlink') {
                await symlink(sourceEntry.target, targetPath)
            } else {
                const bytes = await readFile(sourcePath)
                const language = configuredLanguage(relativePath, config)
                transformed = Boolean(language)
                const output = language ? Buffer.from(language.leanify(bytes.toString('utf8'), sourcePath)) : bytes
                await replaceFile(targetPath, output, sourceEntry.mode)
            }
            files[relativePath] = {
                source: sourceEntry,
                lean: stored(await snapshot(targetPath), targetPath),
                transformed,
            }
        }

        const sessionConfig: ResolvedSourceConfig = { ...config, leandir: target }
        const unsigned: Omit<WorkspaceMetadata, 'integrity'> = {
            schemaVersion: WORKSPACE_VERSION,
            state: 'active',
            toolVersion: packageJson.version,
            sourceRoot,
            leandir: target,
            configFilename,
            createdAt: new Date().toISOString(),
            configHash: hash(await readFile(configPath)),
            resolvedConfigHash: Config.resolvedHash(sessionConfig),
            files,
        }
        const workspace: WorkspaceMetadata = { ...unsigned, integrity: Config.integrity(unsigned) }
        const generated: GeneratedConfig = { ...sessionConfig, workspace }
        await replaceFile(join(target, configFilename), `${JSON.stringify(generated, null, 2)}\n`)
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

    private static async statusOpened(
        opened: { root: string; config: GeneratedConfig },
        context: 'source project' | 'leandir',
        filename: string
    ): Promise<WorkspaceStatus> {
        const { config } = opened
        const workspace = config.workspace
        const changes: Change[] = []
        const currentPaths = new Set(await collectPaths(opened.root, config, filename))

        for (const [relativePath, record] of Object.entries(workspace.files)) {
            currentPaths.delete(relativePath)
            const leanCurrent = await snapshot(join(opened.root, relativePath))
            if (sameSnapshot(record.lean, leanCurrent)) continue
            const sourceCurrent = await snapshot(join(workspace.sourceRoot, relativePath))
            const change: Change = {
                path: relativePath,
                kind: leanCurrent.kind === 'missing' ? 'deleted' : 'modified',
                sourceExpected: record.source,
                sourceCurrent,
                leanCurrent,
            }
            if (leanCurrent.kind === 'special') change.conflict = `leandir entry is ${leanCurrent.entryType}`
            else if (!sameSnapshot(record.source, sourceCurrent))
                change.conflict = 'source entry changed after leandir creation'
            changes.push(change)
        }

        for (const relativePath of currentPaths) {
            const leanCurrent = await snapshot(join(opened.root, relativePath))
            const sourceCurrent = await snapshot(join(workspace.sourceRoot, relativePath))
            const expected: EntrySnapshot = { kind: 'missing' }
            const change: Change = {
                path: relativePath,
                kind: 'added',
                sourceExpected: expected,
                sourceCurrent,
                leanCurrent,
            }
            if (leanCurrent.kind === 'special') change.conflict = `leandir entry is ${leanCurrent.entryType}`
            else if (!sameSnapshot(expected, sourceCurrent))
                change.conflict = 'path was independently added to the source project'
            changes.push(change)
        }

        const sourceConfigPath = join(workspace.sourceRoot, workspace.configFilename)
        let currentConfigHash: string | undefined
        try {
            currentConfigHash = hash(await readFile(sourceConfigPath))
        } catch {
            currentConfigHash = undefined
        }
        if (currentConfigHash !== workspace.configHash)
            changes.push({
                path: workspace.configFilename,
                kind: 'modified',
                conflict: 'source config file changed after leandir creation',
            })

        return {
            context,
            state: workspace.state,
            sourceRoot: workspace.sourceRoot,
            leandir: workspace.leandir,
            changes,
            conflicts: changes.filter(change => change.conflict),
        }
    }

    static async status(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        const found = await Config.discover(start, filename)
        const loaded = await Config.load(found.configPath)
        if (loaded.kind === 'leandir') {
            Config.validateWorkspace(loaded.config, found.root)
            const opened = { root: found.root, config: loaded.config }
            return await this.statusOpened(opened, 'leandir', filename)
        }
        const opened = await this.open(resolve(found.root, loaded.config.leandir), filename)
        return await this.statusOpened(opened, 'source project', filename)
    }

    static async sync(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        const opened = await this.open(start, filename)
        if (opened.config.workspace.state !== 'active')
            throw new InvalidLeandirError(
                `Cannot synchronize a workspace in state "${opened.config.workspace.state}". Create a new leandir session.`
            )
        const status = await this.statusOpened(opened, 'leandir', filename)
        if (status.conflicts.length) throw new WorkspaceConflictError(status.conflicts)

        const prepared = new Map<string, Prepared>()
        for (const change of status.changes) {
            if (change.kind === 'deleted') continue
            const leanPath = join(opened.root, change.path)
            const leanCurrent = change.leanCurrent ?? (await snapshot(leanPath))
            if (leanCurrent.kind === 'symlink') {
                prepared.set(change.path, { kind: 'symlink', target: leanCurrent.target })
                continue
            }
            if (leanCurrent.kind !== 'file') throw new InvalidLeandirError(`Unsupported entry: ${leanPath}`)

            let bytes = await readFile(leanPath)
            const record = opened.config.workspace.files[change.path]
            const shouldTransform = record?.transformed ?? Boolean(configuredLanguage(change.path, opened.config))
            if (shouldTransform) {
                const language = configuredLanguage(change.path, opened.config)
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
            prepared.set(change.path, { kind: 'file', bytes, mode: leanCurrent.mode })
        }

        for (const change of status.changes) {
            if (!change.sourceExpected) continue
            const current = await snapshot(join(status.sourceRoot, change.path))
            if (!sameSnapshot(change.sourceExpected, current))
                throw new WorkspaceConflictError([
                    { ...change, conflict: 'source entry changed after synchronization planning' },
                ])
        }

        opened.config.workspace.state = 'applying'
        await saveWorkspace(opened.root, filename, opened.config)

        for (const change of status.changes) {
            const target = join(status.sourceRoot, change.path)
            if (change.kind === 'deleted') {
                await rm(target, { force: true })
                continue
            }
            const item = prepared.get(change.path)
            if (!item) throw new InvalidLeandirError(`Missing prepared synchronization entry for ${change.path}.`)
            if (item.kind === 'file') await replaceFile(target, item.bytes, item.mode)
            else await replaceSymlink(target, item.target)
        }

        opened.config.workspace.state = 'synchronized'
        await saveWorkspace(opened.root, filename, opened.config)
        return status
    }
}
