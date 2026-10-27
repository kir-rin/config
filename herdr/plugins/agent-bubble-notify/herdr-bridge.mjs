// herdr ↔ AgentBot 다리 — 늘 떠 있는 프로세스(launchd — herdr-bridge-install.sh). 설정은 플러그인 .env
// 1) 말풍선 버튼: AgentBot 은 herdr 를 모른다. 말풍선을 누르면 데몬이 SSE bubble-action { id, key, ref } 를 내보내고(GET /events?actions=1),
//    여기서 ref(lib.mjs herdrRef)를 읽어 그 세션으로 간다 — 이 컴퓨터든 다른 컴퓨터(herdr 저장 머신)든.
// 2) 다른 컴퓨터 세션 알림: herdr 플러그인은 그 머신 서버에서만 돌고 이벤트도 넘어오지 않으므로,
//    몇 초마다 `herdr --machine <이름> agent list` 로 상태를 물어 바뀐 것을 notify.mjs 와 같은 규칙으로 알린다(AGENT_BUBBLE_MACHINE_*)
// 3) 답 안 한 세션 다시 알림(remind.mjs): 아는 세션 전부(이 컴퓨터 agent list·다른 컴퓨터 poll)·events.jsonl 로 「답 안 한 세션 N개」 묶음 하나.
//    간격은 .env AGENT_BUBBLE_REMIND_EVERY_MIN > AgentBot 설정(GET /prefs/remind) > 3분
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadDotEnv, modeEnabled, envFlag, envInt, bus, busRaw, note, speak, sessionButtons, herdrRef, parseHerdrRef, paneSource, bubbleKind, bubbleLife, machineBubbleId, logEvent, SESSION_BUTTONS, REPLY_BUTTON } from "./lib.mjs";
import { parseEvents } from "./metrics.mjs";
import { remindConfig, fetchRemindPref, prefCache, newTracker, applyEvents, applyLive, markShown, digestPlan, digestActions, stillShown, isRemindId, remindItemId, sessionKey, summaryText, snoozeLabel, remindMeta, metaFallback, postWithFallback, SUMMARY_ID, REMIND_GROUP } from "./remind.mjs";

loadDotEnv();
const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const POLL_MS = Math.max(envInt("AGENT_BUBBLE_MACHINE_POLL_MS", 5000), 2000);
const REBASE_MS = 5 * 60e3; // 이만큼 못 물었으면 다시 붙을 때 그사이 끝난 것들을 한꺼번에 띄우지 않고 지금 상태만 받아 둔다
const LIST_MS = 60e3;
// 사이드바 차례(이 컴퓨터·저장 머신 워크스페이스 목록)는 미리 받아 둔다 — 누를 때 ssh 를 기다리지 않게(회사→집 8–10초)
const SIDEBAR_MS = Math.max(envInt("AGENT_BUBBLE_SIDEBAR_REFRESH_MS", 30000), 5000);
const SIDEBAR_STALE_MS = Math.max(envInt("AGENT_BUBBLE_SIDEBAR_STALE_MS", 180000), SIDEBAR_MS);

// 실패하면 null(err 를 알고 싶으면 runRaw)
const runRaw = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { encoding: "utf8", timeout: 20000, maxBuffer: 8 << 20, ...opts }, (err, stdout, stderr) => resolve({ err, stdout: stdout ?? "", out: `${stdout ?? ""}\n${stderr ?? ""}` }));
});
const run = async (args, timeout = 20000) => { const r = await runRaw(HERDR, args, { timeout }); return r.err ? null : r.stdout; };
const json = (out) => { try { return JSON.parse(out); } catch { return null; } };

