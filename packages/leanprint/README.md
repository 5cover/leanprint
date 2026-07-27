# leanprint

The source-to-source LeanPrint library. It parses ECMAScript-family source with Babel and strict JSON with Momoa, emits typed language-domain tokens from each AST, and renders deterministic compact source without a general-purpose code generator.

For leandir creation, update/sync workflows, configuration discovery, and the CLI, see [`@leanprint/work`](https://www.npmjs.com/package/@leanprint/work).

```ts
import { ecmascript, format } from 'leanprint'

const lean = format('const answer: number = 42;', {
  language: ecmascript,
  filepath: 'answer.ts',
  tokens: { semicolons: false },
})
// const answer:number=42\n
```

`FormatOptions<L>` derives its parser, token, and source option types from the supplied language object. Filepath-only calls remain available for registered extensions, but typed parser, token, and source overrides require an explicit language so options cannot be paired with the wrong domain. The package exports `ecmascript`, `json`, language registry helpers, generic language contracts, schema-derived configuration types, and typed errors. It performs no filesystem or workflow operations.

JSON formatting preserves member order, duplicate keys, and numeric spelling. Containers with recursive complexity up to eight remain inline by default; larger containers expand with deterministic indentation. Safe Unicode escapes are rendered literally while required, control, invisible, and lone-surrogate escapes remain escaped. Configure the threshold with `json.source.inlineComplexity` and formatting with `indent` and `lineEnding`.

ECMAScript configuration defaults and runtime validation are defined by [EcmascriptConfig.json](https://raw.githubusercontent.com/5cover/leanprint/main/packages/leanprint/src/ecmascript/EcmascriptConfig.json). AJV applies defaults to a cloned configuration, so `format()` does not mutate caller-owned options.

The printer has explicit dispatch for the standardized ECMAScript, TypeScript, and JSX Babel node families enabled by this domain. Behavioral fixtures exercise representative syntax and AST equivalence; the dispatch inventory test is structural and does not substitute for semantic fixtures. Flow and parser proposal plugins not enabled by the ECMAScript domain remain outside its syntax boundary. Unknown future nodes fail with `UnsupportedNodeError`.
