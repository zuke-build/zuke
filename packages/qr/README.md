# @zuke/qr

Render a QR code in the terminal from a
[Zuke](https://github.com/zuke-build/zuke#readme) build — no runtime dependency,
no ambient `qrencode`. A build that wants to hand a URL to the people in the
room prints it as a scannable code:

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { QrTasks } from "@zuke/qr";

class Demo extends Build {
  url = parameter("the page to point the room at").required();

  qr = target()
    .description("show the page as a QR code")
    .executes(() => {
      QrTasks.print(this.url.value, (s) => s.errorCorrection("Q"));
    });
}

await run(Demo);
```

```
./zuke qr --url https://zuke.build
```

## Tasks

- `QrTasks.print(text, settings?, { write? })` — encode and write each line
  (default `console.log`).
- `QrTasks.render(text, settings?)` / `QrTasks.renderLines(text, settings?)` —
  the same as a string / an array of lines, for a log or a box.
- `QrTasks.encode(text, settings?)` — the raw `QrCode` (version, level, mask,
  and the `modules[y][x]` matrix) for any other renderer.

## Settings

| Setter                                 | Default | Meaning                                                              |
| -------------------------------------- | ------- | -------------------------------------------------------------------- |
| `.errorCorrection("L"\|"M"\|"Q"\|"H")` | `"M"`   | How much of the symbol may be damaged and still scan (~7/15/25/30%). |
| `.boostErrorCorrection(bool)`          | `true`  | Raise the level for free when the chosen version has room.           |
| `.quietZone(n)`                        | `2`     | Light modules around the symbol (the spec asks for 4; 2 scans fine). |
| `.invert()`                            | off     | Swap dark and light — for terminals showing light text on dark.      |
| `.compact(bool)`                       | `true`  | Two module rows per line with `▀▄█`; `false` draws `██` cells.       |

The encoder covers byte mode (any UTF-8 text), versions 1–40 and all four
error-correction levels, picks the smallest version that fits, and selects the
mask by the specification's penalty score. Text beyond version 40's capacity
throws `QrCapacityError`.

**Scanning tip.** Most phone cameras read the default rendering on both light
and dark terminal themes. If a dark theme fails, pass `.invert()` — and keep the
terminal font's line height at 1 so the half blocks stay contiguous.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/qr` — render a QR code in the terminal from a Zuke build, with no
runtime dependency and no ambient `qrencode`. A build that wants to hand a
URL to the people in the room prints it as a scannable code:

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { QrTasks } from "@zuke/qr";

class Demo extends Build {
  url = parameter("the page to point the room at").required();
  qr = target().executes(() => {
    QrTasks.print(this.url.value, (s) => s.errorCorrection("Q"));
  });
}

await run(Demo);
```

The encoder covers byte mode (any UTF-8 text), versions 1–40 and all four
error-correction levels, picks the smallest version that fits, boosts the
level when it is free, and selects the mask by the specification's penalty
score. `QrTasks.encode` returns the raw module matrix for other renderers.
@module

const QrTasks: QrTasksApi
  Task-shaped QR code operations. Each method takes the text to encode (a URL,
  usually) and an optional settings lambda:

  ```ts
  import { QrTasks } from "@zuke/qr";

  QrTasks.print("https://zuke.build", (s) => s.errorCorrection("Q"));
  ```

class QrCapacityError extends Error
  Thrown when the text does not fit the largest symbol at the requested level.

  constructor(readonly bytes: number, level: ErrorCorrectionLevel)
    Build the error for a text of `bytes` UTF-8 bytes refused at `level`.

    @param bytes
        The UTF-8 length of the text that was refused.

  override name: string
    The error's class name, for `instanceof`-free identification.

class QrSettings
  Configuration for encoding and rendering a QR code, set through a lambda
  passed to a `QrTasks` method. Every setter returns `this` so calls chain.

  errorCorrection_: ErrorCorrectionLevel
    The requested error-correction level (default `"M"`).
  boostErrorCorrection_: boolean
    Raise the level for free when the chosen version has room (default `true`).
  quietZone_: number
    Light modules drawn around the symbol, in modules (default 2; the spec asks for 4).
  invert_: boolean
    Draw dark modules as spaces and light ones as blocks (default `false`).
  compact_: boolean
    Pack two module rows into one text line with half-block characters (default `true`).
  errorCorrection(level: ErrorCorrectionLevel): this
    Set the error-correction level: `"L"` (~7%), `"M"` (~15%), `"Q"` (~25%) or `"H"` (~30%).
  boostErrorCorrection(enabled: boolean): this
    Whether to raise the error-correction level when a higher one fits the
    same version. On by default; turn it off to get exactly the level asked for.
  quietZone(modules: number): this
    Set the width of the light border around the symbol, in modules.
  invert(enabled: boolean): this
    Swap the colours: light modules become blocks and dark ones spaces. Use it
    on a terminal whose text is light on dark, where the default rendering
    shows the code with dark and light exchanged.
  compact(enabled: boolean): this
    Whether to draw two module rows per line with `▀`/`▄`/`█` (the default,
    which keeps a version-3 code under 20 lines) or one row per line with a
    two-character `██` cell per module.

interface QrCode
  A finished QR code, as the caller sees it.

  readonly version: number
    The symbol version (1–40).
  readonly size: number
    The side length in modules (`version * 4 + 17`).
  readonly errorCorrection: ErrorCorrectionLevel
    The error-correction level actually used (boosting can raise the requested one).
  readonly mask: number
    The mask pattern (0–7) the penalty score selected.
  readonly modules: readonly (readonly boolean[])[]
    The modules, `modules[y][x]`, `true` for dark.

interface QrPrintOptions
  Options for {@link QrTasks.print} beyond the settings lambda.

  write?: (line: string) => void
    Where each rendered line goes (default `console.log`).

interface QrTasksApi
  The surface of {@link QrTasks}.

  encode(text: string, configure?: Configure<QrSettings>): QrCode
    Encode `text` (as UTF-8, byte mode) into a {@link QrCode} matrix.
  renderLines(text: string, configure?: Configure<QrSettings>): string[]
    Encode `text` and render it as terminal lines (see {@link QrSettings.compact}).
  render(text: string, configure?: Configure<QrSettings>): string
    Encode `text` and render it as one newline-joined string.
  print(text: string, configure?: Configure<QrSettings>, options?: QrPrintOptions): void
    Encode `text` and write each rendered line through `options.write` (default `console.log`).

type ErrorCorrectionLevel = "L" | "M" | "Q" | "H"
  A QR error-correction level, from `"L"` (~7% recoverable) to `"H"` (~30%).
````

</details>

<!-- ZUKE:API:END -->
