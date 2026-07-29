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
import type { WorkspaceLock } from '../src/types.js'
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
            humanFormatter: { command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)', '{file}'] },
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
test('applies schema defaults', async () => {
    const { root } = await fixture()
    const path = join(root, 'leanprint.json')
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean`, languages: { ecmascript: {} }, extension: true }))
    const loaded = await cfg.load(path)
    assert.equal(loaded.kind, 'source')
    assert.deepEqual(loaded.config.ignore, [])
    assert.equal(loaded.config.languages.ecmascript?.tokens.semicolons, false)
    assert.equal(loaded.config.languages.ecmascript.source.indent, 2)
    assert.equal(loaded.config.extension, true)
})
test('validates standalone formatter placeholders by formatter type', async () => {
    const { root, lean } = await fixture()
    const path = join(root, 'leanprint.json')
    const formatter = (type: 'one' | 'all', args: string[]) => ({
        leandir: lean,
        humanFormatter: { type, command: 'formatter', args },
    })
    await writeFile(path, JSON.stringify(formatter('one', ['--stdin-filepath={file}'])))
    await assert.rejects(cfg.load(path), /requires exactly one standalone \{file\}/)
    await writeFile(path, JSON.stringify(formatter('one', ['{file}', '{files}'])))
    await assert.rejects(cfg.load(path), /does not accept the \{files\}/)
    await writeFile(path, JSON.stringify(formatter('all', ['{files}', '{files}'])))
    await assert.rejects(cfg.load(path), /requires exactly one standalone \{files\}/)
    await writeFile(path, JSON.stringify(formatter('all', ['{file}'])))
    await assert.rejects(cfg.load(path), /requires exactly one standalone \{files\}/)
    await writeFile(
        path,
        JSON.stringify({ leandir: lean, humanFormatter: { command: 'formatter', args: ['{file}'] } })
    )
    const loaded = await cfg.load(path)
    assert.equal(loaded.config.humanFormatter?.type, 'one')
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
    await writeFile(join(root, 'index.ts'), 'export const answer = 42;\n')
    await writeFile(join(root, 'data.json'), '{ "items": [1, 2, 3] }\n')

    const found = await cfg.discover(root)
    assert.equal(found.root, root)
    assert.equal(found.configPath, undefined)
    const resolved = await cfg.source(root, 'leanprint.json')
    assert.equal(resolved.sourceRoot, root)
    assert.equal(resolved.config.leandir, undefined)
    assert(resolved.config.languages.ecmascript)
    assert(resolved.config.languages.json)
    assert.deepEqual(resolved.config.ignore, [])
    assert.match(prompt.generate(resolved.config, false), /For JSON files/)

    const result = await stats.tiktoken({ root, modelOrEncoding: 'o200k_base' })
    assert.equal(result.files, 2)
    assert(result.tokensSaved > 0)
    assert.deepEqual(Object.keys(result.languages), ['ecmascript', 'json'])
    assert.equal(result.languages.ecmascript?.files, 1)
    assert.equal(result.languages.json?.files, 1)
    assert.equal(
        Object.values(result.languages).reduce((total, language) => total + language.originalTokens, 0),
        result.originalTokens
    )
    assert.equal(
        Object.values(result.languages).reduce((total, language) => total + language.leanTokens, 0),
        result.leanTokens
    )
    const cli = join(import.meta.dirname, '..', 'src', 'cli.ts'),
        output = await exec(process.execPath, [
            '--import',
            'tsx',
            cli,
            'stats',
            'tiktoken',
            'o200k_base',
            '--root',
            root,
        ])
    assert.match(output.stdout, /Language: ecmascript\nFiles: 1/)
    assert.match(output.stdout, /Language: json\nFiles: 1/)
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
test('creates, reports edits, and pulls from a leandir', async () => {
    const { root, lean } = await fixture()
    const workspace = await leandir.create(root)
    assert.equal(workspace.sourceRoot, root)
    await assert.rejects(readFile(join(lean, 'leanprint.json'), 'utf8'), { code: 'ENOENT' })
    const lockText = await readFile(join(lean, 'leandir-lock.json'), 'utf8'),
        lock = JSON.parse(lockText) as Record<string, unknown>
    assert.equal(lock.sourceRoot, root)
    assert.equal('workspace' in lock, false)
    assert.equal('languages' in lock, false)
    assert.equal(lockText, `${JSON.stringify(lock, null, 2)}\n`)
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
    await leandir.pull(lean)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer:number=43\n')
    assert.equal((await leandir.open(lean)).workspace.state, 'synchronized')
    await assert.rejects(leandir.pull(lean), /state "synchronized"/)
})
test('pull applies leandir-only changes while leaving source-only changes untouched', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    await writeFile(join(root, 'README.md'), 'human edit\n')
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')

    const status = await leandir.status(lean)
    assert.deepEqual(status.sourceChanges.map(change => change.path), ['README.md'])
    assert.deepEqual(status.leandirChanges.map(change => change.path), ['src/index.ts'])
    assert.deepEqual(status.conflicts, [])

    await leandir.pull(lean)
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'human edit\n')
    assert.equal(await readFile(join(lean, 'README.md'), 'utf8'), 'hello\n')
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer:number=43\n')
})
test('pulls symlink, kind, and mode changes without following links', async () => {
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
    await leandir.pull(lean)
    assert.equal(await readlink(join(root, 'link')), 'src/index.ts')
    assert.equal(await readlink(join(root, 'README.md')), 'src/index.ts')
    assert.equal((await lstat(join(root, 'src', 'index.ts'))).mode & 0o777, 0o755)
})
test('rejects edits to workspace lock metadata', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    const path = join(lean, 'leandir-lock.json')
    const workspace = JSON.parse(await readFile(path, 'utf8')) as WorkspaceLock
    workspace.state = 'synchronized'
    await writeFile(path, JSON.stringify(workspace))
    await assert.rejects(leandir.open(lean), /metadata integrity/)
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
    await assert.rejects(leandir.pull(lean), /Pull has 2 conflict/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 44;\n')
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'human edit\n')
    assert.equal((await leandir.open(lean)).workspace.state, 'active')
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
                args: ['-e', "process.stderr.write('formatter failed');process.exit(2)", '{file}'],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')

    await assert.rejects(leandir.pull(lean), /formatter failed/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
    assert.equal((await leandir.open(lean)).workspace.state, 'active')
})

test('identifies invalid human formatter stdout and writes nothing', async () => {
    const { root, lean } = await fixture()
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                command: process.execPath,
                args: ['-e', "process.stdout.write('Already up to date\\n');process.stdin.pipe(process.stdout)", '{file}'],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')

    await assert.rejects(leandir.pull(lean), /Human formatter produced invalid output for src\/index\.ts/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
    assert.equal((await leandir.open(lean)).workspace.state, 'active')
})

test('detects source changes made during formatter preflight before ordinary writes', async () => {
    const { root, lean } = await fixture()
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                command: process.execPath,
                args: [
                    '-e',
                    "require('node:fs').writeFileSync(process.argv[1], 'external change\\n');process.stdin.pipe(process.stdout)",
                    '{file}',
                ],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    await writeFile(join(lean, 'README.md'), 'AI edit\n')

    await assert.rejects(leandir.pull(lean), /source entry changed after pull planning/)
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'hello\n')
    assert.equal((await leandir.open(lean)).workspace.state, 'active')
})

test('refreshes workspace snapshots after a successful pull', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    await writeFile(join(lean, 'added.txt'), 'added\n')
    await leandir.pull(lean)

    const status = await leandir.status(lean)
    assert.equal(status.state, 'synchronized')
    assert.deepEqual(status.sourceChanges, [])
    assert.deepEqual(status.leandirChanges, [])
    assert.deepEqual(status.conflicts, [])
})

test('batch formatter expands files as argv entries, ignores stdout, and restores lean files', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, 'src', 'with space.ts'), 'export const spaced: number = 1;\n')
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                type: 'all',
                command: process.execPath,
                args: [
                    '-e',
                    "const fs=require('node:fs');for(const file of process.argv.slice(1))fs.appendFileSync(file,'// formatted\\n');process.stdout.write('Already up to date\\n')",
                    '{files}',
                ],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    await writeFile(join(lean, 'src', 'with space.ts'), 'export const spaced:number=2\n')
    await chmod(join(lean, 'src', 'index.ts'), 0o755)
    const indexLean = await readFile(join(lean, 'src', 'index.ts')),
        spacedLean = await readFile(join(lean, 'src', 'with space.ts'))

    await leandir.pull(lean)

    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), `${indexLean.toString()}// formatted\n`)
    assert.equal(await readFile(join(root, 'src', 'with space.ts'), 'utf8'), `${spacedLean.toString()}// formatted\n`)
    assert.deepEqual(await readFile(join(lean, 'src', 'index.ts')), indexLean)
    assert.deepEqual(await readFile(join(lean, 'src', 'with space.ts')), spacedLean)
    assert.equal((await lstat(join(lean, 'src', 'index.ts'))).mode & 0o777, 0o755)
})

