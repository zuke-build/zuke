// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertRuntimeNeutral } from "../../../tests/_runtime_neutral.ts";

test("the package makes no direct Deno call, so it runs in the Node binary", async () => {
  await assertRuntimeNeutral(new URL("../", import.meta.url));
});
