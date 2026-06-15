# @zuke/cmd

Run any external command as a [Zuke](https://github.com/zuke-build/zuke#readme)
task — a generic, injection-safe tool wrapper for tools without a dedicated
package.

```ts
import { CmdTasks } from "jsr:@zuke/cmd";

await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
```
