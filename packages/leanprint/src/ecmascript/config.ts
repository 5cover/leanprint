import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js'
import { InvalidConfigError } from '../errors.js'
import schema from './EcmascriptConfig.json' with { type: 'json' }
import type { EcmascriptConfig, ResolvedEcmascriptConfig } from './types.js'

const ajv = new Ajv2020({ allErrors: true, useDefaults: true, coerceTypes: false, removeAdditional: false })
const validate = ajv.compile(schema)
export const ecmascriptConfigSchema = schema

function describe(errors: ErrorObject[] | null | undefined): string {
    return (errors ?? [])
        .map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
        .join('; ')
}

export function resolveEcmascriptConfig(input: EcmascriptConfig = {}): ResolvedEcmascriptConfig {
    const config: unknown = structuredClone(input)
    if (!validate(config)) throw new InvalidConfigError(`Invalid ECMAScript configuration: ${describe(validate.errors)}.`)
    return config as ResolvedEcmascriptConfig
}
