import { createHash } from 'node:crypto'
export const hash = (value: Uint8Array | string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`
export function compareStrings(left: string, right: string): -1 | 0 | 1 {
    return left < right ? -1 : left > right ? 1 : 0
}
export function stableJson(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Stable JSON cannot serialize a non-finite number.')
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
        return `{${Object.entries(value)
            .sort(([left], [right]) => compareStrings(left, right))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
            .join(',')}}`
    throw new TypeError(`Stable JSON cannot serialize ${typeof value}.`)
}
