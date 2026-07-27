export type JsonToken =
    | { type: 'container-start'; kind: 'object' | 'array'; complexity: number }
    | { type: 'container-end'; kind: 'object' | 'array' }
    | { type: 'string'; value: string }
    | { type: 'number'; value: string }
    | { type: 'boolean'; value: boolean }
    | { type: 'null' }
    | { type: 'comma' | 'colon' }
