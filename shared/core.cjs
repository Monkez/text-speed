function parseInlineBuffer(buffer) {
  const trimmed = String(buffer || "").trimEnd();
  if (!trimmed.endsWith("/")) return null;
  const match = trimmed.match(/(?:^|\s)(\/{1,3})([A-Za-z0-9_-]+)\s+([\s\S]+)\/$/);
  if (!match) return null;
  const prefix = match[1];
  const command = match[2];
  const content = match[3].trim();
  if (!content) return null;
  const modelTier = prefix.length === 1 ? "fast" : prefix.length === 2 ? "balanced" : "powerful";
  return { command, content, fullText: `${prefix}${command} ${match[3]}/`, prefix, modelTier };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function toElectronAccelerator(value) {
  const keyMap = {
    ctrl: "CommandOrControl",
    control: "CommandOrControl",
    alt: "Alt",
    shift: "Shift",
    win: "Super",
    windows: "Super",
    meta: "Super",
    cmd: "Command",
    command: "Command",
    space: "Space",
    esc: "Esc",
    escape: "Esc",
  };
  return String(value || "")
    .split("+")
    .map((part) => {
      const trimmed = part.trim();
      return keyMap[trimmed.toLowerCase()] || trimmed.toUpperCase();
    })
    .filter(Boolean)
    .join("+");
}

function hotkeyId(value) {
  return String(value || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (part === "control") return "ctrl";
      if (["windows", "meta", "cmd", "command"].includes(part)) return "win";
      if (part === "escape") return "esc";
      return part;
    })
    .join("+");
}

function redactSecrets(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-...[redacted]")
    .replace(/AIza[A-Za-z0-9_-]{12,}/g, "AIza...[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/"x-api-key"\s*:\s*"[^"]+"/gi, '"x-api-key":"[redacted]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[redacted]"');
}

module.exports = {
  hotkeyId,
  normalizeBaseUrl,
  parseInlineBuffer,
  redactSecrets,
  toElectronAccelerator,
};
