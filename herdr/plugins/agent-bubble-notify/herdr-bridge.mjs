// herdr ↔ AgentBot 다리 — 늘 떠 있는 프로세스(launchd — herdr-bridge-install.sh). 설정은 플러그인 .env
// 1) 말풍선 버튼: AgentBot 은 herdr 를 모른다. 말풍선을 누르면 데몬이 SSE bubble-action { id, key, ref } 를 내보내고(GET /events?actions=1),
//    여기서 ref(lib.mjs herdrRef)를 읽어 그 세션으로 간다 — 이 컴퓨터든 다른 컴퓨터(herdr 저장 머신)든.
// 2) 다른 컴퓨터 세션 알림: herdr 플러그인은 그 머신 서버에서만 돌고 이벤트도 넘어오지 않으므로,
//    몇 초마다 `herdr --machine <이름> agent list` 로 상태를 물어 바뀐 것을 notify.mjs 와 같은 규칙으로 알린다(AGENT_BUBBLE_MACHINE_*)
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadDotEnv, modeEnabled, envFlag, envInt, bus, note, speak, sessionButtons, herdrRef, parseHerdrRef, paneSource, bubbleKind, bubbleLife } from "./lib.mjs";

loadDotEnv();
const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const POLL_MS = Math.max(envInt("AGENT_BUBBLE_MACHINE_POLL_MS", 5000), 2000);
const REBASE_MS = 5 * 60e3; // 이만큼 못 물었으면 다시 붙을 때 그사이 끝난 것들을 한꺼번에 띄우지 않고 지금 상태만 받아 둔다
const LIST_MS = 60e3;

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

