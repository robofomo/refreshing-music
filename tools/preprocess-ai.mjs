import { spawnSync } from "node:child_process";

function runNode(script, args) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  const ms = Date.now() - started;
  return { ...r, ms };
}

function fmtMs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function runStage(label, script, args) {
  const t0 = new Date().toISOString();
  console.log(`[preprocess:ai] ${t0} start ${label}`);
  const r = runNode(script, args);
  const t1 = new Date().toISOString();
  console.log(`[preprocess:ai] ${t1} done  ${label} (${fmtMs(r.ms)}) status=${r.status ?? 1}`);
  return r;
}

function main() {
  const args = process.argv.slice(2);
  const stems = runStage("stems", "tools/run-stems.mjs", args);
  const beats = runStage("beats", "tools/run-beats.mjs", args);
  const whisper = runStage("whisperx", "tools/run-whisperx.mjs", args);
  if (stems.status !== 0 || beats.status !== 0 || whisper.status !== 0) {
    process.exit(1);
  }
}

main();
