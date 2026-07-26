import { createHash } from 'node:crypto'
export const hash = (value: Uint8Array | string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (value && typeof value === 'object')
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
            .join(',')}}`
    return JSON.stringify(value)
}