// 볼 머신: AGENT_BUBBLE_MACHINES(쉼표로 여럿) 아니면 켜 둔 저장 머신 전부
async function machines() {
  const set = String(process.env.AGENT_BUBBLE_MACHINES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (set.length) return set;
  const list = json(await run(["machine", "list", "--json"], 5000));
  const rows = Array.isArray(list) ? list : list?.machines ?? [];
  return rows.filter((m) => m?.enabled !== false && m?.label).map((m) => m.label);
}

export { machineBubbleId }; // lib.mjs 로 옮김(backfill 도 쓴다)

// 직전(prev: pane → {status, seq, focused})과 지금 목록 → 알릴 것·걷을 것. 순수 함수
// done: 끝남(done 으로 바뀜, done 인데 그사이 다시 돌았음 = seq 바뀜, 보이는 pane 이라 working → idle)
// blocked: 입력 대기로 바뀜. 걷기: 다시 돎·대기였다가 idle·사용자가 그 pane 으로 감(focused)·pane 사라짐
// 리포트 재료: transitions(상태가 바뀜 — 물은 사이 한 바퀴 돌아 같은 상태면 missed, 사라지면 to: gone)·focused(그 pane 으로 감)
export function machineChanges(prev, agents) {
  const notify = [], clear = [], next = new Map(), transitions = [], focused = [];
  for (const a of agents) {
    const pane = a?.pane_id;
    if (typeof pane !== "string") continue;
    const now = { status: String(a.agent_status ?? "").toLowerCase(), seq: a.state_change_seq, focused: !!a.focused };
    next.set(pane, now);
    const p = prev.get(pane);
    if (!p) continue; // 처음 본 pane 은 받아만 둔다
    const moved = p.seq !== now.seq;
    if (p.status !== now.status) transitions.push({ pane, agent: a.agent, from: p.status, to: now.status });
    else if (moved && (now.status === "done" || now.status === "blocked")) transitions.push({ pane, agent: a.agent, from: p.status, to: now.status, missed: true });
    if (now.focused && !p.focused) focused.push(pane);
    if (now.status === "done" && (p.status !== "done" || moved)) notify.push({ agent: a, state: "done" });
    else if (now.status === "idle" && p.status === "working") notify.push({ agent: a, state: "done" });
    else if (now.status === "blocked" && (p.status !== "blocked" || moved)) notify.push({ agent: a, state: "blocked" });
    else if ((now.status === "working" && p.status !== "working") || (now.status === "idle" && p.status === "blocked") || (now.focused && !p.focused)) clear.push(pane);
  }
  for (const [pane, p] of prev) if (!next.has(pane)) { clear.push(pane); transitions.push({ pane, from: p.status, to: "gone" }); }
  return { notify, clear, next, transitions, focused };
}

// 캐릭터 한 줄 재료: 그 pane 화면 끝(세션 기록 파일은 그 머신에 있어 못 읽는다)
async function screenTail(m, pane) {
  // 화면 글자 그대로(JSON 아님). 입력 대기·작업 중이면 지난 화면은 못 읽어(agent_not_idle) 지금 보이는 화면만
  const read = (src) => run(["--machine", m, "agent", "read", pane, "--source", src, ...(src === "visible" ? [] : ["--lines", "80"]), "--format", "text"]);
  const t = (await read("recent-unwrapped")) ?? (await read("visible"));
  return t?.trim() ? t.trim().slice(-3000) : null;
}

async function notify(m, a, state) {
  if (!modeEnabled()) return;
  const pane = a.pane_id;
  const blocked = state === "blocked";
  const title = a.label || a.terminal_title_stripped || a.name || a.agent || pane;
  const fill = (tpl) => tpl.replaceAll("{title}", title).replaceAll("{agent}", a.agent ?? "agent");
  const text = `[${m}] ${fill(process.env[blocked ? "AGENT_BUBBLE_TEXT_BLOCKED" : "AGENT_BUBBLE_TEXT_DONE"] || (blocked ? "⚠️ {title} 확인이 필요해요" : "✅ {title} 끝났어요"))}`;
  const tail = envFlag("AGENT_BUBBLE_CHARACTER_LINE", true) ? await screenTail(m, pane) : null;
  const material = tail ? `[터미널 화면 끝 — ${m} 컴퓨터]\n${tail}` : null;
  const res = await bus("/bubbles", {
    id: machineBubbleId(m, pane),
    text: text.slice(0, 500),
    kind: bubbleKind(state),
    ...bubbleLife(state),
    buttons: sessionButtons(state),
    ref: herdrRef({ pane, machine: m }),
    source: paneSource(a, m),
    ...(material ? { summarize: { state: blocked ? "blocked" : "done", title: `${m} · ${title}`.slice(0, 200), material } } : {}),
  }, material ? 25000 : 3000);
  const life = bubbleLife(state);
  if (res) logEvent("shown", { machine: m, pane, agent: a.agent, id: `ext:${machineBubbleId(m, pane)}`, kind: bubbleKind(state), buttons: sessionButtons(state).map((b) => b.key), ...(life.ttlMs ? { ttlMs: life.ttlMs } : {}) });
  note(`[${m}] ${pane} bubble ${res ? "sent" : "FAILED"} ${state} material=${material ? material.length : 0} line=${res?.text ? JSON.stringify(res.text) : "-"}`);
  speak(state, res?.text || text);
}

const clearBubble = (m, pane) => bus(`/bubbles/${encodeURIComponent(`ext:${machineBubbleId(m, pane)}`)}/clear`);

// 머신마다: 직전 상태, 마지막으로 물은 때, 실패하면 쉬는 시간(최대 2분)
const watch = new Map();
async function poll(m) {
  const w = watch.get(m) ?? { prev: null, okAt: 0, backoff: 0, nextAt: 0, busy: false };
  watch.set(m, w);
  if (w.busy || Date.now() < w.nextAt) return;
  w.busy = true;
  try {
    const out = json(await run(["--machine", m, "agent", "list"]));
    const agents = out?.result?.agents;
    if (!Array.isArray(agents)) {
      w.backoff = Math.min(w.backoff ? w.backoff * 2 : POLL_MS, 120e3);
      w.nextAt = Date.now() + w.backoff;
      if (w.backoff >= 120e3) note(`[${m}] unreachable — retry in 2m`);
      return;
    }
    const stale = !w.prev || Date.now() - w.okAt > REBASE_MS;
    const { notify: todo, clear, next, transitions, focused } = machineChanges(stale ? new Map() : w.prev, agents);
    if (stale) {
      note(`[${m}] baseline ${next.size} panes`);
      if (w.prev) for (const pane of w.prev.keys()) if (!next.has(pane)) clear.push(pane); // 끊긴 사이 닫힌 pane 의 말풍선
    }
    w.prev = next;
    w.agents = new Map(agents.filter((a) => typeof a?.pane_id === "string").map((a) => [a.pane_id, a])); // 다시 알림 글·머리줄
    w.okAt = Date.now();
    w.backoff = 0;
    for (const t of transitions) logEvent("status", { machine: m, ...t });
    for (const pane of focused) logEvent("focus", { machine: m, pane });
    for (const pane of clear) clearBubble(m, pane);
    for (const { agent, state } of todo) {
      note(`[${m}] ${agent.pane_id} event=${state}`);
      notify(m, agent, state).catch((e) => note(`[${m}] ${agent.pane_id} notify error ${e.message}`)); // 캐릭터 한 줄을 기다리는 동안에도 계속 묻는다
    }
  } finally {
    w.busy = false;
  }
}

// ---- 1) 말풍선 버튼 → 그 세션으로 · [답하기] → 그 세션에 보내기 ----

// herdr 오류(출력의 JSON { error: { code } }) → 사용자에게 보일 말. fallback: 모르는 오류일 때
export function focusError(out, fallback = "herdr 세션으로 가지 못했어요.") {
  let code = "";
  for (const line of String(out ?? "").split("\n")) {
    try { code = JSON.parse(line)?.error?.code ?? code; } catch { /* JSON 이 아닌 줄 */ }
  }
  if (code === "agent_not_found" || code === "pane_not_found") return "그 세션이 이미 닫혔어요.";
  if (code === "server_not_running") return "herdr 가 꺼져 있어요.";
  if (code === "agent_blocked") return "세션이 확인을 기다리고 있어요 — 세션에서 답해 주세요.";
  return fallback;
}

// ref → herdr 대상 인자(이 컴퓨터 기본 세션이면 없음)
export const targetArgs = (r) => (r.machine ? ["--machine", r.machine] : r.session ? ["--session", r.session] : []);

// herdr 를 띄우는 터미널 앱. AGENT_BUBBLE_TERMINAL 이 있으면 그것, 없으면 돌고 있는 것 중 앞의 것
const TERMINALS = [["WezTerm", "/WezTerm.app/"], ["Ghostty", "/Ghostty.app/"], ["iTerm", "/iTerm.app/"], ["kitty", "/kitty.app/"], ["Alacritty", "/Alacritty.app/"], ["Warp", "/Warp.app/"], ["Terminal", "/Terminal.app/"]];
export function pickTerminal(psText, override) {
  if (typeof override === "string" && /^[\w .-]{1,64}$/.test(override.trim())) return override.trim();
  return TERMINALS.find(([, m]) => String(psText ?? "").includes(m))?.[0] ?? null;
}

// herdr 는 붙어 있는 화면(클라이언트)을 다른 머신으로 넘기는 명령이 없다(herdr#5531 — CLI --machine 은 그 서버만 바꾼다).
// 그래서 사이드바 키 길(prefix → w → ↑↓ → Enter)을 herdr 화면에 대신 보낸다(WezTerm 만 — wezterm cli send-text)

// herdr config 의 [keys] 표만 → { prefix(배열이면 첫 값), 값 목록 }. 다른 표의 같은 이름은 안 본다
function keysTable(configText) {
  let inKeys = false;
  const keys = {};
  for (const raw of String(configText ?? "").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const t = line.match(/^\[([^\]]+)\]$/);
    if (t) { inKeys = t[1].trim() === "keys"; continue; }
    if (line.startsWith("[[")) { inKeys = false; continue; }
    const kv = inKeys && line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (kv) keys[kv[1]] = [...kv[2].matchAll(/"([^"]*)"/g)].map((x) => x[1].trim().toLowerCase());
  }
  return keys;
}

