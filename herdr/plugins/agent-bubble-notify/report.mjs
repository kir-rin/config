// AI 생산성 리포트 — events.jsonl(+ .1 + events-backfill.jsonl) → 사람 응답 지연·기다린 시간·처리량·재작업·동시 대기·말풍선 반응·시간대
//   node report.mjs [--days 7] [--since YYYY-MM-DD] [--json] [--remote <ssh 호스트>]… [--remote-dir <그쪽 상태 폴더>] [--file <jsonl>]…
//                   [--max-gap-h 8] [--dedup-sec 20] [--alias <label>=<이름>]…
// --remote: 다른 맥의 기록을 ssh 로 읽기만(cat) 해서 합친다. 두 맥이 서로의 세션도 보므로 같은 바뀜은 하나로(metrics.mjs dedupEvents).
// 머신 이름: MACHINE_NAMES(.env — 양쪽에 같은 줄)로 「집 맥의 local = 회사 맥의 home」을 맞춘다. 없으면 --alias home=<집 맥 viewer> 로
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadDotEnv, defaultDirs, parseMachineNames, PLUGIN_ID } from "./lib.mjs";
import { parseEvents, machineCanon, buildReport, DEFAULTS, MIX_KEYS, REWORK_MIN } from "./metrics.mjs";

defaultDirs();
loadDotEnv();
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const args = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const num = (name, d) => { const n = Number(arg(name)); return arg(name) !== undefined && Number.isFinite(n) && n > 0 ? n : d; };

const STATE_FILES = ["events.jsonl.1", "events.jsonl", "events-backfill.jsonl"];
const days = num("--days", 7);
const maxGapMs = num("--max-gap-h", DEFAULTS.maxGapMs / 3600e3) * 3600e3;
const dedupMs = num("--dedup-sec", DEFAULTS.dedupMs / 1e3) * 1e3;
const sinceArg = arg("--since");
let since;
if (sinceArg) {
  if (!/^\d{4}-\d\d-\d\d$/.test(sinceArg)) { console.error("--since 는 YYYY-MM-DD"); process.exit(2); }
  since = new Date(`${sinceArg}T00:00:00`).getTime();
} else {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  since = d.getTime();
}

const warn = [];
const events = [];
for (const f of STATE_FILES) {
  try { events.push(...parseEvents(readFileSync(join(process.env.HERDR_PLUGIN_STATE_DIR, f), "utf8"))); } catch { /* 없음 */ }
}
for (const f of args("--file")) {
  try { events.push(...parseEvents(readFileSync(f, "utf8"))); } catch (e) { warn.push(`${f}: 못 읽음(${e.code ?? e.message})`); }
}
// 그쪽 홈 기준 상대 경로(ssh 가 홈에서 시작) — ~ 풀기에 기대지 않는다
const remoteDir = arg("--remote-dir") ?? `.local/state/herdr/plugins/${PLUGIN_ID}`;
for (const host of args("--remote")) {
  if (!/^[A-Za-z0-9][\w.@-]*$/.test(host) || !/^[\w./~-]+$/.test(remoteDir)) { warn.push(`--remote ${host}: 이상한 이름`); continue; }
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "cat", ...STATE_FILES.map((f) => `${remoteDir}/${f}`), "2>/dev/null"], { encoding: "utf8", timeout: 60000, maxBuffer: 256 << 20 });
  const got = parseEvents(r.stdout);
  if (r.error || (!got.length && r.status === 255)) warn.push(`--remote ${host}: ssh 실패(${r.error?.message ?? `exit ${r.status}`})`);
  else if (!got.length) warn.push(`--remote ${host}: 기록이 없어요(${remoteDir})`);
  events.push(...got);
}

const alias = new Map(args("--alias").map((a) => a.split("=")).filter(([k, v]) => k && v).map(([k, v]) => [k.trim().toLowerCase(), v.trim()]));
const canon = machineCanon(parseMachineNames(process.env.AGENT_BUBBLE_MACHINE_NAMES), alias);
const rep = buildReport(events, { canon, since, until: Date.now(), maxGapMs, dedupMs });


