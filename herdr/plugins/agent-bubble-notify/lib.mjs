// 공용: .env 읽기 · 켜짐 상태 · herdr 호출 · AgentBot 버스 호출. agent-telegram-notify(herdr-plugin-examples) 구조를 따른다
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = dirname(fileURLToPath(import.meta.url));

// HERDR_PLUGIN_CONFIG_DIR/.env → 플러그인 폴더/.env 순. 이미 있는 환경 변수는 안 덮는다
export function loadDotEnv() {
  const paths = [];
  if (process.env.HERDR_PLUGIN_CONFIG_DIR) paths.push(join(process.env.HERDR_PLUGIN_CONFIG_DIR, ".env"));
  paths.push(join(pluginRoot, ".env"));
  for (const p of new Set(paths)) {
    let text;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

export function envFlag(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

export const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function modePath() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR
    || join(process.env.XDG_STATE_HOME || join(process.env.HOME ?? pluginRoot, ".local", "state"), "agent-bubble-notify");
  return join(dir, "enabled");
}

export function modeEnabled() {
  const p = modePath();
  if (!existsSync(p)) return envFlag("AGENT_BUBBLE_ENABLED", true);
  return !["0", "false", "no", "off", "disabled"].includes(readFileSync(p, "utf8").trim().toLowerCase());
}

export function setMode(on) {
  const p = modePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, on ? "on\n" : "off\n");
}

export function readJsonEnv(name) {
  try { return JSON.parse(process.env[name] || "{}"); } catch { return {}; }
}

// herdr CLI(HERDR_BIN_PATH = 지금 도는 herdr) → result | null
export function herdr(args) {
  const r = spawnSync(process.env.HERDR_BIN_PATH || "herdr", args, { encoding: "utf8", timeout: 5000 });
  try { return JSON.parse(r.stdout)?.result ?? null; } catch { return null; }
}

export const paneInfo = (pane) => herdr(["pane", "get", pane])?.pane ?? null;

// herdr 세션 이름: 기본 세션이 아니면 소켓 경로 …/sessions/<이름>/herdr.sock 에서
export function sessionName() {
  const m = String(process.env.HERDR_SOCKET_PATH ?? "").match(/\/sessions\/([^/]+)\/herdr\.sock$/);
  return m ? m[1] : undefined;
}

// AgentBot 버스 → 응답 JSON(성공) | null. 앱이 꺼져 있으면 조용히 넘어간다
// timeoutMs: 캐릭터 한 줄을 기다리는 POST /bubbles(summarize)는 길게(데몬이 최대 20초 기다린다)
export async function bus(path, body, timeoutMs = 3000) {
  const base = (process.env.AGENT_BUBBLE_URL || "http://127.0.0.1:47891").replace(/\/+$/, "");
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "X-CY-Agent": "1", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`agent-bot ${path}: ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    console.error(`agent-bot ${path}: ${e.message}`);
    return null;
  }
}

export const bubbleId = (pane) => `herdr:${pane}`;

// 말풍선 버튼과 ref: AgentBot 은 herdr 를 모른다 — 본문·[세션으로 가기]를 누르면 데몬이 bubble-action { id, key, ref } 를 SSE 로 내보내고,
// herdr-bridge.mjs 가 ref 를 읽어 그 세션으로 간다. ref = JSON { h: 1, pane, session?, machine?, t } (200자 안쪽)
// t: 보낸 때 — 같은 id 로 새 알림이 오면 ref 가 달라져, 늦게 끝난 처리가 새 알림을 걷지 않는다(clear ifRef)
export const SESSION_BUTTONS = [{ key: "default", label: "세션으로 가기" }];
// 끝난(done) 세션엔 [답하기]도 — 말풍선 입력줄에 쓴 말을 bubble-action text 로 받아 herdr agent prompt 로 그 세션에 보낸다(가지 않고).
// 입력 대기(blocked)는 대개 도구 승인 메뉴라 글자가 엉뚱한 선택지를 고를 수 있어 [세션으로 가기]만. AGENT_BUBBLE_REPLY=off 로 끈다
// 말풍선 종류: 입력 대기(blocked)는 warn(확인 필요 — AgentBot 묶음에서 먼저), 끝남은 done
export const bubbleKind = (status) => (status === "blocked" ? "warn" : "done");

// 유지 시간: AGENT_BUBBLE_TTL_DONE·_BLOCKED(초, 1–86400)를 주면 그대로. 0(기본)이면 누를 때까지(sticky) —
// 다만 끝난 알림은 AGENT_BUBBLE_DONE_MAX_AGE_MIN(분, 기본 120, 0 = 끔, 최대 1440) 뒤 저절로 치운다. 입력 대기는 안 치운다
export function bubbleLife(status, env = process.env) {
  const num = (name, d) => { const n = Number(env[name]); return env[name]?.trim() && Number.isFinite(n) && n >= 0 ? n : d; };
  const blocked = status === "blocked";
  const ttl = num(blocked ? "AGENT_BUBBLE_TTL_BLOCKED" : "AGENT_BUBBLE_TTL_DONE", 0);
  if (ttl > 0) return { ttlMs: Math.round(Math.min(Math.max(ttl, 1), 86400) * 1000) };
  const age = blocked ? 0 : num("AGENT_BUBBLE_DONE_MAX_AGE_MIN", 120);
  return age > 0 ? { ttlMs: Math.round(Math.min(age, 1440) * 60e3) } : { sticky: true };
}

export const REPLY_BUTTON = { key: "reply", label: "답하기", input: { placeholder: "세션에 보낼 말" } };
export const sessionButtons = (status) => (status === "done" && envFlag("AGENT_BUBBLE_REPLY", true) ? [...SESSION_BUTTONS, REPLY_BUTTON] : SESSION_BUTTONS);
export const herdrRef = ({ pane, session, machine }) => JSON.stringify({ h: 1, pane, ...(machine ? { machine } : session ? { session } : {}), t: Date.now() });
export function parseHerdrRef(ref) {
  let r;
  try { r = JSON.parse(ref); } catch { return null; }
  const ok = (v, re) => v === undefined || (typeof v === "string" && re.test(v)); // 명령 인자로 넘기므로 '-' 시작 금지
  if (r?.h !== 1 || typeof r.pane !== "string" || !/^[A-Za-z0-9][\w:.-]{0,63}$/.test(r.pane)) return null;
  if (!ok(r.session, /^[A-Za-z0-9][\w.-]{0,63}$/) || !ok(r.machine, /^[A-Za-z0-9][\w .-]{0,63}$/)) return null;
  return { pane: r.pane, ...(r.machine ? { machine: r.machine } : r.session ? { session: r.session } : {}) };
}

// ---- 머리줄(source): 「● [컴퓨터 칩] 프로젝트 · agent」 — 오래 올리면 경로·탭 제목·pane ----
// 같은 컴퓨터는 어느 맥의 캐릭터에서 보든 같은 이름·색이어야 한다 → AGENT_BUBBLE_MACHINE_NAMES 로 맞춘다(양쪽 .env 에 같은 줄)
export const SOURCE_COLORS = ["blue", "purple", "green", "orange", "pink", "gray"];
const HASH_COLORS = ["purple", "green", "orange", "pink"]; // 이 컴퓨터 기본(blue)과 안 겹치게

// "home:집:blue,company:회사:purple,local:집:blue" → Map(소문자 key → { name?, color? }). key = 저장 머신 label·local(이 컴퓨터)·짧은 호스트 이름
export function parseMachineNames(s) {
  const m = new Map();
  for (const part of String(s ?? "").split(",")) {
    const [key, name, color] = part.split(":").map((x) => x.trim());
    if (!key) continue;
    m.set(key.toLowerCase(), { ...(name ? { name: name.slice(0, 40) } : {}), ...(SOURCE_COLORS.includes(color) ? { color } : {}) });
  }
  return m;
}

// 이름 → 늘 같은 색(매핑이 없을 때 저장 머신)
export function hashColor(label) {
  let h = 0;
  for (const c of String(label)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return HASH_COLORS[h % HASH_COLORS.length];
}

// 칩: machine 이 없으면 이 컴퓨터 — 이름은 AGENT_BUBBLE_SOURCE_LABEL → 매핑(local·호스트 이름) → 짧은 호스트 이름, 색은 매핑 → blue.
// 저장 머신은 매핑(label) → label 그대로, 색은 매핑 → hashColor
export function machineSource(machine, { names = parseMachineNames(process.env.AGENT_BUBBLE_MACHINE_NAMES), host = hostname().split(".")[0], own = process.env.AGENT_BUBBLE_SOURCE_LABEL?.trim() } = {}) {
  if (machine) {
    const m = names.get(machine.toLowerCase()) ?? {};
    return { label: (m.name ?? machine).slice(0, 40), color: m.color ?? hashColor(machine) };
  }
  const m = names.get("local") ?? names.get(String(host).toLowerCase()) ?? {};
  return { label: (own || m.name || host || "local").slice(0, 40), color: m.color ?? "blue" };
}

// pane 정보(herdr pane get·agent list 한 줄) → source. 제목: 붙인 이름(label·name) → 작업 폴더 이름 → 탭 제목 → pane, 그리고 · agent.
// 탭 제목(Claude Code 는 대화 요약)은 길어서 detail 로
export function paneSource(info, machine, opts) {
  const cwd = String(info?.foreground_cwd || info?.cwd || "").replace(/\/+$/, "");
  const name = info?.label || info?.name || (cwd ? basename(cwd) : "") || info?.terminal_title_stripped || info?.pane_id || "";
  const agent = info?.agent && info.agent !== name ? info.agent : "";
  const title = [name, agent].filter(Boolean).join(" · ").slice(0, 80);
  const detail = [cwd, info?.terminal_title_stripped, info?.pane_id ? `${machine ? `${machine} ` : ""}${info.pane_id}` : ""].filter(Boolean).join("\n").slice(0, 500);
  return { ...machineSource(machine, opts), ...(title ? { title } : {}), ...(detail ? { detail } : {}) };
}

// ---- 요약: 그 pane 의 Claude Code 세션 기록(JSONL)에서 ----
// 끝남 → 마지막 답(글), 입력 대기 → 승인 기다리는 도구(이름 + 명령·파일) 또는 마지막 질문. 모델은 안 부른다

// ~/.claude/projects/*/<sid>.jsonl — CLAUDE_CONFIG_DIR·~/.claude*(claude-krafton 등)·AGENT_BUBBLE_CLAUDE_DIRS(: 로 여럿)
export function findTranscript(sid) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sid ?? ""))) return null;
  const home = process.env.HOME ?? "";
  const roots = new Set([
    ...String(process.env.AGENT_BUBBLE_CLAUDE_DIRS ?? "").split(":").filter(Boolean),
    ...(process.env.CLAUDE_CONFIG_DIR ? [process.env.CLAUDE_CONFIG_DIR] : []),
  ]);
  try { for (const n of readdirSync(home)) if (n.startsWith(".claude")) roots.add(join(home, n)); } catch { /* 홈을 못 읽으면 위에 것만 */ }
  for (const root of roots) {
    let projects;
    try { projects = readdirSync(join(root, "projects")); } catch { continue; }
    for (const p of projects) {
      const f = join(root, "projects", p, `${sid}.jsonl`);
      try { if (statSync(f).isFile()) return f; } catch { /* 다음 */ }
    }
  }
  return null;
}

// 파일 끝 maxBytes 만 줄로
function tailLines(file, maxBytes = 512 * 1024) {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (size > len) lines.shift(); // 잘린 첫 줄
    return lines;
  } finally {
    closeSync(fd);
  }
}

const TOOL_ARG = ["command", "file_path", "path", "url", "pattern", "description", "prompt"];
function toolLine(t) {
  const input = t.input ?? {};
  const arg = TOOL_ARG.map((k) => input[k]).find((v) => typeof v === "string" && v.trim());
  return `${t.name}${arg ? `: ${arg.trim().split("\n")[0]}` : ""}`;
}

// status done → 마지막 답 글, blocked → 마지막 assistant 가 도구 호출이면 「승인 대기 — 도구: 인자」, 아니면 그 글
export function sessionSummary(file, status, maxChars = 280) {
  let last = null;
  for (const line of tailLines(file).reverse()) {
    if (!line.includes('"assistant"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== "assistant" || j.isSidechain) continue;
    const content = Array.isArray(j.message?.content) ? j.message.content : [];
    const text = content.filter((c) => c.type === "text" && c.text?.trim()).map((c) => c.text.trim()).join("\n\n");
    const tool = content.find((c) => c.type === "tool_use");
    if (status === "blocked" && !last && tool) return clip(`승인 대기 — ${toolLine(tool)}`, maxChars);
    if (text) { last = text; break; }
  }
  return last ? clip(last, maxChars) : null;
}

// 캐릭터 한 줄의 재료: 마지막 사람 요청 + 마지막 답 글(끝남) / 기다리는 도구 또는 그 질문(입력 대기). 없으면 null
// 하네스가 넣은 글(<태그>…)·도구 결과·곁가지(sidechain)는 뺀다
export function sessionMaterial(file, status) {
  let answer = null, ask = null, waiting = null;
  for (const line of tailLines(file).reverse()) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain || j.isMeta) continue;
    const content = j.message?.content;
    if (j.type === "assistant" && Array.isArray(content) && answer === null) {
      const text = content.filter((c) => c.type === "text" && c.text?.trim()).map((c) => c.text.trim()).join("\n\n");
      const tool = content.find((c) => c.type === "tool_use");
      if (status === "blocked" && !waiting && !text && tool) waiting = toolLine(tool);
      if (text) answer = text;
    } else if (j.type === "user" && answer !== null) {
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") : "";
      const t = text.trim();
      if (t && !t.startsWith("<") && !t.startsWith("Caveat:")) { ask = t; break; }
    }
  }
  const parts = [
    ask ? `[사용자 요청]\n${clip(ask, 500)}` : "",
    waiting ? `[승인 기다리는 도구]\n${waiting}` : "",
    answer ? `[에이전트 마지막 답]\n${clip(answer, 2500)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

function clip(s, n) {
  const t = s.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

// 판단 기록(왜 띄웠나·건너뛰었나): HERDR_PLUGIN_STATE_DIR/notify.log, 200KB 넘으면 비우고 새로
export function note(msg) {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) return;
  const f = join(dir, "notify.log");
  try {
    if (existsSync(f) && statSync(f).size > 200 * 1024) writeFileSync(f, "");
    appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* 기록 못 해도 알림은 그대로 */ }
}

// pane 마다 직전 상태(working → idle 을 「끝남」으로 보려고): HERDR_PLUGIN_STATE_DIR/panes/<pane>.
// herdr 가 훅을 동시에 띄우므로 한 파일(JSON)을 읽고-고쳐-쓰면 다른 pane 기록을 덮어 잃는다 → pane 마다 파일, 임시 파일 + rename 으로 통째 교체.
// 7일 넘게 안 바뀐 pane 파일은 버린다
export function swapPaneStatus(pane, status) {
  const root = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!root) return undefined;
  const dir = join(root, "panes");
  const f = join(dir, encodeURIComponent(pane));
  let prev;
  try { prev = readFileSync(f, "utf8").trim() || undefined; } catch { /* 처음 */ }
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, status);
    renameSync(tmp, f);
  } catch { /* 못 써도 이번 알림은 그대로 */ }
  try {
    const old = Date.now() - 7 * 24 * 3600 * 1000;
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      try { if (statSync(p).mtimeMs < old) unlinkSync(p); } catch { /* 다른 훅이 먼저 지웠다 */ }
    }
  } catch { /* 정리는 못 해도 그만 */ }
  return prev;
}