test('batch formatter failure restores every lean file and writes no source files', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, 'src', 'second.ts'), 'export const second: number = 1;\n')
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                type: 'all',
                command: process.execPath,
                args: [
                    '-e',
                    "const fs=require('node:fs');for(const file of process.argv.slice(1))fs.writeFileSync(file,'damaged');process.stderr.write('failed');process.exit(2)",
                    '{files}',
                ],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    await writeFile(join(lean, 'src', 'second.ts'), 'export const second:number=2\n')
    const indexLean = await readFile(join(lean, 'src', 'index.ts')),
        secondLean = await readFile(join(lean, 'src', 'second.ts'))

    await assert.rejects(leandir.pull(lean), /failed/)
    assert.deepEqual(await readFile(join(lean, 'src', 'index.ts')), indexLean)
    assert.deepEqual(await readFile(join(lean, 'src', 'second.ts')), secondLean)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
    assert.equal(await readFile(join(root, 'src', 'second.ts'), 'utf8'), 'export const second: number = 1;\n')
})

test('invalid batch formatter output restores all lean files and writes nothing', async () => {
    const { root, lean } = await fixture()
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                type: 'all',
                command: process.execPath,
                args: ['-e', "require('node:fs').writeFileSync(process.argv[1],'const =')", '{files}'],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    const leanBytes = await readFile(join(lean, 'src', 'index.ts'))

    await assert.rejects(leandir.pull(lean), /Human formatter produced invalid output/)
    assert.deepEqual(await readFile(join(lean, 'src', 'index.ts')), leanBytes)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
})

