import { spawn } from 'node:child_process'
import type { HumanFormatterConfig } from './types.js'
import { FormatterError } from './types.js'
export default class Formatter {
    static format(source: string, file: string, cwd: string, config: HumanFormatterConfig): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(
                config.command,
                config.args.map(arg => arg.replaceAll('{file}', file)),
                { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
            )
            let stdout = '',
                stderr = ''
            child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
            child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
            child.on('error', error =>
                reject(new FormatterError(`Could not run human formatter ${config.command}: ${error.message}`))
            )
            child.on('close', code =>
                code === 0
                    ? resolve(stdout)
                    : reject(
                          new FormatterError(
                              `Human formatter exited with status ${code}${stderr ? `: ${stderr.trim()}` : '.'}`
                          )
                      )
            )
            child.stdin.end(source)
        })
    }
}
