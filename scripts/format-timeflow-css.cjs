const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "timeflow.css");
const OUTPUT = path.join(ROOT, "src", "styles", "timeflow.css");

/**
 * 將壓縮 CSS 格式化為可閱讀來源。
 * 時間 O(n)，空間 O(n)，n = CSS 字元數。
 *
 * 更快替代方案比較：
 * - 以 regex 直接替換 `{`、`;`、`}`：會誤拆字串、url() 或 calc() 內內容。
 * - 本實作：單次掃描並追蹤字串、註解與括號深度，只有宣告層級才換行。
 */
function formatCss(source) {
  const input = String(source || "").replace(/\r\n?/g, "\n").trim();
  let output = "";
  let indent = 0;
  let quote = "";
  let escaped = false;
  let inComment = false;
  let parenDepth = 0;
  let pendingSpace = false;

  const writeIndent = () => {
    if (!output || output.endsWith("\n")) output += "  ".repeat(Math.max(0, indent));
  };

  const newline = () => {
    output = output.replace(/[ \t]+$/g, "");
    if (!output.endsWith("\n")) output += "\n";
    pendingSpace = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1] || "";

    if (inComment) {
      writeIndent();
      output += char;
      if (char === "*" && next === "/") {
        output += next;
        index += 1;
        inComment = false;
        newline();
      }
      continue;
    }

    if (quote) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }

    if (char === "/" && next === "*") {
      if (output && !output.endsWith("\n")) newline();
      writeIndent();
      output += "/*";
      index += 1;
      inComment = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (pendingSpace && output && !/[\s{(:,]$/.test(output)) output += " ";
      pendingSpace = false;
      writeIndent();
      output += char;
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace && output && !output.endsWith("\n") && !/[\s{(:,]$/.test(output) && !/[;},>+~]/.test(char)) {
      output += " ";
    }
    pendingSpace = false;

    if (char === "(") {
      writeIndent();
      output += char;
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      output += char;
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (parenDepth === 0 && char === "{") {
      output = output.replace(/[ \t]+$/g, "");
      output += " {";
      indent += 1;
      newline();
      continue;
    }

    if (parenDepth === 0 && char === ";") {
      output += ";";
      newline();
      continue;
    }

    if (parenDepth === 0 && char === "}") {
      if (!output.endsWith("\n")) newline();
      indent = Math.max(0, indent - 1);
      writeIndent();
      output += "}";
      const following = input.slice(index + 1).match(/^\s*([^\s])/s)?.[1] || "";
      if (following && following !== ";" && following !== "}") output += "\n\n";
      else newline();
      continue;
    }

    if (parenDepth === 0 && char === "," && indent === 0) {
      output += ",";
      newline();
      continue;
    }

    writeIndent();
    output += char;
  }

  return `${output.trim()}\n`;
}

if (!fs.existsSync(INPUT)) throw new Error(`找不到輸入 CSS：${INPUT}`);
const formatted = formatCss(fs.readFileSync(INPUT, "utf8"));
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, formatted, "utf8");
console.log(`[format-timeflow-css] 已輸出 ${path.relative(ROOT, OUTPUT)}（${formatted.length} 字元）`);

module.exports = { formatCss };
