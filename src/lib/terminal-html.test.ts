import { test } from "node:test"
import assert from "node:assert/strict"
import { buildTerminalHtml, TERMINAL_INIT_JS } from "./terminal-html.ts"

// The terminal screen and the WebView init script share a private contract
// (__ptyWrite/__ptyFit/__ptyTheme/__ptyPalette + ready/input/resize
// messages). If either side renames a hook the screen goes dead without a
// type error, so the markers are pinned here. Vendor sources are stubbed —
// the real ones are composed in app code (see terminal-vendor.generated.ts).

const VENDOR = { css: ".xterm{}", js: "var Terminal={};", fit: "var FitAddon={};" }

test("shell inlines the xterm globals and the mount node", () => {
  const html = buildTerminalHtml(VENDOR)
  assert.ok(html.includes("var Terminal={};"), "xterm marker missing")
  assert.ok(html.includes("var FitAddon={};"), "fit addon marker missing")
  assert.ok(html.includes('<div id="t"></div>'), "terminal mount node missing")
})

test("init script exposes the RN entry points and posts ready", () => {
  for (const marker of ["__ptyWrite", "__ptyFit", "__ptyTheme", "__ptyPalette", "'ready'", "'input'", "'resize'", "onData"]) {
    assert.ok(TERMINAL_INIT_JS.includes(marker), `${marker} missing from init script`)
  }
})

test("shell embeds the init script last", () => {
  assert.ok(buildTerminalHtml(VENDOR).includes(TERMINAL_INIT_JS.slice(0, 60)), "init script not embedded in shell")
})

test("inline guards reject vendor sources that would break out of the tags", () => {
  assert.throws(() => buildTerminalHtml({ ...VENDOR, js: "x</script>y" }), /cannot inline/)
  assert.throws(() => buildTerminalHtml({ ...VENDOR, fit: "x</script>y" }), /cannot inline/)
  assert.throws(() => buildTerminalHtml({ ...VENDOR, css: "x</style>y" }), /cannot inline/)
})
