import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const task = process.argv[2];
const win = process.platform === "win32";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

switch (task) {
  case "setup":
    if (win) run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/setup-binaries.ps1"]);
    else run("bash", ["scripts/setup-binaries.sh"]);
    break;
  case "release":
    if (win) run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/build-release.ps1"]);
    else run("bash", ["scripts/build-release.sh"]);
    break;
  case "release-macos":
    if (process.platform !== "darwin") {
      console.error("macOS release can only be built on a Mac.");
      process.exit(1);
    }
    run("bash", ["scripts/build-release.sh"]);
    break;
  case "release-linux":
    if (win) {
      console.error("Build the Linux archive on macOS or Linux: bash scripts/build-release.sh linux");
      process.exit(1);
    }
    run("bash", ["scripts/build-release.sh", "linux"]);
    break;
  case "stop":
    if (win) run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/stop-server.ps1"]);
    else run("bash", ["scripts/stop-server.sh"]);
    break;
  case "android":
    if (win) run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/build-android.ps1"]);
    else run("bash", ["scripts/build-android.sh"]);
    break;
  default:
    console.error(`Unknown task: ${task ?? "(none)"}`);
    process.exit(1);
}
