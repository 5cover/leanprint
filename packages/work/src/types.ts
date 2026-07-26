import type { ResolvedEcmascriptConfig, ResolvedLanguageConfig } from 'leanprint'
import type { GeneratedConfig as AuthoredGeneratedConfig } from './schemas/GeneratedConfig.generated.js'
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

export type WorkspaceMetadata = AuthoredGeneratedConfig['workspace']
export type FileRecord = WorkspaceMetadata['files'][string]
type StoredEntry = FileRecord['source']
export type EntrySnapshot = { kind: 'missing' } | StoredEntry | { kind: 'special'; entryType: string }

export interface GeneratedConfig extends ResolvedSourceConfig {
    workspace: WorkspaceMetadata
}

export type LoadedConfig =
    { kind: 'source'; config: ResolvedSourceConfig } | { kind: 'leandir'; config: GeneratedConfig }

export interface Change {
    path: string
    kind: 'added' | 'modified' | 'deleted'
    conflict?: string
    sourceExpected: EntrySnapshot
    sourceCurrent: EntrySnapshot
    leanCurrent: EntrySnapshot
}

export interface WorkspaceStatus {
    context: 'source project' | 'leandir'
    state: WorkspaceMetadata['state']
    sourceRoot: string
    leandir: string
    sourceChanges: Change[]
    leandirChanges: Change[]
    configChanged: boolean
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
    constructor(public readonly conflicts: Change[], operation = 'Synchronization') {
        super(
            `${operation} has ${conflicts.length} conflict(s):\n${conflicts.map(c => `- ${c.path}: ${c.conflict}`).join('\n')}`
        )
    }
}
export class FormatterError extends Error {
    override name = 'FormatterError'
}