// 사이드바 키 길에 쓸 prefix 바이트. ctrl+<글자> 만(명령 인자로 보내므로 NUL 인 ctrl+space 는 못 보낸다).
// prefix+w 를 다른 동작에 묶어 두었으면 null — 확실하지 않으면 키를 보내지 않는다(엉뚱한 pane 의 승인 창에 Enter 가 들어가지 않게)
export function prefixBytes(configText) {
  const keys = keysTable(configText);
  const c = (keys.prefix?.[0] ?? "ctrl+b").match(/^ctrl\+([a-z])$/);
  if (!c) return null;
  if (Object.entries(keys).some(([k, v]) => k !== "prefix" && v.includes("prefix+w"))) return null;
  return String.fromCharCode(c[1].charCodeAt(0) - 96);
}

// 사이드바 차례([{ machine, workspace }], 이 컴퓨터는 machine '') 에서 지금 칸 → 갈 칸: 아래(+)·위(-) 몇 칸. 못 찾으면 null
export function navSteps(order, from, to) {
  const at = (x) => order.findIndex((o) => o.machine === x.machine && o.workspace === x.workspace);
  const i = at(from), j = at(to);
  return i < 0 || j < 0 ? null : j - i;
}

// prefix → w → ↓/↑ × n → Enter
export const navKeys = (prefix, steps) => [prefix, "w", ...Array(Math.abs(steps)).fill(steps > 0 ? "\x1b[B" : "\x1b[A"), "\r"];
// 한 번에 보낼 글(send-text 한 번) — 키마다 쉬면 선택이 따라락 움직이고 그사이 친 글자가 끼어든다. herdr 0.9.5 는 한 덩어리로 받아도 그대로 따른다
export const navBurst = (prefix, steps) => navKeys(prefix, steps).join("");

