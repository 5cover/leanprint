# leanprint

The source-to-source LeanPrint library. It parses ECMAScript-family source with Babel, emits typed language-domain tokens from the AST, and renders deterministic compact source without a general-purpose code generator.

```ts
import { format } from 'leanprint'

const lean = format('const answer: number = 42;', { filepath: 'answer.ts' })
// const answer:number=42\n
```

The package also exports `ecmascript`, `defineLanguage`, `getLanguage`, `registerLanguage`, generic language contracts, and typed errors. It performs no filesystem or workflow operations.

The enabled ECMAScript, TypeScript, and JSX Babel node families are supported. Flow and parser proposal plugins not enabled by the ECMAScript domain remain outside its syntax boundary. Unknown future nodes fail with `UnsupportedNodeError`.
