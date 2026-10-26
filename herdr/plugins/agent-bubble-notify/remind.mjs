// 답 안 한 세션 다시 알림 — 순수 함수(herdr-bridge.mjs 가 events.jsonl·지금 상태를 넘긴다). 파일·네트워크는 안 건드린다
// 「답 안 한 세션」: 말풍선이 닫혔는데(사용자가 닫음·시간 다 됨·걷힘) 그때 세션이 끝남(done)·입력 대기(blocked)였고, 그 뒤로 답이 없다.
// 다시 돌기 시작했거나(working) 답(reply)을 보냈으면 아니다. 끝남은 그 pane 을 보면(focus·[세션으로 가기]) 본 것으로 치고, 입력 대기는 대기가 풀릴 때까지 그대로
import { machineBubbleId } from "./lib.mjs";

const MIN = 60e3;
// _remind: 머신 이름 slug(lib machineBubbleId)는 _ 뒤에 16진수만 오므로 어떤 머신 이름과도 안 겹친다
export const REMIND_PREFIX = "ext:herdr:_remind";
export const SUMMARY_ID = "herdr:_remind"; // 묶음 머리(POST /bubbles id — 데몬이 ext: 를 붙인다)
export const REMIND_GROUP = "herdr-remind";
export const isRemindId = (id) => typeof id === "string" && (id === REMIND_PREFIX || id.startsWith(`${REMIND_PREFIX}:`));
// 세션 하나의 다시 알림 말풍선 id(머신 이름은 lib 과 같은 규칙으로)
export const remindItemId = (machine, pane) => machineBubbleId(machine || "local", pane).replace(/^herdr:/, "herdr:_remind:");
export const sessionKey = (machine, pane) => `${!machine || machine === "local" ? "local" : machine}|${pane}`;

// .env → 설정. 분 단위, 0 = 끔
//  AGENT_BUBBLE_REMIND=off 로 전부 끔 · _BLOCKED_FIRST_MIN(10) 처음 · _BLOCKED_EVERY_MIN(30) 그 뒤 간격(0 = 한 번만) · _DONE_MIN("30,120") 끝남은 이때들만 · _SNOOZE_MIN(60)
export function remindConfig(env = process.env) {
  const flag = String(env.AGENT_BUBBLE_REMIND ?? "").trim().toLowerCase();
  const num = (name, d) => { const v = env[name]?.trim(); const n = Number(v); return v && Number.isFinite(n) && n >= 0 ? n : d; };
  const doneRaw = env.AGENT_BUBBLE_REMIND_DONE_MIN;
  const done = (doneRaw === undefined ? "30,120" : String(doneRaw)).split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return {
    on: !["0", "false", "no", "off"].includes(flag),
    blockedFirstMs: num("AGENT_BUBBLE_REMIND_BLOCKED_FIRST_MIN", 10) * MIN,
    blockedEveryMs: num("AGENT_BUBBLE_REMIND_BLOCKED_EVERY_MIN", 30) * MIN,
    doneAtMs: done.map((m) => m * MIN),
    snoozeMs: Math.max(1, num("AGENT_BUBBLE_REMIND_SNOOZE_MIN", 60)) * MIN,
  };
}

// 'working' → 'idle' 은 끝남(보이는 pane) — metrics 와 같게
const normTo = (to, from) => (to === "idle" && from === "working" ? "done" : to);
const WAITING = new Set(["done", "blocked"]);

