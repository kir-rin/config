// notify.log 옛 줄 → events-backfill.jsonl(status·shown·action, 원래 시각, backfill: true). 그 컴퓨터에서 한 번 돌린다
//   node events-backfill.mjs [--log <notify.log>] [--viewer <이 컴퓨터 이름>] [--out <파일>] [--force]
// 따로 파일에 쓴다(events.jsonl 은 실시간 기록만): 이미 있으면 건너뛴다(--force 면 다시 씀). events.jsonl 이 이미 있으면 그 첫 기록보다 앞선 줄만 —
// report 도 viewer 마다 실시간 첫 기록부터는 backfill 을 버린다(두 번 세지 않게)
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDotEnv, defaultDirs, selfLabel } from "./lib.mjs";
import { backfillEvents, parseEvents } from "./metrics.mjs";

defaultDirs();
loadDotEnv();
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = process.env.HERDR_PLUGIN_STATE_DIR;
const log = arg("--log") ?? join(dir, "notify.log");
const out = arg("--out") ?? join(dir, "events-backfill.jsonl");
const viewer = arg("--viewer") ?? selfLabel();

if (existsSync(out) && !process.argv.includes("--force")) {
  console.log(`이미 있어요: ${out} (다시 쓰려면 --force)`);
  process.exit(0);
}
let text;
try { text = readFileSync(log, "utf8"); } catch (e) { console.error(`notify.log 를 못 읽었어요: ${log} (${e.code ?? e.message})`); process.exit(1); }

// 실시간 기록이 시작된 때(그 뒤 줄은 events.jsonl 에 이미 있다)
let liveFrom = Infinity;
for (const f of ["events.jsonl.1", "events.jsonl"]) {
  try { for (const e of parseEvents(readFileSync(join(dir, f), "utf8"))) if (!e.backfill) liveFrom = Math.min(liveFrom, Date.parse(e.ts)); } catch { /* 없음 */ }
}
const events = backfillEvents(text, viewer, liveFrom);
const tmp = `${out}.${process.pid}.tmp`;
writeFileSync(tmp, events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
renameSync(tmp, out);
const by = (t) => events.filter((e) => e.type === t).length;
console.log(`${out}: ${events.length}개 (status ${by("status")} · shown ${by("shown")} · action ${by("action")}) viewer=${viewer}${Number.isFinite(liveFrom) ? ` · ${new Date(liveFrom).toISOString()} 앞까지만` : ""}`);
