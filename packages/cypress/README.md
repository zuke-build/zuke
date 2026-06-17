# @zuke/cypress

Typed [Cypress](https://cypress.io) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `run`, `open`,
`install`, `verify`, and `info`.

```ts
import { CypressTasks } from "jsr:@zuke/cypress";

await CypressTasks.run((s) => s.e2e().browser("chrome").spec("cypress/e2e/**"));
```
