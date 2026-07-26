import {
    encoding_for_model,
    get_encoding,
    get_encoding_name_for_model,
    type Tiktoken as Encoding,
    type TiktokenEncoding,
    type TiktokenModel,
} from 'tiktoken'

const encodings = defineEnum<TiktokenEncoding[]>(
    'o200k_base',
    'cl100k_base',
    'p50k_base',
    'r50k_base',
    'p50k_edit',
    'gpt2'
)
export default class Tiktoken {
    readonly requested: string
    readonly encoding: string
    private readonly instance: Encoding
    constructor(requested = 'gpt-5-chat-latest') {
        this.requested = requested
        try {
            if (encodings.is(requested)) {
                this.instance = get_encoding(requested as TiktokenEncoding)
                this.encoding = requested
            } else {
                this.instance = encoding_for_model(requested as TiktokenModel)
                this.encoding = get_encoding_name_for_model(requested as TiktokenModel)
            }
        } catch (error) {
            throw new Error(
                `Could not resolve tokenizer for "${requested}". Provide a supported model name or an encoding such as "o200k_base".`,
                { cause: error }
            )
        }
    }
    count(source: string): number {
        return this.instance.encode(source).length
    }
    free(): void {
        this.instance.free()
    }
}

function defineEnum<const T extends readonly string[]>(...values: T) {
    const valueSet = new Set<string>(values)

    return {
        values,
        is(value: unknown): value is T[number] {
            return typeof value === 'string' && valueSet.has(value)
        },
    }
}