// events(시간 순) → { sessions: Map(key → { machine, pane, status, closedAt, lastRemindAt, reminded, muted, hiddenAt? }), snoozeUntil, everReminded: Set(key) }
export function reminderState(events) {
  const sessions = new Map(), last = new Map(), shownAt = new Map(), seenAt = new Map(), repliedAt = new Map(), mutedKeys = new Set(), everReminded = new Set();
  let snoozeUntil = 0;
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) continue;
    if (e.type === "remind") {
      if (e.action === "snooze") { snoozeUntil = Math.max(snoozeUntil, Number(e.until) || 0); continue; }
      if (!e.pane) continue;
      const k = sessionKey(e.machine, e.pane);
      const s = sessions.get(k);
      if (e.action === "shown") { everReminded.add(k); if (s) { s.lastRemindAt = t; s.reminded++; } }
      else if (e.action === "mute" && s) { s.muted = true; mutedKeys.add(k); }
      else if (e.action === "dismissed" && s) s.hiddenAt = t; // 이번 묶음에서 닫음 — 다음 때 다시
      continue;
    }
    if (!e.pane) continue;
    const k = sessionKey(e.machine, e.pane);
    const s = sessions.get(k);
    if (e.type === "status") {
      const to = normTo(e.to, e.from);
      last.set(k, to);
      if (s && to !== s.status) sessions.delete(k);
    } else if (e.type === "shown" && !isRemindId(e.id)) {
      shownAt.set(k, t);
      sessions.delete(k); // 말풍선이 다시 떴다 — 닫힐 때 다시 본다
      mutedKeys.delete(k);
    } else if (e.type === "focus") {
      seenAt.set(k, t);
      if (s?.status === "done") sessions.delete(k);
    } else if (e.type === "action" && e.ok) {
      if (e.key === "reply") { repliedAt.set(k, t); sessions.delete(k); }
      else if (e.key === "default") { seenAt.set(k, t); if (s?.status === "done") sessions.delete(k); }
    } else if (e.type === "closed" && !isRemindId(e.id)) {
      const status = WAITING.has(e.status) ? e.status : e.status ? null : last.get(k);
      if (!WAITING.has(status)) continue;
      const since = shownAt.get(k) ?? 0;
      if ((repliedAt.get(k) ?? -1) >= since) continue; // 답을 보내고 걷혔다
      if (status === "done" && (seenAt.get(k) ?? -1) >= since) continue; // 끝난 걸 봤다
      sessions.set(k, { key: k, machine: e.machine || "local", pane: e.pane, status, closedAt: t, lastRemindAt: null, reminded: 0, muted: mutedKeys.has(k) });
    }
  }
  return { sessions, snoozeUntil, everReminded };
}

// 다음 다시 알릴 때(ms) | null(더 안 알림). 처음 때가 지난 뒤 늦게 봤으면 그때 한 번 알리고 다음 때로
export function nextDue(s, cfg) {
  const after = s.lastRemindAt ?? -Infinity;
  if (s.status === "blocked") {
    if (!cfg.blockedFirstMs) return null;
    const first = s.closedAt + cfg.blockedFirstMs;
    if (after < first) return first;
    if (!cfg.blockedEveryMs) return null;
    return first + (Math.floor((after - first) / cfg.blockedEveryMs) + 1) * cfg.blockedEveryMs;
  }
  return cfg.doneAtMs.map((m) => s.closedAt + m).find((x) => x > after) ?? null;
}
// 처음 다시 알릴 수 있게 된 때(이 뒤로는 묶음에 같이 보인다)
const firstAt = (s, cfg) => (s.status === "blocked" ? (cfg.blockedFirstMs ? s.closedAt + cfg.blockedFirstMs : Infinity) : cfg.doneAtMs.length ? s.closedAt + cfg.doneAtMs[0] : Infinity);

// 지금 무엇을 보일까. live(key → 지금 상태 | undefined(모름)): 지금 상태가 다르면(본 뒤 idle·다시 돎·사라짐 'gone') 답한 것으로 친다.
// → { alive: Set(key)(아직 답 안 한 것 — 떠 있는 묶음에서 이것만 남긴다), round: null | [세션…](새로 알릴 때가 됐다 — 이것들로 묶음을 다시, 입력 대기 먼저) }
// round 에는 때가 된 것 + 처음 때가 지났고 아직 남은 때가 있는 것(끝남은 마지막 때가 지나면 더 안 낀다). 방해 금지·미룸 동안은 round 없음
export function digestPlan(state, now, cfg, live = new Map(), { quiet = false } = {}) {
  const alive = [...state.sessions.values()].filter((s) => {
    if (s.muted) return false;
    const st = live.get(s.key);
    return st === undefined || st === s.status;
  });
  const keys = new Set(alive.map((s) => s.key));
  if (!cfg.on || quiet || state.snoozeUntil > now) return { alive: keys, round: null };
  const next = new Map(alive.map((s) => [s.key, nextDue(s, cfg)]));
  if (!alive.some((s) => next.get(s.key) !== null && next.get(s.key) <= now)) return { alive: keys, round: null };
  const round = alive.filter((s) => firstAt(s, cfg) <= now && next.get(s.key) !== null)
    .sort((a, b) => (a.status === "blocked" ? 0 : 1) - (b.status === "blocked" ? 0 : 1) || a.closedAt - b.closedAt);
  return { alive: keys, round };
}

// 묶음 머리 글
export const summaryText = (n) => `답 안 한 세션 ${n}개`;
export const snoozeLabel = (ms) => (ms % 3600e3 === 0 ? `${ms / 3600e3}시간 뒤에` : `${Math.round(ms / MIN)}분 뒤에`);

// 다리를 다시 켰을 때 아직 떠 있을 묶음 줄: 답 안 했고, 알린 적 있고, 그 뒤 닫지 않은 것
export const stillShown = (state, alive) => [...state.sessions.values()].filter((s) => alive.has(s.key) && s.lastRemindAt !== null && !((s.hiddenAt ?? -1) >= s.lastRemindAt));
