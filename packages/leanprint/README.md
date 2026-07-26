# leanprint

The source-to-source LeanPrint library. It parses ECMAScript-family source with Babel, emits typed language-domain tokens from the AST, and renders deterministic compact source without a general-purpose code generator.

```ts
import { ecmascript, format } from 'leanprint'

const lean = format('const answer: number = 42;', {
  language: ecmascript,
  filepath: 'answer.ts',
  tokens: { semicolons: false },
})
// const answer:number=42\n
```

`FormatOptions<L>` derives its parser, token, and source option types from the supplied language object. Filepath-only calls remain available for registered extensions, but typed parser, token, and source overrides require an explicit language so options cannot be paired with the wrong domain. The package also exports `ecmascript`, language registry helpers, generic language contracts, schema-derived ECMAScript types, and typed errors. It performs no filesystem or workflow operations.

ECMAScript configuration defaults and runtime validation are defined by [EcmascriptConfig.json](https://raw.githubusercontent.com/5cover/leanprint/main/packages/leanprint/src/ecmascript/EcmascriptConfig.json). AJV applies defaults to a cloned configuration, so `format()` does not mutate caller-owned options.

The printer has explicit dispatch for the standardized ECMAScript, TypeScript, and JSX Babel node families enabled by this domain. Behavioral fixtures exercise representative syntax and AST equivalence; the dispatch inventory test is structural and does not substitute for semantic fixtures. Flow and parser proposal plugins not enabled by the ECMAScript domain remain outside its syntax boundary. Unknown future nodes fail with `UnsupportedNodeError`.