// ---- 터미널 요약 ----
function dur(ms) {
  if (ms === null || ms === undefined) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분${s % 60 ? ` ${s % 60}초` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}시간${m % 60 ? ` ${m % 60}분` : ""}`;
}
const lat = (d) => (d.n ? `중앙 ${dur(d.median)} · p90 ${dur(d.p90)} (${d.n}건)` : "-");
const MIX_LABEL = { go: "가기", reply: "답하기", dismiss: "닫음", expired: "만료", cleared: "저절로 걷힘", none: "기록 없음" };
const mix = (b) => (b.shown ? `${b.shown}개 — ${MIX_KEYS.map((k) => `${MIX_LABEL[k]} ${b[k]}`).join(" · ")}${b.failed ? ` (못 감 ${b.failed})` : ""}` : "-");

function summary(rep) {
  const out = [];
  const t = rep.total;
  const range = `${new Date(since).toLocaleDateString("sv")} ~ ${new Date().toLocaleDateString("sv")}`;
  out.push(`AI 에이전트 응답 리포트 · ${range} · 머신 ${rep.machines.join(", ") || "-"} · 본 곳 ${rep.viewers.join(", ") || "-"}`);
  out.push(`이벤트 ${rep.events.inRange}개(옛 로그 ${rep.events.backfill}) · 두 맥 중복 ${rep.events.dedupDropped}개 뺌 · ${dur(maxGapMs)} 넘는 간격은 지연에서 뺌`);
  for (const w of warn) out.push(`! ${w}`);
  out.push("");
  out.push("[전체]");
  out.push(`  알림            끝남 ${t.done} · 입력 대기 ${t.blocked} (응답 기록 없음 ${t.unanswered} · 밤새 둠 ${t.overnight})`);
  out.push(`  응답 지연       끝남→다시 시작   ${lat(t.latency.done)}`);
  out.push(`                  입력 대기→해소   ${lat(t.latency.blocked)}`);
  out.push(`  처음 본 때까지  ${lat(t.firstLook)}`);
  out.push(`  기다린 시간     입력 대기 합 ${dur(t.blockedWaitMs)} · 끝난 뒤 다음 프롬프트까지 합 ${dur(t.doneWaitMs)}`);
  out.push(`  처리량          프롬프트 ${t.prompts} · 세션 ${t.sessions} · 활동 ${t.activeHours}시간 → 시간당 ${t.promptsPerHour.toFixed(1)}`);
  out.push(`  재작업          하루 ${REWORK_MIN}번 이상 끝난 세션 ${t.rework.sessionDays}(세션·일) · 세션·일 평균 ${t.rework.avgCycles.toFixed(1)}번 · 최대 ${t.rework.maxCycles}번`);
  out.push(`  동시 대기       최대 ${t.concurrency.max} · 평균 ${t.concurrency.avg.toFixed(1)}(하나라도 기다릴 때)`);
  for (const b of t.byConcurrency) if (b.n) out.push(`    ${b.bucket.padStart(3)}개 기다릴 때  ${lat(b)}`);
  out.push(`  말풍선          ${mix(t.bubbles)}`);
  if (t.bubbles.actionAfter.n) out.push(`                  누르기까지 ${lat(t.bubbles.actionAfter)}`);
  const rm = t.reminders;
  if (rm?.digests) out.push(`  다시 알림       묶음 ${rm.digests}번 · 줄 ${rm.shown}개 — 가기 ${rm.go} · 답 ${rm.reply} · 미룸 ${rm.snooze} · 그만 ${rm.mute} · 닫음 ${rm.dismissed}`);
  out.push("");
  out.push("[날짜별]   끝남 대기 | 끝남→시작 중앙/p90 | 대기 중앙 | 대기 합 | 프롬프트/활동h | 재작업 | 동시 최대");
  for (const d of rep.days) {
    const ld = d.latency.done, lb = d.latency.blocked;
    out.push(`  ${d.day} ${String(d.done).padStart(4)} ${String(d.blocked).padStart(4)} | ${ld.n ? `${dur(ld.median)}/${dur(ld.p90)}` : "-"} | ${lb.n ? dur(lb.median) : "-"} | ${dur(d.blockedWaitMs)} | ${d.prompts}/${d.activeHours} | ${d.rework.sessionDays} | ${d.concurrency.max}`);
  }
  out.push("");
  out.push("[시간대] 알림 수 · 끝남·대기 응답 중앙");
  const maxW = Math.max(1, ...rep.hours.map((h) => h.waits));
  for (const h of rep.hours) {
    if (!h.waits && !h.prompts) continue;
    out.push(`  ${String(h.hour).padStart(2, "0")}시 ${"█".repeat(Math.round((h.waits / maxW) * 30)).padEnd(30)} ${String(h.waits).padStart(4)}  ${h.latency.n ? dur(h.latency.median) : "-"}`);
  }
  return out;
}

// process.exit 은 안 쓴다 — 파이프로 넘길 때 긴 JSON 이 잘린다
if (argv.includes("--json")) console.log(JSON.stringify({ ...rep, warnings: warn }, null, 2));
else console.log(summary(rep).join("\n"));
