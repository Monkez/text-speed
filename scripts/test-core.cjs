const assert = require("assert/strict");
const defaults = require("../shared/default-settings.json");
const {
  hotkeyId,
  normalizeBaseUrl,
  parseInlineBuffer,
  redactSecrets,
  toElectronAccelerator,
} = require("../shared/core.cjs");

assert.equal(defaults.popupHotkey, "Alt + Space");
assert.equal(defaults.floatingActions[1].id, "summarize");

assert.deepEqual(parseInlineBuffer("//pro gửi file cho anh nhé/"), {
  command: "pro",
  content: "gửi file cho anh nhé",
  fullText: "//pro gửi file cho anh nhé/",
  prefix: "//",
  modelTier: "balanced",
});
assert.equal(parseInlineBuffer("//pro/"), null);
assert.equal(parseInlineBuffer("///mail draft email/").modelTier, "powerful");

assert.equal(toElectronAccelerator("Alt + Space"), "Alt+Space");
assert.equal(toElectronAccelerator("Ctrl + Shift + S"), "CommandOrControl+Shift+S");
assert.equal(hotkeyId("Windows + Space"), hotkeyId("Win + Space"));
assert.equal(normalizeBaseUrl("https://example.com///"), "https://example.com");

const redacted = redactSecrets('Bearer sk-testsecret123456789 and "x-api-key":"abc123"');
assert(!redacted.includes("sk-testsecret123456789"));
assert(!redacted.includes("abc123"));

console.log("core tests passed");