test('batch formatter restores a file deleted by the subprocess', async () => {
    const { root, lean } = await fixture()
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            humanFormatter: {
                type: 'all',
                command: process.execPath,
                args: ['-e', "require('node:fs').unlinkSync(process.argv[1])", '{files}'],
            },
        })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    const leanBytes = await readFile(join(lean, 'src', 'index.ts'))

    await assert.rejects(leandir.pull(lean), /did not leave a regular file/)
    assert.deepEqual(await readFile(join(lean, 'src', 'index.ts')), leanBytes)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
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
    await leandir.push(lean)
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

test('push reports every same-path conflict and writes nothing', async () => {
    const { root, lean } = await fixture()
    await leandir.create(root)
    await writeFile(join(root, 'README.md'), 'human\n')
    await writeFile(join(lean, 'README.md'), 'AI\n')
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 1\n')
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer=2\n')
    await assert.rejects(leandir.push(root), /Push has 2 conflict/)
    assert.equal(await readFile(join(lean, 'README.md'), 'utf8'), 'AI\n')
    assert.equal((await leandir.open(lean)).workspace.state, 'active')
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
    await assert.rejects(leandir.pull(root), /leanprint push/)
})

test('formatter-only push enables recovery and pull accepts a source path', async () => {
    const { root, lean } = await fixture()
    const configPath = join(root, 'leanprint.json')
    await writeFile(
        configPath,
        JSON.stringify({ leandir: lean, languages: { ecmascript: {} }, ignore: ['ignored/**'] })
    )
    await leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=45\n')
    await assert.rejects(leandir.pull(root), /No human formatter/)
    await writeFile(
        configPath,
        JSON.stringify({
            leandir: lean,
            languages: { ecmascript: {} },
            ignore: ['ignored/**'],
            humanFormatter: { command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)', '{file}'] },
        })
    )
    await leandir.push(root)
    assert.equal((await leandir.status(root)).leandirChanges.length, 1)
    await leandir.pull(root)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer:number=45\n')
})

test('push reconciles ignore and language projection changes', async () => {
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
            humanFormatter: { command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)', '{file}'] },
        })
    )
    const pending = await leandir.status(root)
    assert.equal(pending.configChanged, true)
    assert.deepEqual(
        pending.sourceChanges.map(change => change.path),
        ['hidden.txt', 'src/index.ts']
    )
    await leandir.push(root)
    await assert.rejects(readFile(join(lean, 'hidden.txt')), /ENOENT/)
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer:number = 42\n')
})

test('CLI help documents commands, direction, examples, and safety', async () => {
    const cli = join(import.meta.dirname, '..', 'src', 'cli.ts')
    const root = await exec(process.execPath, ['--import', 'tsx', cli, '--help'])
    assert.match(root.stdout, /push \[path\].*Push source-project/s)
    assert.match(root.stdout, /pull \[path\].*Pull AI changes/s)
    assert.doesNotMatch(root.stdout, /\bupdate \[path\]/)
    assert.doesNotMatch(root.stdout, /\bsync \[path\]/)
    const push = await exec(process.execPath, ['--import', 'tsx', cli, 'push', '--help'])
    assert.match(push.stdout, /Example:/)
    assert.match(push.stdout, /Safety:/)
    const pull = await exec(process.execPath, ['--import', 'tsx', cli, 'pull', '--help'])
    assert.match(pull.stdout, /source project or leandir path/)
    assert.match(pull.stdout, /Run push first/)
})
