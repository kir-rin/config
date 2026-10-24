// pane.agent_status_changed → done·blocked 면 소리 + AgentBot 말풍선(누르면 이 pane 으로), working 이면 말풍선 걷기
// `node notify.mjs --test`(액션) → 지금 포커스된 pane 으로 시험 말풍선
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { loadDotEnv, modeEnabled, envFlag, envInt, readJsonEnv, paneInfo, sessionName, bus, bubbleId, findTranscript, sessionSummary } from "./lib.mjs";

loadDotEnv();
const TEST = process.argv.includes("--test");
if (!TEST && !modeEnabled()) process.exit(0);

const event = readJsonEnv("HERDR_PLUGIN_EVENT_JSON");
const context = readJsonEnv("HERDR_PLUGIN_CONTEXT_JSON");
const pane = TEST
  ? context.focused_pane_id ?? context.pane_id ?? process.env.HERDR_PANE_ID
  : event?.data?.pane_id ?? event?.pane_id ?? process.env.HERDR_PANE_ID;
if (!pane) process.exit(0);

let status = TEST ? "done" : String(event?.data?.agent_status ?? "").toLowerCase();

if (status === "working") {
  await bus(`/bubbles/${encodeURIComponent(bubbleId(pane))}/clear`);
  process.exit(0);
}
if (status !== "done" && status !== "blocked") process.exit(0);

// 깜빡임 거르기: 잠깐 기다렸다가 아직 같은 상태일 때만
if (!TEST) {
  await sleep(envInt("AGENT_BUBBLE_DELAY_MS", 1000));
  const now = String(paneInfo(pane)?.agent_status ?? "").toLowerCase();
  if (now && now !== status) process.exit(0);
}
const info = paneInfo(pane) ?? {};

// 보고 있는 pane 이면(포커스 + 터미널 앱이 맨 앞) 알리지 않는다
if (!TEST && info.focused && !envFlag("AGENT_BUBBLE_NOTIFY_FOCUSED", false) && terminalInFront()) process.exit(0);

playSound(status);

const title = info.label || info.terminal_title_stripped || info.agent || pane;
const fill = (tpl) => tpl.replaceAll("{title}", title).replaceAll("{agent}", info.agent ?? "agent");
const blocked = status === "blocked";
const text = fill(process.env[blocked ? "AGENT_BUBBLE_TEXT_BLOCKED" : "AGENT_BUBBLE_TEXT_DONE"] || (blocked ? "⚠️ {title} 확인이 필요해요" : "✅ {title} 끝났어요"));
// 유지 시간(초): 0 = 누를 때까지 남김. 그 밖은 1–3600
const ttlSec = envInt(blocked ? "AGENT_BUBBLE_TTL_BLOCKED" : "AGENT_BUBBLE_TTL_DONE", blocked ? 0 : 60);
const session = sessionName();
const detail = summaryOf(info, status);

await bus("/bubbles", {
  id: bubbleId(pane),
  text: text.slice(0, 500),
  kind: blocked ? "info" : "done",
  ...(detail ? { detail: detail.slice(0, 1200) } : {}),
  ...(ttlSec === 0 ? { sticky: true } : { ttlMs: Math.min(Math.max(ttlSec, 1), 3600) * 1000 }),
  focus: { kind: "herdr", pane, ...(session ? { session } : {}) },
});

// 무엇을 끝냈나·무엇을 묻나(Claude Code 만 — 세션 기록이 있을 때). AGENT_BUBBLE_SUMMARY=off 면 안 붙인다
function summaryOf(p, st) {
  if (!envFlag("AGENT_BUBBLE_SUMMARY", true)) return null;
  const sid = p.agent_session?.agent === "claude" ? p.agent_session.value : null;
  const file = sid && findTranscript(sid);
  if (!file) return null;
  try { return sessionSummary(file, st, envInt("AGENT_BUBBLE_SUMMARY_CHARS", 280)); } catch { return null; }
}

function playSound(st) {
  const key = st === "blocked" ? "AGENT_BUBBLE_SOUND_BLOCKED" : "AGENT_BUBBLE_SOUND_DONE";
  const file = process.env[key]?.trim() || (st === "blocked" ? "/System/Library/Sounds/Funk.aiff" : "/System/Library/Sounds/Glass.aiff");
  if (file.toLowerCase() === "off") return;
  spawn("afplay", [file], { detached: true, stdio: "ignore" }).unref();
}

// 맨 앞 앱이 터미널인가(herdr 를 띄운 앱은 모르니 흔한 터미널 이름으로). 못 알아내면 false — 알리는 쪽으로
function terminalInFront() {
  const r = spawnSync("osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'], { encoding: "utf8", timeout: 2000 });
  return /wezterm|ghostty|iterm|kitty|alacritty|warp|terminal/i.test(r.stdout ?? "");
}