// ---- 사이드바 차례 캐시: machine('' = 이 컴퓨터) → { ws: [{ workspace, focused }] | null(못 받음), at } ----
const sidebar = new Map();
let saved = { list: [], at: 0 }; // 켜 둔 저장 머신(machine list 차례)
export const cacheFresh = (entry, now, maxAge) => !!entry && now - entry.at <= maxAge;
// 사이드바 차례([{ machine, workspace, focused }]): 이 컴퓨터 → 저장 머신 차례로. fresh(방금 받은 것)가 캐시보다 먼저, 못 받은 머신은 빠진다(사이드바에서도 빠진다)
export function sidebarOrder(machines, cache, fresh = new Map()) {
  return machines.flatMap((m) => {
    const ws = (fresh.get(m) ?? cache.get(m))?.ws;
    return Array.isArray(ws) ? ws.map((w) => ({ machine: m, workspace: w.workspace, focused: !!w.focused })) : [];
  });
}
async function fetchWorkspaces(machine) {
  const out = await run([...(machine ? ["--machine", machine] : []), "workspace", "list"], machine ? 15000 : 5000);
  const ws = json(out)?.result?.workspaces;
  const entry = { ws: Array.isArray(ws) ? ws.map((w) => ({ workspace: w.workspace_id, focused: !!w.focused })) : null, at: Date.now() };
  sidebar.set(machine, entry);
  return entry;
}
async function savedMachines() {
  const list = json(await run(["machine", "list", "--json"], 5000));
  if (!Array.isArray(list)) return null;
  const on = list.filter((m) => m?.enabled !== false);
  saved = { list: on.map((m) => m.label), at: Date.now() };
  return { saved: saved.list, on: on.find((m) => m.selected)?.label ?? "" };
}
// 뒤에서 늘: 저장 머신 목록 + 머신마다 워크스페이스(원격은 15초까지)
let refreshing = false;
async function refreshSidebar() {
  if (refreshing) return;
  refreshing = true;
  try {
    await savedMachines();
    await Promise.all(["", ...saved.list].map(fetchWorkspaces));
  } finally {
    refreshing = false;
  }
}

// wezterm cli list 의 pane 중 herdr 화면(클라이언트)이 도는 것: `ps -axo pid,tty,comm` 에서 터미널(tty)에 붙은 herdr 의 tty 로. 없으면 null
// (herdr 서버·브리지는 tty 가 없다(??), herdr 안 pane 의 herdr 명령은 herdr 의 tty 라 WezTerm pane 과 안 겹친다)
export function clientPane(panes, psText) {
  const ttys = new Set();
  for (const line of String(psText ?? "").split("\n")) {
    const [, tty, ...comm] = line.trim().split(/\s+/);
    if (tty && tty !== "??" && /(^|\/)herdr$/.test(comm.join(" "))) ttys.add(`/dev/${tty}`);
  }
  return (Array.isArray(panes) ? panes : []).find((p) => ttys.has(p?.tty_name))?.pane_id ?? null;
}

// 지금 화면: 어느 머신을 보고 있나(machine list 의 selected — 이 컴퓨터라 빠르다) + 그 머신의 워크스페이스(지금 칸을 알려고 늘 새로).
// 그 세션으로 가는 agent focus 와 같이 돌린다(그 머신이 원격이면 ssh 를 기다리는 시간이 겹친다)
async function screenState() {
  const m = await savedMachines();
  if (!m) return null;
  return { ...m, here: await fetchWorkspaces(m.on) };
}

// herdr 화면을 그 머신(이 컴퓨터는 '')의 그 워크스페이스로. 이미 그 머신을 보고 있으면 그대로(agent focus 가 이미 옮겼다). 못 하면 false
async function showOnScreen(machine, workspace, screenP) {
  const screen = await screenP;
  if (!screen) return false;
  if (screen.on === machine) return true;
  const wz = ["/opt/homebrew/bin/wezterm", "/usr/local/bin/wezterm", "/Applications/WezTerm.app/Contents/MacOS/wezterm"].find((p) => existsSync(p));
  const gui = (await runRaw("pgrep", ["-x", "wezterm-gui"])).stdout.trim().split("\n")[0];
  const sock = gui && join(homedir(), ".local", "share", "wezterm", `gui-sock-${gui}`);
  if (!wz || !sock || !existsSync(sock)) return false;
  const wzOpts = { env: { ...process.env, WEZTERM_UNIX_SOCKET: sock }, timeout: 5000 };
  const pane = clientPane(json((await runRaw(wz, ["cli", "list", "--format", "json"], wzOpts)).stdout), (await runRaw("ps", ["-axo", "pid,tty,comm"])).stdout);
  let config = "";
  try { config = readFileSync(join(homedir(), ".config", "herdr", "config.toml"), "utf8"); } catch { /* 기본 prefix */ }
  const prefix = prefixBytes(config);
  if (pane === null || !prefix) return false;
  // 사이드바 차례: 이 컴퓨터 워크스페이스 → 켜 둔 저장 머신 차례로. 뒤에서 받아 둔 것을 쓰고, 오래된(SIDEBAR_STALE_MS) 것만 지금 받는다
  const machines = ["", ...screen.saved];
  const now = Date.now();
  await Promise.all(machines.filter((m) => m !== screen.on && !cacheFresh(sidebar.get(m), now, SIDEBAR_STALE_MS)).map(fetchWorkspaces));
  const order = sidebarOrder(machines, sidebar, new Map([[screen.on, screen.here]]));
  const from = order.find((o) => o.machine === screen.on && o.focused);
  const steps = from ? navSteps(order, from, { machine, workspace }) : null;
  if (steps === null) return false;
  if (steps === 0) return true;
  await runRaw(wz, ["cli", "send-text", "--no-paste", "--pane-id", String(pane), navBurst(prefix, steps)], wzOpts);
  return true;
}

