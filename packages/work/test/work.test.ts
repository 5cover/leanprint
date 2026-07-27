import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import test from 'node:test'
import * as cfg from '../src/config.js'
import { compareStrings, stableJson } from '../src/hash.js'
import * as leandir from '../src/leandir.js'
import * as prompt from '../src/prompt.js'
import * as stats from '../src/stats/stats.js'
import type { GeneratedConfig } from '../src/types.js'
const exec = promisify(execFile)
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'leanprint-test-')),
        lean = join(root, '..', `${root.split('/').at(-1)}.lean`)
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            ignore: ['ignored/**'],
            humanFormatter: { command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'] },
        })
    )
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer: number = 42;\n')
    await writeFile(join(root, 'README.md'), 'hello\n')
    return { root, lean }
}
test('discovers config and generates deterministic prompt', async () => {
    const { root } = await fixture(),
        found = await cfg.discover(join(root, 'src'))
    assert.equal(found.root, root)
    const { config } = await cfg.source(root, 'leanprint.json')
    assert.match(prompt.generate(config, true), /generated LeanPrint leandir/)
    assert.equal(prompt.generate(config, true), prompt.generate(config, true))
})
test('uses locale-independent ordinal string ordering', () => {
    assert.deepEqual(['z', 'ä', 'a'].sort(compareStrings), ['a', 'z', 'ä'])
    assert.equal(stableJson({ ä: 1, z: 2, a: 3 }), '{"a":3,"z":2,"ä":1}')
})
test('applies schema defaults while retaining additional properties', async () => {
    const { root } = await fixture()
    const path = join(root, 'leanprint.json')
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean`, languages: { ecmascript: {} }, extension: true }))
    const loaded = await cfg.load(path)
    assert.equal(loaded.kind, 'source')
    assert.deepEqual(loaded.config.ignore, ['.git/', 'node_modules/', 'dist/', 'coverage/'])
    assert.equal(loaded.config.languages.ecmascript?.tokens.semicolons, false)
    assert.equal(loaded.config.languages.ecmascript.source.indent, 2)
    assert.equal(loaded.config.extension, true)
})
test('defaults absent languages to every registered language and rejects unregistered domains', async () => {
    const { root } = await fixture()
    const path = join(root, 'leanprint.json')
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean` }))
    const loaded = await cfg.load(path)
    assert.equal(loaded.kind, 'source')
    assert(loaded.config.languages.ecmascript)
    assert(loaded.config.languages.json)
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean`, languages: { imaginary: {} } }))
    await assert.rejects(cfg.load(path), /not registered/)
})
test('an explicitly empty languages map enables every registered language', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, 'data.json'), '{ "answer": 42 }\n')
    await writeFile(join(root, 'leanprint.json'), JSON.stringify({ leandir: lean, languages: {} }))
    await leandir.create(root)
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer:number=42\n')
    assert.equal(await readFile(join(lean, 'data.json'), 'utf8'), '{"answer":42}\n')
})

test('uses an in-memory default config at the explicit root when discovery finds no file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leanprint-configless-'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'index.ts'), 'export const answer = 42;\n')
    await writeFile(join(root, 'data.json'), '{ "items": [1, 2, 3] }\n')
    await writeFile(join(root, 'node_modules', 'ignored.ts'), 'export const ignored = true;\n')

    const found = await cfg.discover(root)
    assert.equal(found.root, root)
    assert.equal(found.configPath, undefined)
    const resolved = await cfg.source(root, 'leanprint.json')
    assert.equal(resolved.sourceRoot, root)
    assert.equal(resolved.config.leandir, undefined)
    assert(resolved.config.languages.ecmascript)
    assert(resolved.config.languages.json)
    assert.deepEqual(resolved.config.ignore, ['.git/', 'node_modules/', 'dist/', 'coverage/'])
    assert.match(prompt.generate(resolved.config, false), /For JSON files/)

    const result = await stats.tiktoken({ root, modelOrEncoding: 'o200k_base' })
    assert.equal(result.files, 2)
    assert(result.tokensSaved > 0)
    await assert.rejects(leandir.create(root), /No leandir is configured/)
})

test('accepts an empty source config but guards commands that require leandir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leanprint-empty-config-'))
    await writeFile(join(root, 'leanprint.json'), '{}')
    const loaded = await cfg.load(join(root, 'leanprint.json'))
    assert.equal(loaded.kind, 'source')
    assert(loaded.config.languages.ecmascript)
    assert(loaded.config.languages.json)
    await assert.rejects(leandir.create(root), /add a non-empty "leandir" property to leanprint.json/)
})
test('creates, reports edits, and synchronizes a leandir', async () => {
    const { root, lean } = await fixture()
    const generated = await leandir.create(root)
    assert.equal(generated.workspace.sourceRoot, root)
    assert.equal(await readFile(join(lean, 'README.md'), 'utf8'), 'hello\n')
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer:number=42\n')
    let status = await leandir.status(lean)
    assert.equal(status.changes.length, 0)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    status = await leandir.status(lean)
    assert.deepEqual(
        status.changes.map(c => c.kind),
        ['modified']
    )
    await leandir.sync(lean)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer:number=43\n')
    assert.equal((await leandir.open(lean)).config.workspace.state, 'synchronized')
    await assert.rejects(leandir.sync(lean), /state "synchronized"/)
})
test('synchronizes symlink, kind, and mode changes without following links', async () => {
    const { root, lean } = await fixture()
    await symlink('README.md', join(root, 'link'))
    await leandir.create(root)

    await unlink(join(lean, 'link'))
    await symlink('src/index.ts', join(lean, 'link'))
    await unlink(join(lean, 'README.md'))
    await symlink('src/index.ts', join(lean, 'README.md'))
    await chmod(join(lean, 'src', 'index.ts'), 0o755)

    const status = await leandir.status(lean)
    assert.equal(status.conflicts.length, 0)
    assert.equal(status.changes.length, 3)
    await leandir.sync(lean)
    assert.equal(await readlink(join(root, 'link')), 'src/index.ts')
    assert.equal(await readlink(join(root, 'README.md')), 'src/index.ts')
    assert.equal((await lstat(join(root, 'src', 'index.ts'))).mode & 0o777, 0o755)
})
test('rejects edits to resolved generated configuration', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    const path = join(lean, 'leanprint.json')
    const generated = JSON.parse(await readFile(path, 'utf8')) as GeneratedConfig
    assert(generated.languages.ecmascript)
    generated.languages.ecmascript.source.indent = 8
    await writeFile(path, JSON.stringify(generated))
    await assert.rejects(leandir.open(lean), /configuration integrity/)
})
test('reports all concurrent source conflicts before writing', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    await writeFile(join(lean, 'README.md'), 'AI edit\n')
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer: number = 44;\n')
    await writeFile(join(root, 'README.md'), 'human edit\n')

    const status = await leandir.status(lean)
    assert.equal(status.conflicts.length, 2)
    await assert.rejects(leandir.sync(lean), /Synchronization has 2 conflict/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 44;\n')
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'human edit\n')
    assert.equal((await leandir.open(lean)).config.workspace.state, 'active')
})
test('formatter failure aborts before source-project writes', async () => {
    const { root, lean } = await fixture()
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                command: process.execPath,
                args: ['-e', "process.stderr.write('formatter failed');process.exit(2)"],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')

    await assert.rejects(leandir.sync(lean), /formatter failed/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
    assert.equal((await leandir.open(lean)).config.workspace.state, 'active')
})

test('loads ordered gitignore files and applies inline rules last', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, '.firstignore'), '# comment\n*.log\n\\#literal\n!important.log\n')
    await writeFile(join(root, '.secondignore'), 'important.log\n')
    await writeFile(join(root, 'drop.log'), 'drop')
    await writeFile(join(root, 'important.log'), 'keep')
    await writeFile(join(root, '#literal'), 'drop')
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: {},
            ignoreFile: ['.firstignore', '.secondignore'],
            ignore: ['!important.log', '.firstignore', '.secondignore'],
        })
    )
    await leandir.create(root)
    assert.equal(await readFile(join(lean, 'important.log'), 'utf8'), 'keep')
    await assert.rejects(readFile(join(lean, 'drop.log')), /ENOENT/)
    await assert.rejects(readFile(join(lean, '#literal')), /ENOENT/)
})

test('resolves ignore files from the config directory and reports invalid entries', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, '.ignore'), 'README.md\n')
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({ leandir: lean, languages: {}, ignoreFile: '.ignore' })
    )
    await leandir.create(join(root, 'src'))
    await assert.rejects(readFile(join(lean, 'README.md')), /ENOENT/)

    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({ leandir: lean, languages: {}, ignoreFile: 'missing.ignore' })
    )
    await assert.rejects(cfg.load(join(root, 'leanprint.json')), /Could not read ignore file/)
    await writeFile(join(root, 'leanprint.json'), JSON.stringify({ leandir: lean, languages: {}, ignoreFile: 'src' }))
    await assert.rejects(cfg.load(join(root, 'leanprint.json')), /not a regular file/)
})

test('updates source changes from either root while preserving unrelated AI edits', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, 'remove.txt'), 'remove')
    await symlink('README.md', join(root, 'link'))
    await leandir.create(root)
    await writeFile(join(lean, 'README.md'), 'AI edit\n')
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer: number = 44;\n')
    await writeFile(join(root, 'added.bin'), Buffer.from([0, 1, 2]))
    await unlink(join(root, 'remove.txt'))
    await unlink(join(root, 'link'))
    await symlink('src/index.ts', join(root, 'link'))
    await chmod(join(root, 'src', 'index.ts'), 0o755)

    const before = await leandir.status(root)
    assert.equal(before.sourceChanges.length, 4)
    assert.equal(before.leandirChanges.length, 1)
    await leandir.update(lean)
    assert.equal(await readFile(join(lean, 'README.md'), 'utf8'), 'AI edit\n')
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer:number=44\n')
    assert.deepEqual(await readFile(join(lean, 'added.bin')), Buffer.from([0, 1, 2]))
    await assert.rejects(readFile(join(lean, 'remove.txt')), /ENOENT/)
    assert.equal(await readlink(join(lean, 'link')), 'src/index.ts')
    assert.equal((await lstat(join(lean, 'src', 'index.ts'))).mode & 0o777, 0o755)
    const after = await leandir.status(root)
    assert.equal(after.sourceChanges.length, 0)
    assert.equal(after.leandirChanges.length, 1)
})

test('update reports every same-path conflict and writes nothing', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    await writeFile(join(root, 'README.md'), 'human\n')
    await writeFile(join(lean, 'README.md'), 'AI\n')
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 1\n')
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer=2\n')
    await assert.rejects(leandir.update(root), /Update has 2 conflict/)
    assert.equal(await readFile(join(lean, 'README.md'), 'utf8'), 'AI\n')
    assert.equal((await leandir.open(lean)).config.workspace.state, 'active')
})

test('resolved hashes ignore JSON formatting but detect semantic and ignore-file changes', async () => {
    const { root, lean } = await fixture()
    const configPath = join(root, 'leanprint.json')
    await writeFile(join(root, '.ignore'), 'ignored.txt\n')
    await writeFile(configPath, JSON.stringify({ leandir: lean, languages: { ecmascript: {} }, ignoreFile: '.ignore' }))
    await leandir.create(root)
    const source: unknown = JSON.parse(await readFile(configPath, 'utf8'))
    await writeFile(configPath, `${JSON.stringify(source, null, 4)}\n`)
    assert.equal((await leandir.status(root)).configChanged, false)
    await writeFile(join(root, '.ignore'), 'other.txt\n')
    assert.equal((await leandir.status(root)).configChanged, true)
    await assert.rejects(leandir.sync(root), /leanprint update/)
})

test('formatter-only update enables recovery and sync accepts a source path', async () => {
    const { root, lean } = await fixture()
    const configPath = join(root, 'leanprint.json')
    await writeFile(
        configPath,
        JSON.stringify({ leandir: lean, languages: { ecmascript: {} }, ignore: ['ignored/**'] })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=45\n')
    await assert.rejects(leandir.sync(root), /No human formatter/)
    await writeFile(
        configPath,
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            ignore: ['ignored/**'],
            humanFormatter: { command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'] },
        })
    )
    await leandir.update(root)
    assert.equal((await leandir.status(root)).leandirChanges.length, 1)
    await leandir.sync(root)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer:number=45\n')
})

test('update reconciles ignore and language projection changes', async () => {
    const { root, lean } = await fixture()
    const configPath = join(root, 'leanprint.json')
    await writeFile(join(root, 'hidden.txt'), 'hidden')
    await leandir.create(root)
    await writeFile(
        configPath,
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: { source: { spaceAroundOperators: true } } },
            ignore: ['hidden.txt'],
            humanFormatter: { command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'] },
        })
    )
    const pending = await leandir.status(root)
    assert.equal(pending.configChanged, true)
    assert.deepEqual(
        pending.sourceChanges.map(change => change.path),
        ['hidden.txt', 'src/index.ts']
    )
    await leandir.update(root)
    await assert.rejects(readFile(join(lean, 'hidden.txt')), /ENOENT/)
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer:number = 42\n')
})

test('CLI help documents commands, direction, examples, and safety', async () => {
    const cli = join(import.meta.dirname, '..', 'src', 'cli.ts')
    const root = await exec(process.execPath, ['--import', 'tsx', cli, '--help'])
    assert.match(root.stdout, /update \[path\].*Push source-project/s)
    assert.match(root.stdout, /sync \[path\].*Pull AI changes/s)
    const update = await exec(process.execPath, ['--import', 'tsx', cli, 'update', '--help'])
    assert.match(update.stdout, /Example:/)
    assert.match(update.stdout, /Safety:/)
    const sync = await exec(process.execPath, ['--import', 'tsx', cli, 'sync', '--help'])
    assert.match(sync.stdout, /source project or leandir path/)
    assert.match(sync.stdout, /Run update first/)
})
