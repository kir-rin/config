// 답 안 한 세션 다시 알림 — 순수 함수(herdr-bridge.mjs 가 events.jsonl·지금 목록·데몬 설정을 넘긴다). 파일·네트워크는 fetchRemindPref 만(주입)
// 「답 안 한 세션」: 아는 세션 전부(이 컴퓨터 herdr agent list + 다른 컴퓨터 poll) 중 입력 대기(blocked)거나 끝남(done — 끝난 뒤 봐서 idle 이 된 것도)인 채로
// 간격 이상 지났고, 그 뒤로 다시 돌지(working) 않았고 답(reply)도 안 보낸 것. 끝난 걸 보기만(idle) 한 건 답이 아니다.
// 간격마다 다시(끝남은 최대 N번, 입력 대기는 풀릴 때까지). 미룸·그만·방해 금지 시간이면 쉰다. 그 세션 말풍선이 아직 떠 있으면 묶음에 안 넣는다(떠 있는 게 이미 알림)
import { bubbleId, machineBubbleId } from "./lib.mjs";

const MIN = 60e3;
const DAY = 24 * 3600e3;
export const DEFAULT_EVERY_MIN = 3;
export const DEFAULT_DONE_MAX = 3;
// _remind: 머신 이름 slug(lib machineBubbleId)는 _ 뒤에 16진수만 오므로 어떤 머신 이름과도 안 겹친다
export const REMIND_PREFIX = "ext:herdr:_remind";
export const SUMMARY_ID = "herdr:_remind"; // 묶음 머리(POST /bubbles id — 데몬이 ext: 를 붙인다)
export const REMIND_GROUP = "herdr-remind";
export const isRemindId = (id) => typeof id === "string" && (id === REMIND_PREFIX || id.startsWith(`${REMIND_PREFIX}:`));
// 세션 하나의 다시 알림 말풍선 id(머신 이름은 lib 과 같은 규칙으로)
export const remindItemId = (machine, pane) => machineBubbleId(machine || "local", pane).replace(/^herdr:/, "herdr:_remind:");
export const sessionKey = (machine, pane) => `${!machine || machine === "local" ? "local" : machine}|${pane}`;
// 그 세션의 처음 말풍선 id(notify.mjs·다리 notify 와 같은 규칙)
export const ownBubbleId = (machine, pane) => `ext:${!machine || machine === "local" ? bubbleId(pane) : machineBubbleId(machine, pane)}`;

// ---- 설정: .env 가 정했으면 그것 > AgentBot 설정(GET /prefs/remind) > 기본 ----
// AGENT_BUBBLE_REMIND(on|off) · _EVERY_MIN(간격, 기본 3) · _DONE_MAX(끝남 최대 번, 기본 3, 0 = 끝남은 안 알림) · _SNOOZE_MIN(60)
// 고급: _BLOCKED_FIRST_MIN·_BLOCKED_EVERY_MIN 을 주면 입력 대기만 그 값(0 = 처음 한 번만 / 안 알림). _DONE_MIN(예전 「30,120」)은 안 쓴다 — 빈 값이면 끝남 끔으로만 읽는다
const OFF = ["0", "false", "no", "off"];
const ON = ["1", "true", "yes", "on"];
export function remindConfig(env = process.env, pref = null) {
  const num = (name) => { const v = env[name]?.trim(); const n = Number(v); return v && Number.isFinite(n) && n >= 0 ? n : undefined; };
  const flag = String(env.AGENT_BUBBLE_REMIND ?? "").trim().toLowerCase();
  const p = pref && typeof pref === "object" ? pref : null;
  const appEvery = Number.isInteger(p?.everyMin) && p.everyMin >= 1 && p.everyMin <= 120 ? p.everyMin : undefined;
  const envEvery = num("AGENT_BUBBLE_REMIND_EVERY_MIN");
  const everyMin = envEvery > 0 ? envEvery : appEvery ?? DEFAULT_EVERY_MIN;
  const on = OFF.includes(flag) ? false : ON.includes(flag) ? true : typeof p?.enabled === "boolean" ? p.enabled : true;
  const everyMs = everyMin * MIN;
  const legacyDoneOff = env.AGENT_BUBBLE_REMIND_DONE_MIN !== undefined && !String(env.AGENT_BUBBLE_REMIND_DONE_MIN).trim();
  const doneMax = num("AGENT_BUBBLE_REMIND_DONE_MAX") ?? (legacyDoneOff ? 0 : DEFAULT_DONE_MAX);
  const bf = num("AGENT_BUBBLE_REMIND_BLOCKED_FIRST_MIN"), be = num("AGENT_BUBBLE_REMIND_BLOCKED_EVERY_MIN");
  return {
    on,
    everyMs,
    blockedFirstMs: bf !== undefined ? bf * MIN : everyMs,
    blockedEveryMs: be !== undefined ? be * MIN : everyMs,
    doneMax: Math.floor(doneMax),
    snoozeMs: Math.max(1, num("AGENT_BUBBLE_REMIND_SNOOZE_MIN") ?? 60) * MIN,
    from: { on: OFF.includes(flag) || ON.includes(flag) ? "env" : typeof p?.enabled === "boolean" ? "app" : "default", every: envEvery > 0 ? "env" : appEvery ? "app" : "default" },
  };
}