// 소리: 효과음(AGENT_BUBBLE_SOUND_*) → 목소리(AGENT_BUBBLE_VOICE=animalese 면 말풍선 글을 동물의 숲 말투로). 기다리지 않는다
// 효과음을 비워 두면 목소리가 켜져 있을 땐 안 틀고, 꺼져 있을 땐 macOS 기본 소리
export function speak(st, line) {
  const voice = (process.env.AGENT_BUBBLE_VOICE?.trim() || "animalese").toLowerCase() === "animalese";
  const set = process.env[st === "blocked" ? "AGENT_BUBBLE_SOUND_BLOCKED" : "AGENT_BUBBLE_SOUND_DONE"]?.trim();
  const chime = set ? (set.toLowerCase() === "off" ? null : set) : voice ? null : st === "blocked" ? "/System/Library/Sounds/Funk.aiff" : "/System/Library/Sounds/Glass.aiff";
  // sh -c 'afplay "$1"; …/animalese-speak.sh "$2"' — 글은 인자로만 넘긴다(셸이 풀지 않게)
  const steps = [chime ? 'afplay "$1"' : "", voice ? `"${pluginRoot}/animalese-speak.sh" ${envFlag("AGENT_BUBBLE_VOICE_HIGH", false) ? "--high " : ""}"$2"` : ""].filter(Boolean);
  if (!steps.length) return;
  spawn("/bin/sh", ["-c", steps.join("; "), "sh", chime ?? "", line], { detached: true, stdio: "ignore" }).unref();
}
