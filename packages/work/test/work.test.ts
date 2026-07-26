import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import Config from '../src/Config.js'
import Leandir from '../src/Leandir.js'
import Prompt from '../src/Prompt.js'
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'leanprint-test-')),
        lean = join(root, '..', `${root.split('/').at(-1)}.lean`)
    await writeFile(
        join(root, 'leanprint.json'),
        JSON.stringify({
            leandir: lean,
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
    assert.equal((await Leandir.status(lean)).changes.length, 0)
})
