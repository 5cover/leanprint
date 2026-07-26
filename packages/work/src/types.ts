import type { ResolvedEcmascriptConfig, ResolvedLanguageConfig } from 'leanprint'
export type { SourceConfig } from './schemas/SourceConfig.generated.js'

export interface HumanFormatterConfig {
    command: string
    args: string[]
}

export interface ResolvedSourceConfig {
    $schema?: string
    leandir: string
    ignore: string[]
    languages: {
        ecmascript?: ResolvedEcmascriptConfig
        [id: string]: ResolvedLanguageConfig | undefined
    }
    humanFormatter?: HumanFormatterConfig
    [key: string]: unknown
}

export interface FileRecord {
    kind: 'file' | 'symlink'
    sourceHash: string
    leanHash: string
    transformed: boolean
    mode: number
    target?: string
}

export interface WorkspaceMetadata {
    schemaVersion: 1
    toolVersion: string
    sourceRoot: string
    leandir: string
    configFilename: string
    createdAt: string
    configHash: string
    resolvedConfigHash: string
    files: Record<string, FileRecord>
    integrity: string
}

export interface GeneratedConfig extends ResolvedSourceConfig {
    workspace: WorkspaceMetadata
}

export interface Change {
    path: string
    kind: 'added' | 'modified' | 'deleted'
    conflict?: string
}

export interface WorkspaceStatus {
    context: 'source project' | 'leandir'
    sourceRoot: string
    leandir: string
    changes: Change[]
    conflicts: Change[]
}

export class InvalidConfigError extends Error {
    override name = 'InvalidConfigError'
}
export class InvalidLeandirError extends Error {
    override name = 'InvalidLeandirError'
}
export class LeandirExistsError extends Error {
    override name = 'LeandirExistsError'
}
export class WorkspaceConflictError extends Error {
    override name = 'WorkspaceConflictError'
    constructor(public readonly conflicts: Change[]) {
        super(
            `Synchronization has ${conflicts.length} conflict(s):\n${conflicts.map(c => `- ${c.path}: ${c.conflict}`).join('\n')}`
        )
    }
}
export class FormatterError extends Error {
    override name = 'FormatterError'
}
