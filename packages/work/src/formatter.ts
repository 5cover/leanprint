import { spawn } from 'node:child_process'
import type { HumanFormatterConfig } from './types.js'
import { FormatterError } from './types.js'

function run(
    args: string[],
    cwd: string,
    config: HumanFormatterConfig,
    source?: string
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(config.command, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
        let stdout = '',
            stderr = ''
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
        child.on('error', error =>
            reject(new FormatterError(`Could not run human formatter ${config.command}: ${error.message}`))
        )
        child.on('close', code =>
            code === 0
                ? resolve({ stdout, stderr })
                : reject(
                      new FormatterError(
                          `Human formatter exited with status ${code}${stderr || stdout ? `: ${(stderr || stdout).trim()}` : '.'}`
                      )
                  )
        )
        child.stdin.end(source)
    })
}

export async function formatOne(
    source: string,
    file: string,
    cwd: string,
    config: HumanFormatterConfig
): Promise<string> {
    const args = config.args.map(arg => (arg === '{file}' ? file : arg)),
        { stdout } = await run(args, cwd, config, source)
    return stdout
}

export async function formatAll(files: string[], cwd: string, config: HumanFormatterConfig): Promise<void> {
    const args = config.args.flatMap(arg => (arg === '{files}' ? files : [arg]))
    await run(args, cwd, config)
}
