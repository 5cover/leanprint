import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig, includeIgnoreFile } from 'eslint/config'
import { resolve } from 'path'

export default defineConfig(
    includeIgnoreFile(resolve(import.meta.dirname, '.gitignore')),
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-unnecessary-condition': ['error',{
                allowConstantLoopConditions: 'only-allowed-literals'
            }],
            '@typescript-eslint/no-confusing-void-expression': ['error', {
                ignoreArrowShorthand: true
            }]
        },
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    }
)
