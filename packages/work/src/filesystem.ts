import { chmod, mkdir, open, rename, rm, symlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

function temporarySibling(path: string): string {
    return `${path}.leanprint-${process.pid}-${randomUUID()}`
}

export async function replaceFile(path: string, data: string | Uint8Array, mode?: number): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = temporarySibling(path)
    try {
        const handle = await open(temporary, 'wx', mode)
        try {
            await handle.writeFile(data)
            await handle.sync()
        } finally {
            await handle.close()
        }
        if (mode !== undefined) await chmod(temporary, mode)
        await rename(temporary, path)
    } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
    }
}

export async function replaceSymlink(path: string, target: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = temporarySibling(path)
    try {
        await symlink(target, temporary)
        await rename(temporary, path)
    } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
    }
}

export async function ensureEmpty(path: string, force = false): Promise<void> {
    let entries: string[] = []
    try {
        const fs = await import('node:fs/promises')
        entries = await fs.readdir(path)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (entries.length && !force) throw new Error(`Leandir already exists and is non-empty: ${path}`)
    if (entries.length) await rm(path, { recursive: true })
    await mkdir(path, { recursive: true })
}
