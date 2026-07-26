import { chmod, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
export async function atomicWrite(path: string, data: string | Uint8Array, mode?: number): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.leanprint-${process.pid}-${Date.now()}`
    await writeFile(temp, data)
    if (mode !== undefined) await chmod(temp, mode)
    await rename(temp, path)
}
export async function ensureEmpty(path: string, force = false): Promise<void> {
    let entries: string[] = []
    try {
        const dir = await import('node:fs/promises')
        entries = await dir.readdir(path)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (entries.length && !force) throw new Error(`Leandir already exists and is non-empty: ${path}`)
    if (entries.length) await rm(path, { recursive: true })
    await mkdir(path, { recursive: true })
}
export async function assertReadable(path: string): Promise<void> {
    const handle = await open(path, 'r')
    await handle.close()
}