// AgentBot 설정 읽기(GET /prefs/remind → { enabled, everyMin }). 예전 데몬(404)·꺼짐·이상한 답이면 null
export async function fetchRemindPref(base, fetchImpl = fetch, timeoutMs = 3000) {
  try {
    const r = await fetchImpl(`${String(base).replace(/\/+$/, "")}/prefs/remind`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const d = await r.json();
    return d && typeof d === "object" && (typeof d.enabled === "boolean" || Number.isInteger(d.everyMin)) ? { ...(typeof d.enabled === "boolean" ? { enabled: d.enabled } : {}), ...(Number.isInteger(d.everyMin) ? { everyMin: d.everyMin } : {}) } : null;
  } catch { return null; }
}
// 짧게 기억(ttlMs, 기본 30초) — 실패(null)도 기억해 꺼진 데몬을 매번 두드리지 않는다
export function prefCache(load, ttlMs = 30e3, now = Date.now) {
  let at = -Infinity, val = null, busy = null;
  return async () => {
    if (now() - at < ttlMs) return val;
    busy ??= Promise.resolve(load()).then((v) => { val = v ?? null; at = now(); return val; }, () => { at = now(); return (val = null); }).finally(() => { busy = null; });
    return busy;
  };
}

// ---- 세션 따라가기: 이벤트(events.jsonl)·지금 목록(agent list) → 세션마다 단계(phase) ----
// phase: null | "blocked" | "done". since = 그 단계에 들어온 때(끝난 뒤 보기만 한 idle 은 그대로), at = 마지막으로 바뀐 때(그보다 옛 기록은 무시)
export function newTracker() {
  return { sessions: new Map(), snoozeUntil: 0, everReminded: new Set() };
}
function sess(tr, machine, pane) {
  const key = sessionKey(machine, pane);
  let s = tr.sessions.get(key);
  if (!s) {
    s = { key, machine: !machine || machine === "local" ? "local" : machine, pane, raw: undefined, phase: null, since: null, at: -Infinity, reminded: 0, lastRemindAt: null, muted: false, hiddenAt: null, ownShownAt: null, ownClosedAt: null, ownTtlMs: null };
    tr.sessions.set(key, s);
  }
  return s;
}
const enter = (s, phase, t) => Object.assign(s, { phase, since: t, at: t, reminded: 0, lastRemindAt: null, muted: false, hiddenAt: null });
const leave = (s, t) => Object.assign(s, { phase: null, since: null, at: t, reminded: 0, lastRemindAt: null, muted: false, hiddenAt: null });

// 상태 하나 → 단계. done·blocked 로 들어오면 시작(같은 단계면 그대로, missed = 그사이 한 바퀴 돌아 같은 상태면 새로).
// idle: 끝남 뒤(봄)면 끝남 그대로 · working 뒤면 끝남 · 대기 뒤면 풀림. working 이면 풀림
export function stepStatus(s, rawTo, t, { from, missed = false } = {}) {
  if (t < s.at) return; // 늦게 읽은 옛 기록
  const to = String(rawTo ?? "").toLowerCase();
  const prev = s.raw ?? (from ? String(from).toLowerCase() : undefined);
  s.raw = to;
  if (to === "blocked" || to === "done") {
    if (s.phase !== to || missed) enter(s, to, t);
    return;
  }
  if (to === "idle") {
    if (s.phase === "done") return; // 끝난 걸 봤다 — 답은 아니다
    if (prev === "working") return void enter(s, "done", t);
    if (s.phase) leave(s, t);
    return;
  }
  if (s.phase) leave(s, t); // working 등
}

const ts = (e) => Date.parse(e?.ts);
// 다리가 알린 그 자리에서 센다(기록을 끈 때도) — 기록에도 같은 ts 로 남겨 다시 읽을 때 한 번만 센다
export function markShown(tr, s, now) {
  s.reminded++;
  s.lastRemindAt = now;
  tr.everReminded.add(s.key);
}
// 이벤트 하나 반영(시간 순으로 부른다)
export function applyEvent(tr, e) {
  const t = ts(e);
  if (!Number.isFinite(t)) return;
  if (e.type === "remind") {
    if (e.action === "snooze") { tr.snoozeUntil = Math.max(tr.snoozeUntil, Number(e.until) || 0); return; }
    if (!e.pane) return;
    const s = tr.sessions.get(sessionKey(e.machine, e.pane));
    if (e.action === "shown") tr.everReminded.add(sessionKey(e.machine, e.pane));
    if (!s?.phase || t < s.since) return; // 지난 단계의 것
    if (e.action === "shown") { if (s.lastRemindAt !== null && t <= s.lastRemindAt) return; s.reminded++; s.lastRemindAt = t; } // 다리가 이미 센 것(같은 ts)은 한 번만
    else if (e.action === "mute") s.muted = true;
    else if (e.action === "dismissed") s.hiddenAt = t; // 이번 묶음에서 닫음 — 다음 때 다시
    return;
  }
  if (!e.pane) return;
  if (e.type === "status") {
    if (e.to === "gone") { tr.sessions.delete(sessionKey(e.machine, e.pane)); return; }
    stepStatus(sess(tr, e.machine, e.pane), e.to, t, { from: e.from, missed: !!e.missed });
  } else if (e.type === "action" && e.ok && e.key === "reply") {
    const s = sess(tr, e.machine, e.pane);
    if (t >= s.at && s.phase) leave(s, t); // 답했다(다음 끝남부터 다시)
  } else if (e.type === "shown" && !isRemindId(e.id)) {
    const s = sess(tr, e.machine, e.pane);
    Object.assign(s, { ownShownAt: t, ownClosedAt: null, ownTtlMs: Number.isFinite(e.ttlMs) ? e.ttlMs : null });
  } else if (e.type === "closed" && !isRemindId(e.id)) {
    const s = tr.sessions.get(sessionKey(e.machine, e.pane));
    if (s) s.ownClosedAt = t;
  }
}
export const applyEvents = (tr, events) => { for (const e of events) applyEvent(tr, e); return tr; };
// events → 새 tracker(시험·다시 켤 때)
export const reminderState = (events) => applyEvents(newTracker(), events);

// 지금 목록(머신 하나) 반영: 목록의 상태를 지금 때로, 목록에 없는 그 머신 세션은 지운다(pane 닫힘)
export function applyLive(tr, machine, agents, now) {
  const m = !machine || machine === "local" ? "local" : machine;
  const seen = new Set();
  for (const a of agents ?? []) {
    if (typeof a?.pane_id !== "string") continue;
    seen.add(a.pane_id);
    const s = tr.sessions.get(sessionKey(m, a.pane_id));
    const st = String(a.agent_status ?? "").toLowerCase();
    if (!s && st !== "done" && st !== "blocked") { sess(tr, m, a.pane_id).raw = st; continue; } // 처음 본 idle·working 은 받아만 둔다
    const x = s ?? sess(tr, m, a.pane_id);
    if (x.raw === st) continue;
    stepStatus(x, st, Math.max(now, x.at));
  }
  for (const [k, s] of tr.sessions) if (s.machine === m && !seen.has(s.pane)) tr.sessions.delete(k);
}

// 그 세션 말풍선이 아직 떠 있나. liveIds(데몬 GET /bubbles/history?live=1 의 id)가 있으면 그것, 없으면(예전 데몬) 기록으로 — 뜬 뒤 안 닫혔고 수명(ttlMs, 모르면 하루) 안
export function ownVisible(s, now, liveIds = null) {
  if (liveIds) return liveIds.has(ownBubbleId(s.machine, s.pane));
  if (s.ownShownAt == null || (s.ownClosedAt != null && s.ownClosedAt >= s.ownShownAt)) return false;
  return now - s.ownShownAt < (s.ownTtlMs ?? DAY);
}

// 세는 시작: 단계에 들어온 때, 그 뒤 처음 말풍선을 닫았으면 그때부터(닫자마자 다시 알리지 않게)
const baseOf = (s) => Math.max(s.since, s.ownClosedAt ?? -Infinity);
const firstGap = (s, cfg) => (s.phase === "blocked" ? cfg.blockedFirstMs : cfg.everyMs);
// 처음 다시 알릴 수 있게 되는 때 | null(이 세션은 안 알림)
export function firstDue(s, cfg) {
  if (!s.phase || s.muted) return null;
  if (s.phase === "blocked" ? !cfg.blockedFirstMs : s.reminded >= cfg.doneMax) return null;
  return baseOf(s) + firstGap(s, cfg);
}
// 다음 다시 알릴 때 | null(더 안 알림 — 그만·끝남 최대 번·입력 대기 EVERY 0 으로 한 번 알림)
export function nextDue(s, cfg) {
  const first = firstDue(s, cfg);
  if (first === null) return null;
  if (s.lastRemindAt == null || s.lastRemindAt < baseOf(s)) return first;
  const every = s.phase === "blocked" ? cfg.blockedEveryMs : cfg.everyMs;
  return every ? Math.max(first, s.lastRemindAt + every) : null;
}

// 지금 무엇을 보일까 → { alive: Set(key)(아직 답 안 했고 제 말풍선도 안 떠 있는 것 — 떠 있는 묶음에서 이것만 남긴다),
//   round: null | [세션…](새로 알릴 때가 됐다 — 때가 된 게 하나라도 있으면 처음 때가 지난 것 전부, 입력 대기 먼저·오래 기다린 것 먼저) }
// 꺼짐·방해 금지·미룸 동안은 round 없음
export function digestPlan(tr, now, cfg, { quiet = false, liveIds = null } = {}) {
  const waiting = [...tr.sessions.values()].filter((s) => s.phase && !s.muted && !ownVisible(s, now, liveIds));
  const alive = new Set(waiting.map((s) => s.key));
  if (!cfg.on || quiet || tr.snoozeUntil > now) return { alive, round: null };
  if (!waiting.some((s) => { const d = nextDue(s, cfg); return d !== null && d <= now; })) return { alive, round: null };
  const round = waiting.filter((s) => { const f = firstDue(s, cfg); return f !== null && f <= now && nextDue(s, cfg) !== null; })
    .sort((a, b) => (a.phase === "blocked" ? 0 : 1) - (b.phase === "blocked" ? 0 : 1) || a.since - b.since);
  return { alive, round };
}

// 묶음 머리 글 · 미룸 단추
export const summaryText = (n) => `답 안 한 세션 ${n}개`;
export const snoozeLabel = (ms) => (ms % 3600e3 === 0 ? `${ms / 3600e3}시간 뒤에` : `${Math.round(ms / MIN)}분 뒤에`);
// 줄 요약: 「14:05 부터 기다려요 · 다시 알림 2/3」(끝남) · 「14:05 부터 확인을 기다려요 · 3번째」(입력 대기)
export function remindDetail(s, cfg, n = s.reminded + 1) {
  const d = new Date(s.since);
  const at = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return s.phase === "blocked" ? `${at} 부터 확인을 기다려요 · ${n}번째 다시 알림` : `${at} 부터 기다려요 · 다시 알림 ${Math.min(n, cfg.doneMax)}/${cfg.doneMax}`;
}

// 다리를 다시 켰을 때 아직 떠 있을 묶음 줄: 답 안 했고, 알린 적 있고, 그 뒤 닫지 않은 것
export const stillShown = (tr, alive) => [...tr.sessions.values()].filter((s) => alive.has(s.key) && s.lastRemindAt !== null && !((s.hiddenAt ?? -1) >= s.lastRemindAt));
