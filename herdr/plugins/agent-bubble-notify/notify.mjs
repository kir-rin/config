// pane.agent_status_changed → done·blocked 면 소리 + AgentBot 말풍선(누르면 이 pane 으로), working 이면 말풍선 걷기
// `node notify.mjs --test`(액션) → 지금 포커스된 pane 으로 시험 말풍선
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { loadDotEnv, modeEnabled, envFlag, envInt, readJsonEnv, paneInfo, sessionName, bus, bubbleId, findTranscript, sessionSummary, sessionMaterial, note, swapPaneStatus, speak, sessionButtons, herdrRef, paneSource } from "./lib.mjs";

loadDotEnv();
const TEST = process.argv.includes("--test");

const event = readJsonEnv("HERDR_PLUGIN_EVENT_JSON");
const context = readJsonEnv("HERDR_PLUGIN_CONTEXT_JSON");
const pane = TEST
  ? context.focused_pane_id ?? context.pane_id ?? process.env.HERDR_PANE_ID
  : event?.data?.pane_id ?? event?.pane_id ?? process.env.HERDR_PANE_ID;
if (!pane) process.exit(0);

let status = TEST ? "done" : String(event?.data?.agent_status ?? "").toLowerCase();
// 화면에 보이는 pane(같은 탭의 분할 등)은 끝나도 herdr 가 「본 것」으로 쳐서 done 이 아니라 바로 idle 이 온다 → working 다음 idle 도 끝남으로
// 꺼 둔 동안에도 상태는 적는다 — 다시 켰을 때 묵은 working 으로 엉뚱한 말풍선이 뜨지 않게
const prev = TEST ? undefined : swapPaneStatus(pane, status);
if (!TEST && !modeEnabled()) process.exit(0);
note(`${pane} event=${status}${prev ? ` prev=${prev}` : ""}${TEST ? " (test)" : ""}`);
if (status === "idle" && prev === "working") status = "done";

// 입력 대기였다가 바로 idle(직접 답했거나 취소) → 그 대기 말풍선은 걷는다
if (status === "working" || (status === "idle" && prev === "blocked")) {
  await bus(`/bubbles/${encodeURIComponent(bubbleId(pane))}/clear`);
  process.exit(0);
}
if (status !== "done" && status !== "blocked") process.exit(0);

// 깜빡임 거르기: 잠깐 기다렸다가 아직 같은 상태일 때만
if (!TEST) {
  await sleep(envInt("AGENT_BUBBLE_DELAY_MS", 1000));
  const now = String(paneInfo(pane)?.agent_status ?? "").toLowerCase();
  const same = now === status || (status === "done" && now === "idle"); // 끝난 뒤 봤으면 idle
  if (now && !same) { note(`${pane} skip: now ${now}`); process.exit(0); }
}
const info = paneInfo(pane) ?? {};

// 보고 있는 pane 이면(포커스 + 터미널 앱이 맨 앞) 알리지 않는다
if (!TEST && info.focused && !envFlag("AGENT_BUBBLE_NOTIFY_FOCUSED", false) && terminalInFront()) { note(`${pane} skip: watching`); process.exit(0); }

const title = info.label || info.terminal_title_stripped || info.agent || pane;
const fill = (tpl) => tpl.replaceAll("{title}", title).replaceAll("{agent}", info.agent ?? "agent");
const blocked = status === "blocked";
const text = fill(process.env[blocked ? "AGENT_BUBBLE_TEXT_BLOCKED" : "AGENT_BUBBLE_TEXT_DONE"] || (blocked ? "⚠️ {title} 확인이 필요해요" : "✅ {title} 끝났어요"));
// 유지 시간(초): 0 = 누를 때까지 남김. 그 밖은 1–3600
const ttlSec = envInt(blocked ? "AGENT_BUBBLE_TTL_BLOCKED" : "AGENT_BUBBLE_TTL_DONE", 0);
const session = sessionName();
const transcript = transcriptOf(info);
// 캐릭터 한 줄(AGENT_BUBBLE_CHARACTER_LINE): 데몬이 지금 캐릭터 말투로 한 문장을 만들어 같은 말풍선을 바꾼다 — 그동안 보일 짧은 요약만 본문에
const characterLine = envFlag("AGENT_BUBBLE_CHARACTER_LINE", true);
const material = characterLine && transcript ? safe(() => sessionMaterial(transcript, status)) : null;
const detail = transcript && envFlag("AGENT_BUBBLE_SUMMARY", true)
  ? safe(() => sessionSummary(transcript, status, material ? 120 : envInt("AGENT_BUBBLE_SUMMARY_CHARS", 280)))
  : null;

const res = await bus("/bubbles", {
  id: bubbleId(pane),
  text: text.slice(0, 500),
  kind: blocked ? "info" : "done",
  ...(detail ? { detail: detail.slice(0, 1200) } : {}),
  ...(ttlSec === 0 ? { sticky: true } : { ttlMs: Math.min(Math.max(ttlSec, 1), 3600) * 1000 }),
  buttons: sessionButtons(status),
  ref: herdrRef({ pane, session }),
  source: paneSource({ pane_id: pane, ...info }),
  ...(material ? { summarize: { state: blocked ? "blocked" : "done", title: title.slice(0, 200), material } } : {}),
}, material ? 25000 : 3000);
note(`${pane} bubble ${res ? "sent" : "FAILED"} ${status} material=${material ? material.length : 0} line=${res?.text ? JSON.stringify(res.text) : "-"}`);

// 읽기: 캐릭터 한 줄이 나왔으면 그 줄, 아니면 처음 글
speak(status, res?.text || text);

// 그 pane 의 세션 기록 파일(Claude Code 만 — herdr 가 세션 id 를 알 때)
function transcriptOf(p) {
  const sid = p.agent_session?.agent === "claude" ? p.agent_session.value : null;
  return (sid && findTranscript(sid)) || null;
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}

// 맨 앞 앱이 터미널인가(herdr 를 띄운 앱은 모르니 흔한 터미널 이름으로). 못 알아내면 false — 알리는 쪽으로
function terminalInFront() {
  const r = spawnSync("osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'], { encoding: "utf8", timeout: 2000 });
  return /wezterm|ghostty|iterm|kitty|alacritty|warp|terminal/i.test(r.stdout ?? "");
}
