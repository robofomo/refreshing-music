import { spawnSync } from "node:child_process";

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
}

function main() {
  const args = process.argv.slice(2);
  const stems = runNode("tools/run-stems.mjs", args);
  const beats = runNode("tools/run-beats.mjs", args);
  const whisper = runNode("tools/run-whisperx.mjs", args);
  if (stems.status !== 0 || beats.status !== 0 || whisper.status !== 0) {
    process.exit(1);
  }
}

main();
