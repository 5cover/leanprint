#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Command } from '@commander-js/extra-typings'
import { format, getLanguage } from 'leanprint'
import * as cfg from './config.js'
import * as leandir from './leandir.js'
import * as prompt from './prompt.js'
import { replaceFile } from './filesystem.js'
import * as stats from './stats/stats.js'
const program = new Command()
    .name('leanprint')
    .description('Compact source for AI agents and manage leandirs.')
    .version('0.1.0')
    .option(
        '-c, --config <filename>',
        'repository-relative config filename used for upward discovery',
        'leanprint.json'
    )
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
    .addHelpText(
        'after',
        '\nExample:\n  leanprint create ~/project\n\nSafety: the leandir must be outside the source project.\n'
    )
    .action(async (root, options) => {
        const generated = await leandir.create(root, program.opts().config, options.force)
        process.stdout.write(`Created leandir: ${generated.workspace.leandir}\n`)
    })
program
    .command('pull')
    .description('Pull AI changes from an active leandir back to its source project.')
    .argument('[path]', 'source project or leandir path', process.cwd())
    .addHelpText(
        'after',
        '\nExample:\n  leanprint pull /tmp/project.lean\n\nSafety: all same-path conflicts and formatter output are checked before source files are written. Source-only changes are left untouched. Run push first when source settings changed.\n'
    )
    .action(async path => {
        const status = await leandir.pull(path, program.opts().config)
        process.stdout.write(`Pulled ${status.changes.length} change(s) to ${status.sourceRoot}.\n`)
    })
program
    .command('push')
    .description('Push source-project and configuration changes into an active leandir.')
    .argument('[path]', 'source project or leandir path', process.cwd())
    .addHelpText(
        'after',
        '\nExample:\n  leanprint push ~/project\n\nSafety: paths changed on both sides are conflicts; every conflict is reported before any ordinary file is written.\n'
    )
    .action(async path => {
        const status = await leandir.push(path, program.opts().config)
        process.stdout.write(`Pushed ${status.sourceChanges.length} change(s) to ${status.leandir}.\n`)
    })
program
    .command('prompt')
    .description('Print deterministic instructions for an AI agent working with this project.')
    .argument('[path]', 'project or leandir path', process.cwd())
    .addHelpText('after', '\nExample:\n  leanprint prompt /tmp/project.lean\n')
    .action(async path => {
        const found = await cfg.discover(path, program.opts().config)
        if (!found.configPath) {
            const { config } = await cfg.source(path, program.opts().config)
            process.stdout.write(prompt.generate(config, false))
            return
        }
        const loaded = await cfg.load(found.configPath)
        if (loaded.kind === 'leandir') cfg.validateWorkspace(loaded.config, found.root)
        process.stdout.write(prompt.generate(loaded.config, loaded.kind === 'leandir'))
    })
program
    .command('status')
    .description('Report source-side push work, leandir-side pull work, and conflicts.')
    .argument('[path]', 'project or leandir path', process.cwd())
    .addHelpText('after', '\nExample:\n  leanprint status ~/project\n')
    .action(async path => {
        const status = await leandir.status(path, program.opts().config)
        process.stdout.write(
            `Context: ${status.context}\nState: ${status.state}\nSource root: ${status.sourceRoot}\nLeandir: ${status.leandir}\nConfiguration changed: ${status.configChanged ? 'yes (push required)' : 'no'}\nPending push changes: ${status.sourceChanges.length}\nPending pull changes: ${status.leandirChanges.length}\nConflicts: ${status.conflicts.length}\n`
        )
        for (const conflict of status.conflicts) process.stdout.write(`- ${conflict.path}: ${conflict.conflict}\n`)
    })
program
    .command('clean')
    .description('Delete a verified leandir after confirmation.')
    .argument('[path]', 'project or leandir path', process.cwd())
    .option('--force', 'skip interactive confirmation')
    .addHelpText(
        'after',
        '\nExample:\n  leanprint clean /tmp/project.lean\n\nSafety: only a verified generated leandir is removed.\n'
    )
    .action(async (path, options) => {
        const found = await cfg.discover(path, program.opts().config)
        let opened
        if (found.configPath) {
            const loaded = await cfg.load(found.configPath)
            if (loaded.kind === 'leandir') opened = await leandir.open(found.root, program.opts().config)
            else {
                const { config } = await cfg.source(found.root, program.opts().config)
                opened = await leandir.open(cfg.requireLeandir(config, program.opts().config), program.opts().config)
            }
        } else {
            const { config } = await cfg.source(path, program.opts().config)
            opened = await leandir.open(cfg.requireLeandir(config, program.opts().config), program.opts().config)
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
const statsCommand = program.command('stats').description('Measure source and lean output statistics.')
statsCommand
    .command('tiktoken')
    .description('Compare original and lean token counts with tiktoken.')
    .argument('[model-or-encoding]', 'tiktoken model or encoding name')
    .option('--json', 'emit one machine-readable JSON object')
    .option('--root <path>', 'project path', process.cwd())
    .addHelpText('after', '\nExample:\n  leanprint stats tiktoken o200k_base --root ~/project\n')
    .action(async (model, options) => {
        const result = await stats.tiktoken({
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
program.parseAsync().catch((error: unknown) => {
    process.stderr.write(`Error: ${(error as Error).message}\n`)
    process.exitCode = 1
})
