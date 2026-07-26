#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Command } from '@commander-js/extra-typings'
import { format } from 'leanprint'
import Config from './Config.js'
import Leandir from './Leandir.js'
import Prompt from './Prompt.js'
import { atomicWrite } from './filesystem.js'
import Stats from './stats/Stats.js'
const program = new Command()
    .name('leanprint')
    .description('Compact source for AI agents and manage leandirs.')
    .version('0.1.0')
    .option('-c, --config <filename>', 'config filename', 'leanprint.json')
program
    .command('format')
    .argument('<file>')
    .option('--write')
    .option('--language <language>')
    .action(async (file, options) => {
        const path = resolve(file),
            source = await readFile(path, 'utf8'),
            output = format(source, { filepath: path, ...(options.language ? { language: options.language } : {}) })
        if (options.write) await atomicWrite(path, output)
        else process.stdout.write(output)
    })
program
    .command('create')
    .argument('[root]', 'source project path', process.cwd())
    .option('--force')
    .action(async (root, options) => {
        const generated = await Leandir.create(root, program.opts().config, options.force)
        process.stdout.write(`Created leandir: ${generated.workspace.leandir}\n`)
    })
program
    .command('sync')
    .argument('[path]', 'leandir path', process.cwd())
    .action(async path => {
        const status = await Leandir.sync(path, program.opts().config)
        process.stdout.write(`Synchronized ${status.changes.length} change(s) to ${status.sourceRoot}.\n`)
    })
program
    .command('prompt')
    .argument('[path]', 'project or leandir path', process.cwd())
    .action(async path => {
        const found = await Config.discover(path, program.opts().config),
            loaded = await Config.load(found.configPath),
            inLeandir = 'workspace' in loaded
        if (inLeandir) Config.validateWorkspace(loaded as any, found.root)
        process.stdout.write(Prompt.generate(loaded, inLeandir))
    })
program
    .command('status')
    .argument('[path]', 'project or leandir path', process.cwd())
    .action(async path => {
        const status = await Leandir.status(path, program.opts().config),
            counts = (kind: string) => status.changes.filter(c => c.kind === kind).length
        process.stdout.write(
            `Context: ${status.context}\nSource root: ${status.sourceRoot}\nLeandir: ${status.leandir}\nChanged files: ${counts('modified')}\nAdded files: ${counts('added')}\nDeleted files: ${counts('deleted')}\nConflicts: ${status.conflicts.length}\n`
        )
        for (const conflict of status.conflicts) process.stdout.write(`- ${conflict.path}: ${conflict.conflict}\n`)
    })
program
    .command('clean')
    .argument('[path]', 'project or leandir path', process.cwd())
    .option('--force')
    .action(async (path, options) => {
        let opened
        try {
            opened = await Leandir.open(path, program.opts().config)
        } catch {
            const source = await Config.source(path, program.opts().config)
            opened = await Leandir.open(resolve(source.sourceRoot, source.config.leandir), program.opts().config)
        }
        if (!options.force) {
            if (!process.stdin.isTTY)
                throw new Error('Confirmation required; use --force in non-interactive environments.')
            const rl = createInterface({ input: process.stdin, output: process.stderr }),
                answer = await rl.question(`Delete verified leandir ${opened.root}? [y/N] `)
            rl.close()
            if (!/^y(?:es)?$/i.test(answer)) return
        }
        await rm(opened.root, { recursive: true })
        process.stdout.write(`Deleted leandir: ${opened.root}\n`)
    })
const stats = program.command('stats')
stats
    .command('tiktoken')
    .argument('[model-or-encoding]')
    .option('--json')
    .option('--root <path>', 'project path', process.cwd())
    .action(async (model, options) => {
        const result = await Stats.tiktoken({
            root: options.root,
            configFilename: program.opts().config,
            ...(model ? { modelOrEncoding: model } : {}),
        })
        if (options.json) {
            process.stdout.write(`${JSON.stringify(result)}\n`)
            return
        }
        const n = new Intl.NumberFormat('en-US')
        process.stdout.write(
            `Tokenizer: ${result.requested}\nEncoding: ${result.encoding}\nFiles: ${n.format(result.files)}\n\nOriginal tokens: ${n.format(result.originalTokens)}\nLeanPrint tokens: ${n.format(result.leanTokens)}\nTokens saved: ${n.format(result.tokensSaved)}\nReduction: ${result.reductionPercentage.toFixed(2)}%\n`
        )
    })
program.parseAsync().catch(error => {
    process.stderr.write(`Error: ${(error as Error).message}\n`)
    process.exitCode = 1
})
