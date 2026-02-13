import fs from "node:fs";

function stripComments(input) {
  let out = "";
  let inStr = false;
  let quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    const n = input[i + 1];

    if (inStr) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 1;
        continue;
      }
      if (c === quote) {
        inStr = false;
        quote = "";
      }
      continue;
    }

    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      continue;
    }

    if (c === "/" && n === "/") {
      while (i < input.length && input[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }

    if (c === "/" && n === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }

    out += c;
  }
  return out;
}

function stripTrailingCommas(input) {
  let out = "";
  let inStr = false;
  let quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += input[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (c === quote) {
        inStr = false;
        quote = "";
      }
      continue;
    }

    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      continue;
    }

    if (c === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j += 1;
      if (input[j] === "}" || input[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

export function loadJson5File(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const normalized = stripTrailingCommas(stripComments(raw));
  try {
    return JSON.parse(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`JSON5 parse failed for ${filePath}: ${msg}`);
  }
}