// 말풍선 id 에 넣을 머신 이름: 영숫자·_.- 밖의 글자는 _<코드> 로(서로 다른 이름이 같은 id 가 되지 않게)
const slug = (m) => m.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.codePointAt(0).toString(16)}`);
export const machineBubbleId = (m, pane) => `herdr:${slug(m)}:${pane}`;

// 직전(prev: pane → {status, seq, focused})과 지금 목록 → 알릴 것·걷을 것. 순수 함수
// done: 끝남(done 으로 바뀜, done 인데 그사이 다시 돌았음 = seq 바뀜, 보이는 pane 이라 working → idle)
// blocked: 입력 대기로 바뀜. 걷기: 다시 돎·대기였다가 idle·사용자가 그 pane 으로 감(focused)·pane 사라짐
export function machineChanges(prev, agents) {
  const notify = [], clear = [], next = new Map();
  for (const a of agents) {
    const pane = a?.pane_id;
    if (typeof pane !== "string") continue;
    const now = { status: String(a.agent_status ?? "").toLowerCase(), seq: a.state_change_seq, focused: !!a.focused };
    next.set(pane, now);
    const p = prev.get(pane);
    if (!p) continue; // 처음 본 pane 은 받아만 둔다
    const moved = p.seq !== now.seq;
    if (now.status === "done" && (p.status !== "done" || moved)) notify.push({ agent: a, state: "done" });
    else if (now.status === "idle" && p.status === "working") notify.push({ agent: a, state: "done" });
    else if (now.status === "blocked" && (p.status !== "blocked" || moved)) notify.push({ agent: a, state: "blocked" });
    else if ((now.status === "working" && p.status !== "working") || (now.status === "idle" && p.status === "blocked") || (now.focused && !p.focused)) clear.push(pane);
  }
  for (const pane of prev.keys()) if (!next.has(pane)) clear.push(pane);
  return { notify, clear, next };
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
    const { notify: todo, clear, next } = machineChanges(stale ? new Map() : w.prev, agents);
    if (stale) {
      note(`[${m}] baseline ${next.size} panes`);
      if (w.prev) for (const pane of w.prev.keys()) if (!next.has(pane)) clear.push(pane); // 끊긴 사이 닫힌 pane 의 말풍선
    }
    w.prev = next;
    w.okAt = Date.now();
    w.backoff = 0;
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

// herdr 화면을 그 머신(이 컴퓨터는 '')의 그 워크스페이스로. 이미 거기면 그대로. 못 하면 false
async function showOnScreen(machine, workspace) {
  const machines = (json(await run(["machine", "list", "--json"], 5000)) ?? []).filter((m) => m?.enabled !== false);
  const on = machines.find((m) => m.selected)?.label ?? "";
  if (on === machine && !machine) return true; // 이 컴퓨터를 보고 있다 — agent focus 가 이미 옮겼다
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
  // 사이드바 차례: 이 컴퓨터 워크스페이스 → 켜 둔 저장 머신 차례로(닿지 않는 머신은 사이드바 이동에서도 빠진다)
  // 저장 머신은 ssh 너머라 느리다(회사→집 8–10초) — agent focus 처럼 15초까지 기다린다
  const lists = await Promise.all([
    run(["workspace", "list"], 5000).then((o) => ({ machine: "", ws: json(o)?.result?.workspaces })),
    ...machines.map((m) => run(["--machine", m.label, "workspace", "list"], 15000).then((o) => ({ machine: m.label, ws: json(o)?.result?.workspaces }))),
  ]);
  const order = lists.filter((l) => Array.isArray(l.ws)).flatMap((l) => l.ws.map((w) => ({ machine: l.machine, workspace: w.workspace_id, focused: !!w.focused })));
  const from = order.find((o) => o.machine === on && o.focused);
  const steps = from ? navSteps(order, from, { machine, workspace }) : null;
  if (steps === null) return false;
  if (steps === 0) return true;
  for (const key of navKeys(prefix, steps)) {
    await runRaw(wz, ["cli", "send-text", "--no-paste", "--pane-id", String(pane), key], wzOpts);
    await sleep(60);
  }
  return true;
}

// 그 세션으로: herdr 서버에서 pane 포커스(워크스페이스·탭도) → 화면을 그 머신으로 → 터미널 앱을 앞으로. 못 가면 이유
async function go(r) {
  const f = await runRaw(HERDR, [...targetArgs(r), "agent", "focus", r.pane], { timeout: 15000 });
  if (f.err) return focusError(f.out);
  const app = pickTerminal((await runRaw("ps", ["-axo", "comm"])).stdout, process.env.AGENT_BUBBLE_TERMINAL);
  if (app) await runRaw("open", ["-a", app]); // 못 띄워도 pane 은 옮겼다
  if (r.session) return null; // 이름 붙은 세션은 따로 붙은 화면 — 사이드바 이동은 안 한다
  if (!(await showOnScreen(r.machine ?? "", r.pane.split(":")[0]))) return `세션은 골라 뒀어요. herdr 사이드바에서 ${r.machine ?? "Local"} 로 가 주세요.`;
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
const inflight = new Set(); // 처리 중인 말풍선 id — 겹쳐 누르면 사이드바 키가 두 번 들어간다

async function onAction({ id, key, ref, text }) {
  if (!ours(id) || inflight.has(id)) return;
  const plan = actionPlan({ key, ref, text });
  const r = plan?.r;
  inflight.add(id);
  try {
    const err = !plan ? "이 알림은 어디로 가야 할지 몰라요." : plan.kind === "reply" ? await prompt(r, plan.text) : await go(r);
    // 보낸 말은 기록에 남기지 않는다(길이만)
    note(`action ${id} ${key} → ${r ? `${r.machine ? `${r.machine}/` : ""}${r.pane}` : "?"}${plan?.kind === "reply" ? ` text=${plan.text.length}자` : ""} ${err ?? "ok"}`);
    // 갔으면(보냈으면) 걷는다 — 그사이 같은 id 로 새 알림이 왔으면(ref 가 다르면) 그건 둔다
    if (!err) return void (await bus(`/bubbles/${encodeURIComponent(id)}/clear`, { ifRef: ref }));
    // 못 갔으면 같은 말풍선을 이유로 바꾼다(버튼 없이, 잠깐)
    await bus("/bubbles", { id, text: err, kind: "error", ttlMs: 8000 });
  } finally {
    inflight.delete(id);
  }
}

// GET /events?actions=1 을 붙잡고 bubble-action 만 받는다. 끊기면 3초 뒤 다시
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
          if (ev !== "bubble-action" || !data) continue;
          let p;
          try { p = JSON.parse(data); } catch { continue; }
          onAction(p).catch((e) => note(`action error ${e.message}`));
        }
      }
    } catch { /* 앱이 꺼져 있다 — 다시 */ }
    await sleep(3000);
  }
}

// ---- 2) 다른 컴퓨터 감시 ----
async function watchMachines() {
  let list = [], listAt = 0;
  for (;;) {
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
}
