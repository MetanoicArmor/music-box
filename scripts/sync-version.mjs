import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION must be major.minor.patch, got: ${version}`);
  process.exit(1);
}

function replaceVersions(text, count) {
  let seen = 0;
  return text.replace(/"version": "[^"]+"/g, (match) => {
    if (seen >= count) return match;
    seen += 1;
    return `"version": "${version}"`;
  });
}

const pkgPath = path.join(root, "package.json");
const pkgNext = replaceVersions(fs.readFileSync(pkgPath, "utf8"), 1);
if (JSON.parse(pkgNext).version !== version) {
  console.error("Could not update package.json from VERSION");
  process.exit(1);
}
fs.writeFileSync(pkgPath, pkgNext);

const lockPath = path.join(root, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lockNext = replaceVersions(fs.readFileSync(lockPath, "utf8"), 2);
  const lock = JSON.parse(lockNext);
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    console.error("Could not update package-lock.json from VERSION");
    process.exit(1);
  }
  fs.writeFileSync(lockPath, lockNext);
}

console.log(version);