// 그 세션으로: herdr 서버에서 pane 포커스(워크스페이스·탭도) → 화면을 그 머신으로 → 터미널 앱을 앞으로. 못 가면 이유
async function go(r) {
  const screenP = r.session ? null : screenState().catch(() => null); // 화면 상태는 focus 와 같이(원격이면 ssh 시간이 겹친다)
  const f = await runRaw(HERDR, [...targetArgs(r), "agent", "focus", r.pane], { timeout: 15000 });
  if (f.err) return focusError(f.out);
  const app = pickTerminal((await runRaw("ps", ["-axo", "comm"])).stdout, process.env.AGENT_BUBBLE_TERMINAL);
  if (app) await runRaw("open", ["-a", app]); // 못 띄워도 pane 은 옮겼다
  if (r.session) return null; // 이름 붙은 세션은 따로 붙은 화면 — 사이드바 이동은 안 한다
  if (!(await showOnScreen(r.machine ?? "", r.pane.split(":")[0], screenP))) return `세션은 골라 뒀어요. herdr 사이드바에서 ${r.machine ?? "Local"} 로 가 주세요.`;
  return null;
}

// [답하기]: 쓴 말을 그 세션에 프롬프트로(herdr agent prompt — 화면은 안 옮긴다). 셸 없이 인자로만, 저장 머신은 ssh 너머라 15초까지. 못 보내면 이유
// herdr 는 세션이 입력 대기(blocked)면 아무것도 넣지 않고 agent_blocked 로 거절한다
async function prompt(r, text) {
  const f = await runRaw(HERDR, [...targetArgs(r), "agent", "prompt", r.pane, text], { timeout: 15000 });
  return f.err ? focusError(f.out, "세션에 보내지 못했어요.") : null;
}

// bubble-action → 할 일: default = 가기, reply(+ text) = 보내기. 모르는 key·이상한 ref 면 null. 순수 함수
export function actionPlan({ key, ref, text }) {
  const r = typeof ref === "string" ? parseHerdrRef(ref) : null;
  if (!r) return null;
  if (key === "default") return { kind: "go", r };
  const t = typeof text === "string" ? text.trim() : "";
  if (key === "reply" && t && t.length <= 2000) return { kind: "reply", r, text: t };
  return null;
}

// 우리(herdr 플러그인)가 띄운 말풍선인가 — id 가 ext:herdr: 로 시작. 아니면 다른 프로그램 몫이라 건드리지 않는다
const ours = (id) => typeof id === "string" && id.startsWith("ext:herdr:");

// 말풍선(세션)마다 누름 줄 — 겹쳐 누르면 버리지 않고 차례대로(사이드바 키가 겹쳐 들어가지 않게 하나씩). 순수 함수:
// 답(reply)은 다 차례대로, 바로 앞(기다리는 것 또는 지금 하는 것)과 같은 글이면 하나로 · 가기(go)는 마지막 것만(기다리던 가기는 버림, 지금 가는 중이면 더 안 넣음)
// → { queue, collapsed }(collapsed = 이번 누름은 합쳐졌다)
export function enqueueAction(queue, running, item) {
  const same = (x) => x && x.kind === item.kind && (x.kind !== "reply" || x.text === item.text);
  if (item.kind === "go") {
    const rest = queue.filter((x) => x.kind !== "go");
    if (!rest.length && same(running)) return { queue: rest, collapsed: true };
    return { queue: [...rest, item], collapsed: false };
  }
  if (same(queue.at(-1) ?? running)) return { queue, collapsed: true };
  return { queue: [...queue, item], collapsed: false };
}

const lanes = new Map(); // 말풍선 id → { queue, running }

// 처리 결과를 앱에 알린다(POST /bubbles/:id/result — 오버레이·폰 누름 줄이 다음 것을 보낸다). 예전 데몬이면 null
const result = (id, ok, note) => bus(`/bubbles/${encodeURIComponent(id)}/result`, { ok, ...(note ? { note: note.slice(0, 200) } : {}) });

async function onAction({ id, key, ref, text }) {
  if (!ours(id)) return;
  if (isRemindId(id) && (await remindAction(id, key, ref))) return;
  const plan = actionPlan({ key, ref, text });
  const lane = lanes.get(id) ?? { queue: [], running: null };
  lanes.set(id, lane);
  const item = plan ? { ...plan, id, key, ref } : { kind: "bad", id, key, ref };
  const q = enqueueAction(lane.queue, lane.running, item);
  lane.queue = q.queue;
  if (q.collapsed) { note(`action ${id} ${key} collapsed`); await result(id, true); return; }
  if (lane.running) return; // 앞 것이 끝나면 이어서
  try {
    while (lane.queue.length) {
      lane.running = lane.queue.shift();
      await runAction(lane.running);
    }
  } finally {
    lane.running = null;
    if (!lane.queue.length) lanes.delete(id);
  }
}

async function runAction({ id, key, ref, kind, r, text }) {
  const err = kind === "bad" ? "이 알림은 어디로 가야 할지 몰라요." : kind === "reply" ? await prompt(r, text) : await go(r);
  // 보낸 말은 기록에 남기지 않는다(길이만)
  logEvent("action", { machine: r?.machine ?? "local", ...(r ? { pane: r.pane } : {}), id, key, ok: !err, ...(err ? { error: err } : {}), ...(kind === "reply" ? { replyLen: text.length } : {}) });
  note(`action ${id} ${key} → ${r ? `${r.machine ? `${r.machine}/` : ""}${r.pane}` : "?"}${kind === "reply" ? ` text=${text.length}자` : ""} ${err ?? "ok"}`);
  const remind = !err && isRemindId(id) && r;
  if (remind) logEvent("remind", { action: kind === "reply" ? "reply" : "go", machine: r.machine ?? "local", pane: r.pane });
  const told = await result(id, !err, err ?? undefined);
  // 갔으면(보냈으면) 걷는다 — 그사이 같은 id 로 새 알림이 왔으면(ref 가 다르면) 그건 둔다
  if (!err) {
    await bus(`/bubbles/${encodeURIComponent(id)}/clear`, { ifRef: ref });
    if (remind && shown.delete(sessionKey(r.machine, r.pane))) await syncSummary(); // 다시 알림 줄 — 입력 대기면 다음 때 다시
    return;
  }
  // 못 갔는데 예전 데몬(결과 길 없음)이면 같은 말풍선을 이유로 바꾼다(버튼 없이, 잠깐)
  if (!told) await bus("/bubbles", { id, text: err, kind: "error", ttlMs: 8000 });
}

