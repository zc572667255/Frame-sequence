// Syntax-check every JS file in server/ and web/ (node --check), so a typo shows
// up here instead of as a blank page.
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".js")) files.push(p);
  }
};
walk(path.join(root, "server"));
walk(path.join(root, "web", "js"));

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(String(err.stderr || err.message));
  }
}
console.log(failed ? `${failed} / ${files.length} 个文件有语法错误` : `${files.length} 个文件语法检查通过`);
process.exit(failed ? 1 : 0);
