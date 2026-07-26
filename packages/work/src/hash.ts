import { createHash } from 'node:crypto'
export const hash = (value: Uint8Array | string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`
export function compareStrings(left: string, right: string): -1 | 0 | 1 {
    return left < right ? -1 : left > right ? 1 : 0
}
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (value && typeof value === 'object')
        return `{${Object.entries(value)
            .sort(([left], [right]) => compareStrings(left, right))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
            .join(',')}}`
    return JSON.stringify(value)
}