// 말풍선이 닫힘(bubble-closed { id, reason: dismissed|expired|cleared, ref? }) → 리포트 재료. ref 로 머신·pane 을 되찾는다
function onClosed({ id, reason, ref }) {
  if (!ours(id)) return;
  const r = typeof ref === "string" ? parseHerdrRef(ref) : null;
  if (isRemindId(id)) return remindClosed(id, reason, r);
  const status = r ? liveAgent(r.machine ?? "local", r.pane)?.status : undefined; // 닫힐 때 세션 상태(다시 알림 재료)
  logEvent("closed", { machine: r?.machine ?? "local", ...(r ? { pane: r.pane } : {}), id, reason, ...(status ? { status } : {}) });
}

// GET /events?actions=1 을 붙잡고 bubble-action·bubble-closed 만 받는다. 끊기면 3초 뒤 다시
async function listenActions() {
  const base = (process.env.AGENT_BUBBLE_URL || "http://127.0.0.1:47891").replace(/\/+$/, "");
  for (;;) {
    try {
      const res = await fetch(`${base}/events?actions=1`);
      if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
      note("bridge: listening for bubble actions");
      let buf = "";
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if ((ev !== "bubble-action" && ev !== "bubble-closed") || !data) continue;
          let p;
          try { p = JSON.parse(data); } catch { continue; }
          if (ev === "bubble-closed") onClosed(p);
          else onAction(p).catch((e) => note(`action error ${e.message}`));
        }
      }
    } catch { /* 앱이 꺼져 있다 — 다시 */ }
    await sleep(3000);
  }
}

// ---- 3) 답 안 한 세션 다시 알림 ----
const BASE = () => (process.env.AGENT_BUBBLE_URL || "http://127.0.0.1:47891").replace(/\/+$/, "");
const REMIND_TICK_MS = 30e3;
const EVENTS_KEEP_MS = 3 * 24 * 3600e3; // 다리를 켤 때 이보다 오래된 기록은 안 본다
const local = { agents: new Map(), okAt: 0 }; // 이 컴퓨터 agent list(다시 알림 때 묻는다)
const remindPref = prefCache(() => fetchRemindPref(BASE())); // AgentBot 설정 「다시 알림 간격」(30초 기억, 예전 데몬이면 null)
let REMIND = remindConfig(); // 지금 설정(틱마다 다시)

// 지금 아는 그 세션: { status, info } | undefined(모름 — 그 머신 목록이 없거나 오래됨). 목록은 있는데 pane 이 없으면 gone
function liveAgent(machine, pane) {
  const w = !machine || machine === "local" ? local : watch.get(machine);
  if (!w?.agents || Date.now() - w.okAt > 5 * 60e3) return undefined;
  const a = w.agents.get(pane);
  return a ? { status: String(a.agent_status ?? "").toLowerCase(), info: a } : { status: "gone" };
}

// events.jsonl 을 이어 읽는다 — 새로 붙은 줄만 돌려준다(넘기기로 작아지면 새 파일 처음부터). 처음 읽을 땐 사흘 안 것만
const log = { file: process.env.HERDR_PLUGIN_STATE_DIR ? join(process.env.HERDR_PLUGIN_STATE_DIR, "events.jsonl") : null, offset: 0, rest: "" };
function readNewEvents() {
  if (!log.file) return [];
  let size = 0;
  try { size = statSync(log.file).size; } catch { return []; }
  if (size < log.offset) Object.assign(log, { offset: 0, rest: "" });
  if (size <= log.offset) return [];
  const fd = openSync(log.file, "r");
  try {
    const buf = Buffer.alloc(size - log.offset);
    readSync(fd, buf, 0, buf.length, log.offset);
    log.offset = size;
    const text = log.rest + buf.toString("utf8");
    const cut = text.lastIndexOf("\n") + 1;
    log.rest = text.slice(cut);
    const old = Date.now() - EVENTS_KEEP_MS;
    return parseEvents(text.slice(0, cut)).filter((e) => Date.parse(e.ts) >= old);
  } finally {
    closeSync(fd);
  }
}

