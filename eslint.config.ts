import js from '@eslint/js'
import { defineConfig, includeIgnoreFile } from 'eslint/config'
import tseslint from 'typescript-eslint'
import { resolve } from 'path'

export default defineConfig([
    includeIgnoreFile(resolve(import.meta.dirname, '.gitignore')),
    {
        files: ['eslint.config.ts', 'scripts/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                {
                    allowNumber: true,
                    allowRegExp: true,
                },
            ],
        },
    },
])
