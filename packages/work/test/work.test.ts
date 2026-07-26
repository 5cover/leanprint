import assert from 'node:assert/strict'
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import Config from '../src/Config.js'
import { compareStrings, stableJson } from '../src/hash.js'
import Leandir from '../src/Leandir.js'
import Prompt from '../src/Prompt.js'
import { InvalidConfigError, type GeneratedConfig } from '../src/types.js'
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
        found = await Config.discover(join(root, 'src'))
    assert.equal(found.root, root)
    const { config } = await Config.source(root, 'leanprint.json')
    assert.match(Prompt.generate(config, true), /generated LeanPrint leandir/)
    assert.equal(Prompt.generate(config, true), Prompt.generate(config, true))
})
test('uses locale-independent ordinal string ordering', () => {
    assert.deepEqual(['z', 'ä', 'a'].sort(compareStrings), ['a', 'z', 'ä'])
    assert.equal(stableJson({ ä: 1, z: 2, a: 3 }), '{"a":3,"z":2,"ä":1}')
})
test('applies schema defaults while retaining additional properties', async () => {
    const { root } = await fixture()
    const path = join(root, 'leanprint.json')
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean`, languages: { ecmascript: {} }, extension: true }))
    const loaded = await Config.load(path)
    assert.equal(loaded.kind, 'source')
    assert.deepEqual(loaded.config.ignore, ['.git/**', 'node_modules/**', 'dist/**', 'coverage/**'])
    assert.equal(loaded.config.languages.ecmascript?.tokens.semicolons, false)
    assert.equal(loaded.config.languages.ecmascript?.source.indent, 2)
    assert.equal(loaded.config.extension, true)
})
test('requires languages and rejects unregistered language domains', async () => {
    const { root } = await fixture()
    const path = join(root, 'leanprint.json')
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean` }))
    await assert.rejects(Config.load(path), InvalidConfigError)
    await writeFile(path, JSON.stringify({ leandir: `${root}.lean`, languages: { imaginary: {} } }))
    await assert.rejects(Config.load(path), /not registered/)
})
test('an explicitly empty languages map leaves source files unchanged', async () => {
    const { root, lean } = await fixture()
    await writeFile(join(root, 'leanprint.json'), JSON.stringify({ leandir: lean, languages: {} }))
    await Leandir.create(root)
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
})
test('creates, reports edits, and synchronizes a leandir', async () => {
    const { root, lean } = await fixture()
    const generated = await Leandir.create(root)
    assert.equal(generated.workspace.sourceRoot, root)
    assert.equal(await readFile(join(lean, 'README.md'), 'utf8'), 'hello\n')
    assert.equal(await readFile(join(lean, 'src', 'index.ts'), 'utf8'), 'export const answer:number=42\n')
    let status = await Leandir.status(lean)
    assert.equal(status.changes.length, 0)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    status = await Leandir.status(lean)
    assert.deepEqual(
        status.changes.map(c => c.kind),
        ['modified']
    )
    await Leandir.sync(lean)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer:number=43\n')
    assert.equal((await Leandir.open(lean)).config.workspace.state, 'synchronized')
    await assert.rejects(Leandir.sync(lean), /state "synchronized"/)
})
test('synchronizes symlink, kind, and mode changes without following links', async () => {
    const { root, lean } = await fixture()
    await symlink('README.md', join(root, 'link'))
    await Leandir.create(root)

    await unlink(join(lean, 'link'))
    await symlink('src/index.ts', join(lean, 'link'))
    await unlink(join(lean, 'README.md'))
    await symlink('src/index.ts', join(lean, 'README.md'))
    await chmod(join(lean, 'src', 'index.ts'), 0o755)

    const status = await Leandir.status(lean)
    assert.equal(status.conflicts.length, 0)
    assert.equal(status.changes.length, 3)
    await Leandir.sync(lean)
    assert.equal(await readlink(join(root, 'link')), 'src/index.ts')
    assert.equal(await readlink(join(root, 'README.md')), 'src/index.ts')
    assert.equal((await lstat(join(root, 'src', 'index.ts'))).mode & 0o777, 0o755)
})
test('rejects edits to resolved generated configuration', async () => {
    const { root, lean } = await fixture()
    await Leandir.create(root)
    const path = join(lean, 'leanprint.json')
    const generated = JSON.parse(await readFile(path, 'utf8')) as GeneratedConfig
    generated.languages.ecmascript!.source.indent = 8
    await writeFile(path, JSON.stringify(generated))
    await assert.rejects(Leandir.open(lean), /configuration integrity/)
})
test('reports all concurrent source conflicts before writing', async () => {
    const { root, lean } = await fixture()
    await Leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')
    await writeFile(join(lean, 'README.md'), 'AI edit\n')
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer: number = 44;\n')
    await writeFile(join(root, 'README.md'), 'human edit\n')

    const status = await Leandir.status(lean)
    assert.equal(status.conflicts.length, 2)
    await assert.rejects(Leandir.sync(lean), /Synchronization has 2 conflict/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 44;\n')
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'human edit\n')
    assert.equal((await Leandir.open(lean)).config.workspace.state, 'active')
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
    await Leandir.create(root)
    await writeFile(join(lean, 'src', 'index.ts'), 'export const answer:number=43\n')

    await assert.rejects(Leandir.sync(lean), /formatter failed/)
    assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const answer: number = 42;\n')
    assert.equal((await Leandir.open(lean)).config.workspace.state, 'active')
})