// 방해 금지 시간(AgentBot 설정 — GET /prefs/quiet). 예전 데몬·꺼져 있으면 아님
async function quietNow() {
  try {
    const r = await fetch(`${BASE()}/prefs/quiet`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? (await r.json())?.active === true : false;
  } catch { return false; }
}
// 지금 떠 있는 바깥 말풍선 id(GET /bubbles/history?live=1). 예전 데몬·꺼져 있으면 null — 그땐 기록(shown·closed)으로 어림한다
async function liveBubbleIds() {
  try {
    const r = await fetch(`${BASE()}/bubbles/history?live=1&limit=1000`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d?.records) ? new Set(d.records.map((x) => x.id)) : null;
  } catch { return null; }
}

const tracker = newTracker();
const shown = new Map(); // 떠 있는 묶음 줄: key → 세션
let summarySig = "";
let remindStarted = false;
// n = 줄에 적을 번째(새로 알릴 때 reminded + 1, 다시 보낼 때·조용히 남길 때 reminded)
const remindBody = (s, n = s.reminded + 1) => {
  const m = s.machine === "local" ? undefined : s.machine;
  const a = liveAgent(s.machine, s.pane)?.info ?? { pane_id: s.pane };
  const title = a.label || a.terminal_title_stripped || a.name || a.agent || s.pane;
  const blocked = s.phase === "blocked";
  return {
    id: remindItemId(s.machine, s.pane),
    text: `${m ? `[${m}] ` : ""}${blocked ? `⚠️ ${title} 아직 확인을 기다려요` : `✅ ${title} 끝난 뒤 답이 없어요`}`.slice(0, 500),
    meta: remindMeta(s, REMIND, n), // 둘째 줄 「12분째 기다려요 · …」 — 앱이 지난 시간을 계속 고친다
    kind: bubbleKind(s.phase),
    sticky: true,
    group: REMIND_GROUP,
    buttons: [...(blocked ? SESSION_BUTTONS : sessionButtons("done")), { key: "mute", label: "이 세션은 그만" }],
    ref: herdrRef({ pane: s.pane, ...(m ? { machine: m } : {}) }),
    source: paneSource(a, m),
  };
};
// 예전 데몬이 모르는 필드(meta·group)면 빼고 다시 — meta 는 보낼 때의 지난 시간 글(detail)로
const metaSeen = {}; // 데몬이 meta 를 아나(remind postWithFallback)
const sentDetail = new Map(); // 줄 id → 예전 데몬에 보낸 detail(지난 시간 글을 고칠 때 비교)
async function postGrouped(body) {
  let last = null, sent = null;
  const ok = await postWithFallback(async (b) => { sent = b; return (last = await busRaw("/bubbles", b)); }, body, Date.now(), metaSeen);
  if (!ok) note(`remind: post ${body.id} FAILED ${last?.status || ""} ${String(last?.error ?? "").slice(0, 200)}`);
  else if (typeof sent?.detail === "string") sentDetail.set(body.id, sent.detail);
  else sentDetail.delete(body.id);
  return ok;
}
const clearRemind = (id) => { sentDetail.delete(id.replace(/^ext:/, "")); return bus(`/bubbles/${encodeURIComponent(id.startsWith("ext:") ? id : `ext:${id}`)}/clear`); };
async function syncSummary() {
  const list = [...shown.values()];
  const kind = list.some((s) => s.phase === "blocked") ? "warn" : "info";
  const sig = list.length ? `${list.length}|${kind}|${REMIND.snoozeMs}` : "";
  if (sig === summarySig) return;
  summarySig = sig;
  if (!list.length) return void (await clearRemind(SUMMARY_ID));
  await postGrouped({ id: SUMMARY_ID, text: summaryText(list.length), kind, sticky: true, group: REMIND_GROUP, groupSummary: true, buttons: [{ key: "snooze", label: snoozeLabel(REMIND.snoozeMs) }], source: { label: "다시 알림", color: "gray" } });
}
async function hideAll() {
  for (const s of shown.values()) await clearRemind(remindItemId(s.machine, s.pane));
  shown.clear();
  await syncSummary();
}

// 아는 세션 전부를 지금 목록으로 맞춘다: 이 컴퓨터는 지금 묻고, 다른 컴퓨터는 poll 이 받아 둔 것(5분 안)
async function refreshLive(now) {
  const la = json(await run(["agent", "list"], 5000))?.result?.agents;
  if (Array.isArray(la)) {
    Object.assign(local, { agents: new Map(la.filter((a) => typeof a?.pane_id === "string").map((a) => [a.pane_id, a])), okAt: now });
    applyLive(tracker, "local", la, now);
  }
  for (const [m, w] of watch) if (w.agents && now - w.okAt <= 5 * 60e3) applyLive(tracker, m, [...w.agents.values()], now);
}

async function remindTick() {
  REMIND = remindConfig(process.env, await remindPref());
  applyEvents(tracker, readNewEvents());
  const now = Date.now();
  await refreshLive(now);
  const [quiet, liveIds] = await Promise.all([quietNow(), liveBubbleIds()]);
  const plan = digestPlan(tracker, now, REMIND, { quiet, liveIds });
  let resend = [];
  if (!remindStarted) { // 다리를 다시 켬: 아직 떠 있을 줄을 이어받고, 나머지 예전 줄은 걷는다
    remindStarted = true;
    const keep = stillShown(tracker, plan.alive);
    for (const k of tracker.everReminded) if (!keep.some((s) => s.key === k)) { const [m, pane] = k.split("|"); await clearRemind(remindItemId(m, pane)); }
    for (const s of keep) shown.set(s.key, s);
    resend = keep;
    summarySig = "?";
    note(`remind: every=${REMIND.everyMs / 60e3}m(${REMIND.from.every}) on=${REMIND.on}(${REMIND.from.on}) doneMax=${REMIND.doneMax}`);
  }
  const act = digestActions(plan, new Set(shown.keys()));
  if (act.hide) return void (shown.size && (await hideAll()));
  for (const k of act.clear) { const s = shown.get(k); shown.delete(k); await clearRemind(remindItemId(s.machine, s.pane)); }
  // 떠 있는 keep 줄은 손대지 않는다(같은 id·같은 글 — 다시 뜨지·폰에 가지 않음). 넣는 줄은 셈 없이 지금 글(n = reminded)
  if (act.alert.length) { summarySig = "?"; for (const s of act.add) s.expiredAt = null; } // 머리를 먼저(묶음으로 받게) — 알릴 때는 같은 글이어도 다시
  for (const s of [...act.alert, ...act.add]) shown.set(s.key, s);
  await syncSummary();
  const posted = new Set();
  for (const s of act.alert) {
    await postGrouped(remindBody(s));
    markShown(tracker, s, now); // 바로 센다 — 기록(같은 ts)을 다시 읽어도 한 번만
    logEvent("remind", { ts: new Date(now).toISOString(), action: "shown", machine: s.machine, pane: s.pane, status: s.phase });
    posted.add(s.key);
  }
  for (const s of [...act.add, ...resend]) if (shown.has(s.key) && !posted.has(s.key)) { await postGrouped(remindBody(s, Math.max(1, s.reminded))); posted.add(s.key); } // 이어받은 줄도 같은 id·같은 글로(기록은 안 함)
  // 예전 데몬(meta 모름): detail 의 「N분째」가 굳지 않게 바뀌었을 때만 다시(내용 교체 — 위치 그대로·다시 안 뜸). 누름 처리 중인 줄은 건너뛴다
  if (metaSeen.meta === false) {
    for (const s of shown.values()) {
      const body = remindBody(s, Math.max(1, s.reminded));
      if (posted.has(s.key) || lanes.has(`ext:${body.id}`) || sentDetail.get(body.id) === metaFallback(body.meta, Date.now())) continue;
      await postGrouped(body);
    }
  }
  if (act.alert.length) {
    logEvent("remind", { action: "digest", n: act.alert.length, ...(act.add.length ? { back: act.add.length } : {}) });
    note(`remind: ${act.alert.length} sessions (${act.alert.map((s) => `${s.key}:${s.phase}`).join(",")})${act.add.length ? ` back=${act.add.length}` : ""}`);
  } else if (act.add.length) note(`remind: back ${act.add.map((s) => s.key).join(",")}`);
  await syncSummary();
}

// [N분 뒤에](머리)·[이 세션은 그만](줄) — 처리했으면 true. [세션으로 가기]·[답하기]는 보통 길로
async function remindAction(id, key, ref) {
  if (id === `ext:${SUMMARY_ID}` && key === "snooze") {
    const until = Date.now() + REMIND.snoozeMs;
    logEvent("remind", { action: "snooze", until });
    tracker.snoozeUntil = Math.max(tracker.snoozeUntil, until);
    await hideAll();
    await result(id, true);
    return true;
  }
  const r = typeof ref === "string" ? parseHerdrRef(ref) : null;
  if (key === "mute" && r) {
    const k = sessionKey(r.machine, r.pane);
    logEvent("remind", { action: "mute", machine: r.machine ?? "local", pane: r.pane });
    const s = tracker.sessions.get(k);
    if (s) s.muted = true;
    shown.delete(k);
    await result(id, true);
    await clearRemind(id);
    await syncSummary();
    return true;
  }
  return false;
}

// 묶음 줄·머리가 닫힘: 사용자가 닫았으면(dismissed) 뺀다 — 알리는 중이면 다음 알림 때 다시, 끝남 N번 다 된 줄은 다시 안 넣는다. 머리를 닫으면(모두 닫기) 다 뺀다.
// 앱이 넘쳐 버린 것(expired)은 닫기가 아니다 — 다음 알림 때 다시. 우리가 걷은 것(cleared)은 그대로
async function remindClosed(id, reason, r) {
  if (reason === "cleared") return;
  if (id === `ext:${SUMMARY_ID}`) {
    if (reason !== "dismissed") return void (summarySig = ""); // 머리만 버려짐 — 다음에 다시 보낸다
    const t = Date.now();
    for (const s of shown.values()) { s.hiddenAt = t; logEvent("remind", { action: "dismissed", machine: s.machine, pane: s.pane }); }
    summarySig = "";
    await hideAll();
    return;
  }
  if (!r) return;
  const k = sessionKey(r.machine, r.pane);
  const s = shown.get(k);
  if (!s) return;
  shown.delete(k);
  sentDetail.delete(id.replace(/^ext:/, ""));
  if (reason === "dismissed") {
    s.hiddenAt = Date.now(); // 기록을 끈 때도 — 조용히 남기던 줄(끝남 N번 뒤)은 이걸로 안 돌아온다
    logEvent("remind", { action: "dismissed", machine: r.machine ?? "local", pane: r.pane });
  } else s.expiredAt = Date.now();
  await syncSummary();
}

// 늘 돈다 — 꺼짐(.env·AgentBot 설정)은 틱마다 다시 본다(설정 창에서 켜면 다음 틱부터)
async function watchReminders() {
  for (;;) {
    await remindTick().catch((e) => note(`remind error ${e.message}`));
    await sleep(REMIND_TICK_MS);
  }
}

// ---- 2) 다른 컴퓨터 감시 ----
async function watchMachines() {
  let list = [], listAt = 0, sideAt = 0;
  for (;;) {
    if (Date.now() - sideAt > SIDEBAR_MS) { sideAt = Date.now(); refreshSidebar().catch(() => {}); } // 기다리지 않는다
    if (Date.now() - listAt > LIST_MS) {
      const got = await machines();
      if (got.join() !== list.join()) note(`bridge: machines=${got.join(",") || "-"}`);
      list = got;
      listAt = Date.now();
    }
    for (const m of list) poll(m);
    await sleep(POLL_MS);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  note(`bridge start poll=${POLL_MS}ms`);
  listenActions();
  watchMachines();
  watchReminders();
}
