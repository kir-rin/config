// 공용: .env 읽기 · 켜짐 상태 · herdr 호출 · AgentBot 버스 호출. agent-telegram-notify(herdr-plugin-examples) 구조를 따른다
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
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

// AgentBot 버스. 앱이 꺼져 있으면 조용히 넘어간다(소리는 이미 났다)
export async function bus(path, body) {
  const base = (process.env.AGENT_BUBBLE_URL || "http://127.0.0.1:47891").replace(/\/+$/, "");
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "X-CY-Agent": "1", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error(`agent-bot ${path}: ${res.status} ${await res.text().catch(() => "")}`);
    return res.ok;
  } catch (e) {
    console.error(`agent-bot ${path}: ${e.message}`);
    return false;
  }
}

export const bubbleId = (pane) => `herdr:${pane}`;

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

function clip(s, n) {
  const t = s.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}
