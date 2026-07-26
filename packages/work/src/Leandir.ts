import { lstat, mkdir, readFile, readlink, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { glob } from 'glob'
import Config from './Config.js'
import { atomicWrite, ensureEmpty } from './filesystem.js'
import { hash } from './hash.js'
import type { Change, FileRecord, GeneratedConfig, ResolvedSourceConfig, WorkspaceMetadata, WorkspaceStatus } from './types.js'
import { InvalidLeandirError, WorkspaceConflictError } from './types.js'
import Formatter from './Formatter.js'
import { configuredLanguage, leanify } from './languages.js'
const VERSION = '0.1.0',
    WORKSPACE_VERSION = 1
async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
    }
}
async function collect(root: string, config: ResolvedSourceConfig, configFilename: string): Promise<string[]> {
    return (await glob('**/*', { cwd: root, dot: true, nodir: true, follow: false, ignore: config.ignore }))
        .filter(p => p !== configFilename)
        .sort()
}
async function record(path: string, transformed: boolean, sourceBytes: Buffer, leanBytes: Buffer): Promise<FileRecord> {
    const stat = await lstat(path)
    return {
        kind: 'file',
        sourceHash: hash(sourceBytes),
        leanHash: hash(leanBytes),
        transformed,
        mode: stat.mode & 0o777,
    }
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
        for (const rel of await collect(sourceRoot, config, configFilename)) {
            const sourcePath = join(sourceRoot, rel),
                targetPath = join(target, rel),
                stat = await lstat(sourcePath)
            await mkdir(dirname(targetPath), { recursive: true })
            if (stat.isSymbolicLink()) {
                const link = await readlink(sourcePath)
                await symlink(link, targetPath)
                files[rel] = {
                    kind: 'symlink',
                    sourceHash: hash(link),
                    leanHash: hash(link),
                    transformed: false,
                    mode: stat.mode & 0o777,
                    target: link,
                }
                continue
            }
            if (!stat.isFile()) throw new InvalidLeandirError(`Unsupported special entry: ${sourcePath}`)
            const bytes = await readFile(sourcePath),
                language = configuredLanguage(rel, config),
                supported = Boolean(language),
                output = language ? Buffer.from(leanify(bytes.toString('utf8'), sourcePath, language)) : bytes
            await atomicWrite(targetPath, output, stat.mode & 0o777)
            files[rel] = await record(sourcePath, supported, bytes, output)
        }
        const configHash = hash(await readFile(configPath)),
            sessionConfig: ResolvedSourceConfig = { ...config, leandir: target }
        const unsigned: Omit<WorkspaceMetadata, 'integrity'> = {
            schemaVersion: WORKSPACE_VERSION,
            toolVersion: VERSION,
            sourceRoot,
            leandir: target,
            configFilename,
            createdAt: new Date().toISOString(),
            configHash,
            resolvedConfigHash: Config.resolvedHash(sessionConfig),
            files,
        }
        const workspace: WorkspaceMetadata = { ...unsigned, integrity: Config.integrity(unsigned) }
        const generated: GeneratedConfig = { ...sessionConfig, workspace }
        await atomicWrite(join(target, configFilename), `${JSON.stringify(generated, null, 2)}\n`)
        return generated
    }
    static async open(
        start = process.cwd(),
        filename = 'leanprint.json'
    ): Promise<{ root: string; config: GeneratedConfig }> {
        const found = await Config.discover(start, filename),
            loaded = await Config.load(found.configPath)
        if (!Config.isGenerated(loaded)) throw new InvalidLeandirError(`${found.root} is a source project, not a leandir.`)
        Config.validateWorkspace(loaded, found.root)
        return { root: found.root, config: loaded }
    }
    static async status(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        let context: 'source project' | 'leandir' = 'leandir',
            opened
        try {
            opened = await this.open(start, filename)
        } catch (error) {
            if (!(error instanceof InvalidLeandirError)) throw error
            context = 'source project'
            const { config } = await Config.source(start, filename)
            opened = await this.open(config.leandir, filename)
        }
        const { config } = opened,
            w = config.workspace,
            changes: Change[] = []
        const current = new Set(await collect(opened.root, config, filename))
        for (const [rel, record] of Object.entries(w.files)) {
            const leanPath = join(opened.root, rel)
            if (!current.has(rel)) {
                changes.push({ path: rel, kind: 'deleted' })
                continue
            }
            current.delete(rel)
            const stat = await lstat(leanPath)
            const leanHash = record.kind === 'symlink' ? hash(await readlink(leanPath)) : hash(await readFile(leanPath))
            if (leanHash !== record.leanHash) changes.push({ path: rel, kind: 'modified' })
            if (!stat.isFile() && !stat.isSymbolicLink())
                changes.push({ path: rel, kind: 'modified', conflict: 'entry kind is unsupported' })
        }
        for (const rel of current) changes.push({ path: rel, kind: 'added' })
        for (const change of changes) {
            const sourcePath = join(w.sourceRoot, change.path),
                record = w.files[change.path]
            if (change.kind === 'added') {
                if (await exists(sourcePath)) change.conflict = 'path was independently added to the source project'
            } else if (record) {
                if (!(await exists(sourcePath))) change.conflict = 'source path was deleted'
                else {
                    const currentHash =
                        record.kind === 'symlink' ? hash(await readlink(sourcePath)) : hash(await readFile(sourcePath))
                    if (currentHash !== record.sourceHash)
                        change.conflict = 'source path changed after leandir creation'
                }
            }
        }
        return {
            context,
            sourceRoot: w.sourceRoot,
            leandir: w.leandir,
            changes,
            conflicts: changes.filter(c => c.conflict),
        }
    }
    static async sync(start = process.cwd(), filename = 'leanprint.json'): Promise<WorkspaceStatus> {
        const opened = await this.open(start, filename),
            status = await this.status(start, filename)
        if (status.conflicts.length) throw new WorkspaceConflictError(status.conflicts)
        const prepared = new Map<string, { bytes: Buffer; mode: number }>()
        for (const change of status.changes) {
            if (change.kind === 'deleted') continue
            const leanPath = join(opened.root, change.path),
                stat = await lstat(leanPath)
            if (!stat.isFile()) continue
            let bytes = await readFile(leanPath)
            const language = configuredLanguage(change.path, opened.config)
            if (language) {
                leanify(bytes.toString('utf8'), change.path, language)
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
                leanify(bytes.toString('utf8'), change.path, language)
            }
            prepared.set(change.path, { bytes, mode: stat.mode & 0o777 })
        }
        for (const change of status.changes) {
            const target = join(status.sourceRoot, change.path)
            if (change.kind === 'deleted') await rm(target)
            else {
                const item = prepared.get(change.path)
                if (item) await atomicWrite(target, item.bytes, item.mode)
            }
        }
        const files: Record<string, FileRecord> = {}
        for (const rel of await collect(opened.root, opened.config, filename)) {
            const leanPath = join(opened.root, rel),
                sourcePath = join(status.sourceRoot, rel),
                stat = await lstat(leanPath)
            if (stat.isSymbolicLink()) {
                const target = await readlink(leanPath)
                files[rel] = {
                    kind: 'symlink',
                    sourceHash: hash(target),
                    leanHash: hash(target),
                    transformed: false,
                    mode: stat.mode & 0o777,
                    target,
                }
                continue
            }
            const leanBytes = await readFile(leanPath),
                sourceBytes = await readFile(sourcePath)
            files[rel] = {
                kind: 'file',
                sourceHash: hash(sourceBytes),
                leanHash: hash(leanBytes),
                transformed: Boolean(configuredLanguage(rel, opened.config)),
                mode: stat.mode & 0o777,
            }
        }
        const { integrity: _oldIntegrity, ...unsignedOld } = opened.config.workspace
        const unsigned = { ...unsignedOld, files }
        opened.config.workspace = { ...unsigned, integrity: Config.integrity(unsigned) }
        await atomicWrite(join(opened.root, filename), `${JSON.stringify(opened.config, null, 2)}\n`)
        return status
    }
}
