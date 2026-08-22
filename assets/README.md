# Assets

## `demo.cast` / `demo.svg`

`demo.svg` (embedded in the root `README.md`) is rendered from `demo.cast`, an
[asciinema v2](https://docs.asciinema.org/manual/asciicast/v2/) recording.

The cast is staged (hand-authored timings), but **every output line must match
the real CLI byte for byte** — the scaffold lines `zuke setup --yes` prints, the
`--list` format (plain text, two-space column padding), and the executor's run
output (an 80-wide `═` header block per target, a blank line after each
target's footer, the Build Summary table, and the closing verdict line). When
the renderer or `zuke setup` output changes, re-verify each frame against a
real run and update the cast in the same PR.

Render the SVG with [svg-term-cli](https://github.com/marionebl/svg-term-cli):

```sh
npx svg-term-cli --in assets/demo.cast --out assets/demo.svg --window
```
