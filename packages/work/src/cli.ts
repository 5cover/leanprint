#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Command } from '@commander-js/extra-typings'
import { format, getLanguage } from 'leanprint'
import Config from './Config.js'
import Leandir from './Leandir.js'
import Prompt from './Prompt.js'
import { replaceFile } from './filesystem.js'
import Stats from './stats/Stats.js'
const program = new Command()
    .name('leanprint')
    .description('Compact source for AI agents and manage leandirs.')
    .version('0.1.0')
    .option('-c, --config <filename>', 'repository-relative config filename used for upward discovery', 'leanprint.json')
program
    .command('format')
    .description('Leanify one source file and print the result or replace the file.')
    .argument('<file>', 'source file to leanify')
    .option('--write', 'replace the input file atomically instead of writing stdout')
    .option('--language <language>', 'registered language domain to use instead of extension detection')
    .addHelpText('after', '\nExample:\n  leanprint format src/index.ts --write\n')
    .action(async (file, options) => {
        const path = resolve(file),
            source = await readFile(path, 'utf8'),
            language = options.language ? getLanguage(options.language) : undefined
        if (options.language && !language) throw new Error(`Language "${options.language}" is not registered.`)
        const output = language ? format(source, { filepath: path, language }) : format(source, { filepath: path })
        if (options.write) await replaceFile(path, output)
        else process.stdout.write(output)
    })
program
    .command('create')
    .description('Create a materialized leandir from a source project.')
    .argument('[root]', 'source project path', process.cwd())
    .option('--force', 'replace a non-empty target leandir')
    .addHelpText('after', '\nExample:\n  leanprint create ~/project\n\nSafety: the leandir must be outside the source project.\n')
    .action(async (root, options) => {
        const generated = await Leandir.create(root, program.opts().config, options.force)
        process.stdout.write(`Created leandir: ${generated.workspace.leandir}\n`)
    })
program
    .command('sync')
    .description('Pull AI changes from an active leandir back to its source project.')
    .argument('[path]', 'source project or leandir path', process.cwd())
    .addHelpText(
        'after',
        '\nExample:\n  leanprint sync /tmp/project.lean\n\nSafety: all conflicts and formatter output are checked before source files are written. Run update first when source settings or files changed.\n'
    )
    .action(async path => {
        const status = await Leandir.sync(path, program.opts().config)
        process.stdout.write(`Synchronized ${status.changes.length} change(s) to ${status.sourceRoot}.\n`)
    })
program
    .command('update')
    .description('Push source-project and configuration changes into an active leandir.')
    .argument('[path]', 'source project or leandir path', process.cwd())
    .addHelpText(
        'after',
        '\nExample:\n  leanprint update ~/project\n\nSafety: paths changed on both sides are conflicts; every conflict is reported before any ordinary file is written.\n'
    )
    .action(async path => {
        const status = await Leandir.update(path, program.opts().config)
        process.stdout.write(`Updated ${status.sourceChanges.length} change(s) in ${status.leandir}.\n`)
    })
program
    .command('prompt')
    .description('Print deterministic instructions for an AI agent working with this project.')
    .argument('[path]', 'project or leandir path', process.cwd())
    .addHelpText('after', '\nExample:\n  leanprint prompt /tmp/project.lean\n')
    .action(async path => {
        const found = await Config.discover(path, program.opts().config),
            loaded = await Config.load(found.configPath),
            inLeandir = loaded.kind === 'leandir'
        if (loaded.kind === 'leandir') Config.validateWorkspace(loaded.config, found.root)
        process.stdout.write(Prompt.generate(loaded.config, inLeandir))
    })
program
    .command('status')
    .description('Report source-side update work, leandir-side sync work, and conflicts.')
    .argument('[path]', 'project or leandir path', process.cwd())
    .addHelpText('after', '\nExample:\n  leanprint status ~/project\n')
    .action(async path => {
        const status = await Leandir.status(path, program.opts().config)
        process.stdout.write(
            `Context: ${status.context}\nState: ${status.state}\nSource root: ${status.sourceRoot}\nLeandir: ${status.leandir}\nConfiguration changed: ${status.configChanged ? 'yes (update required)' : 'no'}\nPending update changes: ${status.sourceChanges.length}\nPending sync changes: ${status.leandirChanges.length}\nConflicts: ${status.conflicts.length}\n`
        )
        for (const conflict of status.conflicts) process.stdout.write(`- ${conflict.path}: ${conflict.conflict}\n`)
    })
program
    .command('clean')
    .description('Delete a verified leandir after confirmation.')
    .argument('[path]', 'project or leandir path', process.cwd())
    .option('--force', 'skip interactive confirmation')
    .addHelpText('after', '\nExample:\n  leanprint clean /tmp/project.lean\n\nSafety: only a verified generated leandir is removed.\n')
    .action(async (path, options) => {
        const found = await Config.discover(path, program.opts().config),
            loaded = await Config.load(found.configPath),
            opened =
                loaded.kind === 'leandir'
                    ? await Leandir.open(found.root, program.opts().config)
                    : await Leandir.open(resolve(found.root, loaded.config.leandir), program.opts().config)
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
const stats = program.command('stats').description('Measure source and lean output statistics.')
stats
    .command('tiktoken')
    .description('Compare original and lean token counts with tiktoken.')
    .argument('[model-or-encoding]', 'tiktoken model or encoding name')
    .option('--json', 'emit one machine-readable JSON object')
    .option('--root <path>', 'project path', process.cwd())
    .addHelpText('after', '\nExample:\n  leanprint stats tiktoken o200k_base --root ~/project\n')
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
