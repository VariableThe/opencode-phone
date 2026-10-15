import { test } from "node:test"
import assert from "node:assert/strict"
import { stripTrailingSlash, parentOf, nameOf, isAbsolutePath, normalizeAbsolute, resolveWithinRoot, breadcrumbSegments } from "./path-utils.ts"

// stripTrailingSlash -------------------------------------------------------

test("stripTrailingSlash: removes single and repeated trailing separators", () => {
  assert.equal(stripTrailingSlash("/a/b/"), "/a/b")
  assert.equal(stripTrailingSlash("/a/b///"), "/a/b")
  assert.equal(stripTrailingSlash("C:\\proj\\"), "C:\\proj")
})

test("stripTrailingSlash: keeps input when stripping would empty it", () => {
  assert.equal(stripTrailingSlash("/"), "/")
  assert.equal(stripTrailingSlash("\\"), "\\")
  assert.equal(stripTrailingSlash("///"), "///")
})

test("stripTrailingSlash: leaves paths without trailing separator unchanged", () => {
  assert.equal(stripTrailingSlash("/a/b"), "/a/b")
  assert.equal(stripTrailingSlash("D:/work"), "D:/work")
})

// parentOf -----------------------------------------------------------------

test("parentOf: POSIX root has no parent", () => {
  assert.equal(parentOf("/"), null)
  assert.equal(parentOf("//"), null)
})

test("parentOf: bare backslash has no parent", () => {
  assert.equal(parentOf("\\"), null)
})

test("parentOf: Windows drive roots have no parent", () => {
  assert.equal(parentOf("C:\\"), null)
  assert.equal(parentOf("D:/"), null)
  assert.equal(parentOf("c:"), null)
})

test("parentOf: first-level POSIX dir returns the root", () => {
  assert.equal(parentOf("/home"), "/")
  assert.equal(parentOf("/home/"), "/")
})

test("parentOf: nested POSIX paths walk up one level", () => {
  assert.equal(parentOf("/home/user/project"), "/home/user")
  assert.equal(parentOf("/home/user/project/"), "/home/user")
})

test("parentOf: first-level Windows dir returns the drive root", () => {
  assert.equal(parentOf("C:\\projects"), "C:\\")
  assert.equal(parentOf("D:/work"), "D:\\")
})

test("parentOf: nested Windows backslash paths walk up one level", () => {
  assert.equal(parentOf("C:\\projects\\app"), "C:\\projects")
  assert.equal(parentOf("C:\\projects\\app\\"), "C:\\projects")
})

test("parentOf: mixed-separator Windows paths walk up one level", () => {
  assert.equal(parentOf("D:/work/repo"), "D:/work")
})

test("parentOf: relative segment without separators has no parent", () => {
  assert.equal(parentOf("project"), null)
})

// nameOf ---------------------------------------------------------------------

test("nameOf: returns the last POSIX segment", () => {
  assert.equal(nameOf("/home/user/project"), "project")
  assert.equal(nameOf("/home/user/project/"), "project")
})

test("nameOf: returns the last Windows segment", () => {
  assert.equal(nameOf("C:\\projects\\app"), "app")
  assert.equal(nameOf("D:/work/repo"), "repo")
})

test("nameOf: root paths fall back to the trimmed input", () => {
  assert.equal(nameOf("/"), "/")
  assert.equal(nameOf("C:\\"), "C:")
})

test("nameOf: bare segment is returned as-is", () => {
  assert.equal(nameOf("project"), "project")
})

// isAbsolutePath -------------------------------------------------------------

test("isAbsolutePath: POSIX and Windows absolute paths", () => {
  assert.equal(isAbsolutePath("/a/b"), true)
  assert.equal(isAbsolutePath("/"), true)
  assert.equal(isAbsolutePath("C:/proj"), true)
  assert.equal(isAbsolutePath("C:\\proj"), true)
})

test("isAbsolutePath: relative paths are rejected", () => {
  assert.equal(isAbsolutePath(""), false)
  assert.equal(isAbsolutePath("."), false)
  assert.equal(isAbsolutePath(".."), false)
  assert.equal(isAbsolutePath("a/b"), false)
  assert.equal(isAbsolutePath("~/x"), false)
  assert.equal(isAbsolutePath("C:"), false)
})

// normalizeAbsolute ----------------------------------------------------------

test("normalizeAbsolute: resolves dot segments and dedups slashes", () => {
  assert.equal(normalizeAbsolute("/a//b/./c/"), "/a/b/c")
  assert.equal(normalizeAbsolute("/home/user/Projects/../../../tmp/x/"), "/tmp/x")
  assert.equal(normalizeAbsolute("/"), "/")
})

test("normalizeAbsolute: unifies backslashes and clamps .. at the root", () => {
  assert.equal(normalizeAbsolute("C:\\a\\..\\b"), "C:/b")
  assert.equal(normalizeAbsolute("/../../x"), "/x")
})

// resolveWithinRoot ----------------------------------------------------------

test("resolveWithinRoot: accepts the root itself and anything below it", () => {
  assert.deepEqual(resolveWithinRoot("/a/b", "/a/b"), { ok: true, path: "/a/b" })
  assert.deepEqual(resolveWithinRoot("/a/b", "/a/b/c/"), { ok: true, path: "/a/b/c" })
})

test("resolveWithinRoot: rejects escapes, including prefix-sibling tricks", () => {
  assert.deepEqual(resolveWithinRoot("/a/b", "/a/bc"), { ok: false, reason: "outside-root" })
  assert.deepEqual(resolveWithinRoot("/a/b", "/a/b/../bc"), { ok: false, reason: "outside-root" })
  assert.deepEqual(resolveWithinRoot("/a/b", "/other"), { ok: false, reason: "outside-root" })
  assert.deepEqual(resolveWithinRoot("/", "/other"), { ok: true, path: "/other" })
})

test("resolveWithinRoot: rejects non-absolute input and allows all when rootless", () => {
  assert.deepEqual(resolveWithinRoot("/a", "b/c"), { ok: false, reason: "not-absolute" })
  assert.deepEqual(resolveWithinRoot("/a", ""), { ok: false, reason: "not-absolute" })
  assert.deepEqual(resolveWithinRoot(null, "/any/where/"), { ok: true, path: "/any/where" })
})

// breadcrumbSegments ---------------------------------------------------------

test("breadcrumbSegments: full chain from the filesystem root", () => {
  assert.deepEqual(breadcrumbSegments("/a/b"), [
    { label: "/", path: "/" },
    { label: "a", path: "/a" },
    { label: "b", path: "/a/b" },
  ])
})

test("breadcrumbSegments: root and drive roots collapse to one crumb", () => {
  assert.deepEqual(breadcrumbSegments("/"), [{ label: "/", path: "/" }])
  assert.deepEqual(breadcrumbSegments("C:\\x"), [
    { label: "C:/", path: "C:/" },
    { label: "x", path: "C:/x" },
  ])
})
