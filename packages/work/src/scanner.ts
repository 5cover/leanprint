import { lstat, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { glob } from 'glob'
import { compareStrings, hash, stableJson } from './hash.js'
import type { EntrySnapshot, ResolvedSourceConfig } from './types.js'

export async function snapshot(path: string): Promise<EntrySnapshot> {
    let stat
    try {
        stat = await lstat(path)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
        throw error
    }
    const mode = stat.mode & 0o777
    if (stat.isFile()) return { kind: 'file', hash: hash(await readFile(path)), mode }
    if (stat.isSymbolicLink()) return { kind: 'symlink', target: await readlink(path), mode }
    const entryType = stat.isDirectory()
        ? 'directory'
        : stat.isSocket()
          ? 'socket'
          : stat.isFIFO()
            ? 'fifo'
            : stat.isCharacterDevice()
              ? 'character-device'
              : stat.isBlockDevice()
                ? 'block-device'
                : 'unknown'
    return { kind: 'special', entryType }
}

export function sameSnapshot(left: EntrySnapshot, right: EntrySnapshot): boolean {
    return stableJson(left) === stableJson(right)
}

export async function collectPaths(
    root: string,
    config: ResolvedSourceConfig,
    configFilename: string
): Promise<string[]> {
    const normalizedConfig = configFilename.replaceAll('\\', '/')
    return (await glob('**/*', { cwd: root, dot: true, nodir: true, follow: false, ignore: config.ignore }))
        .filter(path => path !== normalizedConfig)
        .sort(compareStrings)
}

export async function collectRegularLanguageFiles(
    root: string,
    config: ResolvedSourceConfig,
    configFilename: string,
    supports: (path: string) => boolean
): Promise<string[]> {
    const result: string[] = []
    for (const path of await collectPaths(root, config, configFilename)) {
        if (!supports(path)) continue
        if ((await snapshot(join(root, path))).kind === 'file') result.push(path)
    }
    return result
}
