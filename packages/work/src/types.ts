export interface HumanFormatterConfig {
    command: string
    args: string[]
}
export interface SourceConfig {
    leandir: string
    ignore: string[]
    parser: Record<string, unknown>
    tokens: Record<string, unknown>
    source: Record<string, unknown>
    humanFormatter?: HumanFormatterConfig
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
    files: Record<string, FileRecord>
    integrity: string
}
export interface GeneratedConfig extends SourceConfig {
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
