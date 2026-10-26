// 생산성 리포트의 순수 함수: events.jsonl 읽기 · notify.log 옛 줄 → 이벤트(backfill) · 머신 이름 맞추기 · 두 맥 중복 빼기 · 대기·응답 짝짓기 · 집계
// 파일·네트워크는 안 건드린다(report.mjs·events-backfill.mjs 가 읽어 넘긴다). 날짜·시는 이 컴퓨터 시간대
import { machineBubbleId } from "./lib.mjs";

const HOUR = 3600e3;
export const DEFAULTS = { maxGapMs: 8 * HOUR, dedupMs: 20e3 };

// JSONL → 이벤트 배열. 깨진 줄·ts 없는 줄은 버린다
export function parseEvents(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e && typeof e.type === "string" && Number.isFinite(Date.parse(e.ts))) out.push(e);
  }
  return out;
}

// ---- backfill: notify.log 한 줄 → 이벤트 | null. line="…"(요약)은 안 옮긴다 ----
// 이 컴퓨터:  "<ts> w4:p3 event=done prev=working" · "<ts> w4:p3 bubble sent done …" · "<ts> action <id> [key] → [machine/]pane [text=N자] ok|이유"
// 다른 컴퓨터: "<ts> [company] w1J:pF event=done" · "<ts> [company] w1J:pF bubble sent done …"
export function parseNotifyLine(line, viewer) {
  const m = String(line).match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/);
  if (!m) return null;
  const [, ts, rest] = m;
  const ev = (type, f) => ({ ts, type, viewer, ...f, backfill: true });
  let r;
  if ((r = rest.match(/^\[([^\]]+)\] (\S+) event=(\w+)$/))) return ev("status", { machine: r[1], pane: r[2], from: null, to: r[3] });
  if ((r = rest.match(/^\[([^\]]+)\] (\S+) bubble sent (done|blocked)\b/))) return ev("shown", { machine: r[1], pane: r[2], id: `ext:${machineBubbleId(r[1], r[2])}`, kind: r[3] === "blocked" ? "warn" : "done" });
  if ((r = rest.match(/^action (\S+) (?:(\S+) )?→ (\S+?)(?: text=(\d+)자)? (.+)$/))) {
    const [, id, key = "default", target, len, res] = r;
    const slash = target.lastIndexOf("/");
    const machine = slash > 0 ? target.slice(0, slash) : "local";
    const pane = slash > 0 ? target.slice(slash + 1) : target;
    return ev("action", { machine, ...(pane !== "?" ? { pane } : {}), id, key, ok: res === "ok", ...(res !== "ok" ? { error: res } : {}), ...(len ? { replyLen: Number(len) } : {}) });
  }
  if ((r = rest.match(/^(\S+) event=(\w+)(?: prev=(\w+))?( \(test\))?$/))) return r[4] ? null : ev("status", { machine: "local", pane: r[1], from: r[3] ?? null, to: r[2] });
  if ((r = rest.match(/^(\S+) bubble sent (done|blocked)\b/))) return ev("shown", { machine: "local", pane: r[1], id: `ext:herdr:${r[1]}`, kind: r[2] === "blocked" ? "warn" : "done" });
  return null;
}

// notify.log 전체 → 이벤트. before(ms)가 있으면 그보다 앞선 줄만(그 뒤는 events.jsonl 이 이미 갖고 있다)
export function backfillEvents(logText, viewer, before = Infinity) {
  const out = [];
  for (const line of String(logText ?? "").split("\n")) {
    const e = parseNotifyLine(line, viewer);
    if (e && Date.parse(e.ts) < before) out.push(e);
  }
  return out;
}

// ---- 머신 이름 맞추기 ----
// 같은 컴퓨터가 집 맥에선 local, 회사 맥에선 home 으로 적힌다 → 둘 다 같은 이름으로.
// viewer 는 쓸 때 이미 이 컴퓨터 이름(lib selfLabel: AGENT_BUBBLE_SOURCE_LABEL → MACHINE_NAMES 의 local → 호스트 이름).
// 이름 = machine 이 local 이면 viewer, 아니면 machine label → alias(a=b) → MACHINE_NAMES 의 이름(home:집 이면 집) → 소문자
export function machineCanon(names = new Map(), alias = new Map()) {
  return (label) => {
    const raw = String(label ?? "");
    const a = alias.get(raw.toLowerCase()) ?? raw;
    return String(names.get(a.toLowerCase())?.name ?? a).toLowerCase();
  };
}
export const sessionMachine = (e, canon) => canon(!e.machine || e.machine === "local" ? e.viewer : e.machine);

// 상태 정규화: 보이는 pane 은 끝나도 done 이 아니라 working → idle 로 온다 → done
const normTo = (to, from) => (to === "idle" && from === "working" ? "done" : to);
const isLocal = (e) => !e.machine || e.machine === "local";

// ---- 두 맥 중복 빼기 ----
// 두 맥 다 두 컴퓨터 세션을 본다 → 같은 바뀜이 두 번(하나는 그 컴퓨터 훅, 하나는 다른 맥 bridge 폴링 — 5초 + ssh 만큼 늦다).
// 열쇠 = 머신 이름 + pane + 종류(status·focus) + 정규화한 to, 다른 viewer 의 같은 열쇠가 windowMs 안이면 하나로.
// 훅 기록(machine local)을 먼저 남긴다(때가 정확하다). 같은 viewer 끼리는 안 뺀다(진짜로 빨리 두 번 끝났을 수 있다). 하나가 viewer 마다 하나씩만 먹는다
export function dedupEvents(events, canon, windowMs = DEFAULTS.dedupMs) {
  const keep = new Set(), kept = new Map();
  let dropped = 0;
  const order = events.map((e, i) => ({ e, i, t: Date.parse(e.ts) }))
    .sort((a, b) => (isLocal(a.e) ? 0 : 1) - (isLocal(b.e) ? 0 : 1) || a.t - b.t);
  for (const { e, i, t } of order) {
    if (e.type !== "status" && e.type !== "focus") { keep.add(i); continue; }
    const key = [sessionMachine(e, canon), e.pane, e.type, e.type === "status" ? normTo(e.to, e.from) : ""].join("|");
    const viewer = canon(e.viewer);
    const list = kept.get(key) ?? [];
    let best = null;
    for (const k of list) {
      const d = Math.abs(k.t - t);
      if (k.viewer !== viewer && !k.absorbed.has(viewer) && d <= windowMs && (!best || d < Math.abs(best.t - t))) best = k;
    }
    if (best) { best.absorbed.add(viewer); dropped++; continue; }
    list.push({ t, viewer, absorbed: new Set() });
    kept.set(key, list);
    keep.add(i);
  }
  return { events: events.filter((_, i) => keep.has(i)), dropped };
}

// backfill 과 실시간 기록이 겹치는 때: viewer 마다 실시간(backfill 아님) 첫 기록부터는 backfill 을 버린다
export function dropOverlap(events) {
  const first = new Map();
  for (const e of events) if (!e.backfill) { const t = Date.parse(e.ts); if (!(first.get(e.viewer) <= t)) first.set(e.viewer, t); }
  return events.filter((e) => !e.backfill || !(Date.parse(e.ts) >= (first.get(e.viewer) ?? Infinity)));
}

// ---- 대기·응답 짝짓기 ----
// 세션(머신 이름 + pane)마다 시간 순으로:
//   done·blocked → 대기 시작(앞 대기가 열려 있으면 응답 때를 모르는 채 닫음 — superseded)
//   working     → 열린 대기에 응답(latency). done·idle 에서 working 이면 프롬프트 하나
//   idle        → 입력 대기였으면 응답(직접 답했거나 취소). 끝남 뒤 idle 은 「봤다」일 뿐 — 대기는 이어진다
//   gone        → pane 사라짐, 대기 닫음(응답 없음)
//   focus       → 열린 대기의 「처음 본 때」
// 응답까지 maxGapMs 넘으면(밤새 둔 것) overnight — 지연·대기 합에서 뺀다
export function pairWaits(events, canon, { maxGapMs = DEFAULTS.maxGapMs } = {}) {
  const bySession = new Map();
  for (const e of events) {
    if ((e.type !== "status" && e.type !== "focus") || !e.pane) continue;
    const s = `${sessionMachine(e, canon)}|${e.pane}`;
    if (!bySession.has(s)) bySession.set(s, []);
    bySession.get(s).push(e);
  }
  const waits = [], prompts = [];
  for (const [session, list] of bySession) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    let wait = null, last = null;
    const close = (t, how) => { wait.end = t; wait.how = how; wait = null; };
    for (const e of list) {
      const t = Date.parse(e.ts);
      if (e.type === "focus") { if (wait && wait.look === undefined && t - wait.start <= maxGapMs) wait.look = t - wait.start; continue; }
      const to = normTo(e.to, e.from ?? last);
      if (to === "done" || to === "blocked") {
        if (e.missed && (last === "done" || last === "idle")) prompts.push({ session, t });
        if (wait) close(t, "superseded");
        wait = { session, kind: to, start: t };
        waits.push(wait);
      } else if (to === "working") {
        if (last === "done" || last === "idle") prompts.push({ session, t });
        if (wait) answer(wait, t);
      } else if (to === "idle") {
        if (wait?.kind === "blocked") answer(wait, t);
      } else if (to === "gone") {
        if (wait) close(t, "gone");
      }
      last = to === "gone" ? null : to;
    }
    function answer(w, t) {
      const lat = t - w.start;
      if (lat > maxGapMs) w.overnight = true;
      else w.latency = lat;
      close(t, "answered");
    }
  }
  waits.sort((a, b) => a.start - b.start);
  prompts.sort((a, b) => a.t - b.t);
  markConcurrency(waits);
  return { waits, prompts };
}

// 동시 대기: 응답받은 대기(밤새 둔 것 뺌)의 [시작, 응답) 구간만 센다 — 끝내 응답 없는 끝남(그냥 끝난 일)까지 세면 부풀려진다.
// 대기마다 시작 때 열려 있던 수(자기 포함)를 w.waiting 에
export function markConcurrency(waits) {
  const iv = waits.filter((w) => w.latency !== undefined);
  for (const w of iv) w.waiting = iv.filter((o) => o.start <= w.start && w.start < o.end).length || 1;
}

// 구간들 → 최대 동시 수, 하나라도 기다릴 때의 시간 가중 평균
export function concurrencyStats(waits) {
  const pts = [];
  for (const w of waits) if (w.latency !== undefined && w.end > w.start) pts.push([w.start, 1], [w.end, -1]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let n = 0, max = 0, busy = 0, area = 0, prev = null;
  for (const [t, d] of pts) {
    if (prev !== null && n > 0) { busy += t - prev; area += n * (t - prev); }
    n += d;
    max = Math.max(max, n);
    prev = t;
  }
  return { max, avg: busy ? area / busy : 0 };
}

// 가까운 순위(nearest-rank) 백분위
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}
const dist = (xs) => ({ n: xs.length, median: percentile(xs, 0.5), p90: percentile(xs, 0.9) });

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hourOf = (t) => new Date(t).getHours();

export const CONC_BUCKETS = [[1, 1, "1"], [2, 2, "2"], [3, 3, "3"], [4, 5, "4–5"], [6, Infinity, "6+"]];
export const REWORK_MIN = 3;

// 대기·프롬프트 한 묶음(하루 또는 전체) → 숫자들
export function waitStats(waits, prompts, { actions = [] } = {}) {
  const lat = (k) => waits.filter((w) => w.kind === k && w.latency !== undefined).map((w) => w.latency);
  const sum = (k) => waits.filter((w) => w.kind === k && w.latency !== undefined).reduce((a, w) => a + w.latency, 0);
  // 활동 시간: 프롬프트·응답·버튼 누름이 있었던 (날짜, 시) 칸 수
  const hours = new Set([
    ...prompts.map((p) => p.t),
    ...waits.filter((w) => w.how === "answered" && !w.overnight).map((w) => w.end),
    ...actions.map((a) => Date.parse(a.ts)),
  ].map((t) => `${dayKey(t)} ${hourOf(t)}`));
  // 재작업: 하루에 같은 세션이 REWORK_MIN 번 넘게 끝남
  const cycles = new Map();
  for (const w of waits) if (w.kind === "done") { const k = `${dayKey(w.start)}|${w.session}`; cycles.set(k, (cycles.get(k) ?? 0) + 1); }
  const cyc = [...cycles.values()];
  const conc = concurrencyStats(waits);
  const byConcurrency = CONC_BUCKETS.map(([lo, hi, label]) => ({ bucket: label, ...dist(waits.filter((w) => w.waiting >= lo && w.waiting <= hi).map((w) => w.latency)) }));
  const looks = waits.filter((w) => w.look !== undefined).map((w) => w.look);
  return {
    done: waits.filter((w) => w.kind === "done").length,
    blocked: waits.filter((w) => w.kind === "blocked").length,
    latency: { done: dist(lat("done")), blocked: dist(lat("blocked")) },
    overnight: waits.filter((w) => w.overnight).length,
    unanswered: waits.filter((w) => w.how !== "answered").length,
    blockedWaitMs: sum("blocked"),
    doneWaitMs: sum("done"),
    prompts: prompts.length,
    sessions: new Set(prompts.map((p) => p.session)).size,
    activeHours: hours.size,
    promptsPerHour: hours.size ? prompts.length / hours.size : 0,
    rework: { sessionDays: cyc.filter((c) => c >= REWORK_MIN).length, maxCycles: cyc.length ? Math.max(...cyc) : 0, avgCycles: cyc.length ? cyc.reduce((a, b) => a + b, 0) / cyc.length : 0 },
    concurrency: { max: conc.max, avg: conc.avg },
    byConcurrency,
    firstLook: dist(looks),
  };
}

// 말풍선 반응: viewer + 말풍선 id 마다 시간 순 — 보냄(shown) 다음 첫 action(go·reply)·closed(dismiss·expired·cleared), 다음 보냄까지 없으면 none
export const MIX_KEYS = ["go", "reply", "dismiss", "expired", "cleared", "none"];
export function bubbleMix(events) {
  const byId = new Map();
  for (const e of events) {
    if (!["shown", "action", "closed"].includes(e.type) || !e.id) continue;
    const k = `${e.viewer}|${e.id}`;
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(e);
  }
  const shown = [];
  for (const list of byId.values()) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    let cur = null;
    for (const e of list) {
      if (e.type === "shown") { cur = { t: Date.parse(e.ts), kind: e.kind, outcome: "none" }; shown.push(cur); continue; }
      if (!cur || cur.outcome !== "none") continue;
      if (e.type === "action") { cur.outcome = e.key === "reply" ? "reply" : "go"; cur.failed = e.ok === false; cur.after = Date.parse(e.ts) - cur.t; }
      else cur.outcome = e.reason === "dismissed" ? "dismiss" : e.reason === "expired" ? "expired" : "cleared";
    }
  }
  return shown;
}
export function mixStats(shown) {
  const counts = Object.fromEntries(MIX_KEYS.map((k) => [k, 0]));
  for (const s of shown) counts[s.outcome]++;
  return { shown: shown.length, ...counts, failed: shown.filter((s) => s.failed).length, actionAfter: dist(shown.filter((s) => s.after !== undefined).map((s) => s.after)) };
}

// 전체 리포트: 이벤트(이미 합침) → { range, total, days[], hours[], machines, viewers }
// since·until: ms. 짝짓기는 범위 밖까지 보고(범위 앞에 시작한 대기의 응답), 셈은 대기 시작·프롬프트 때가 범위 안인 것만
export function buildReport(allEvents, { canon = machineCanon(), since = -Infinity, until = Infinity, maxGapMs = DEFAULTS.maxGapMs, dedupMs = DEFAULTS.dedupMs } = {}) {
  const merged = dropOverlap(allEvents);
  const { events, dropped } = dedupEvents(merged, canon, dedupMs);
  const { waits: allWaits, prompts: allPrompts } = pairWaits(events, canon, { maxGapMs });
  const inRange = (t) => t >= since && t < until;
  const waits = allWaits.filter((w) => inRange(w.start));
  const prompts = allPrompts.filter((p) => inRange(p.t));
  const actions = events.filter((e) => e.type === "action" && inRange(Date.parse(e.ts)));
  const shown = bubbleMix(events).filter((s) => inRange(s.t));
  const days = [...new Set([...waits.map((w) => dayKey(w.start)), ...prompts.map((p) => dayKey(p.t))])].sort().map((day) => {
    const on = (t) => dayKey(t) === day;
    return { day, ...waitStats(waits.filter((w) => on(w.start)), prompts.filter((p) => on(p.t)), { actions: actions.filter((a) => on(Date.parse(a.ts))) }), bubbles: mixStats(shown.filter((s) => on(s.t))) };
  });
  const hours = Array.from({ length: 24 }, (_, h) => {
    const ws = waits.filter((w) => hourOf(w.start) === h);
    return { hour: h, waits: ws.length, prompts: prompts.filter((p) => hourOf(p.t) === h).length, latency: dist(ws.filter((w) => w.latency !== undefined).map((w) => w.latency)) };
  });
  const evIn = events.filter((e) => inRange(Date.parse(e.ts)));
  return {
    range: { since: Number.isFinite(since) ? new Date(since).toISOString() : null, until: Number.isFinite(until) ? new Date(until).toISOString() : null },
    options: { maxGapMs, dedupMs },
    events: { read: allEvents.length, overlapDropped: allEvents.length - merged.length, dedupDropped: dropped, inRange: evIn.length, backfill: evIn.filter((e) => e.backfill).length },
    viewers: [...new Set(evIn.map((e) => canon(e.viewer)))].sort(),
    machines: [...new Set(evIn.filter((e) => e.type === "status").map((e) => sessionMachine(e, canon)))].sort(),
    total: { ...waitStats(waits, prompts, { actions }), bubbles: mixStats(shown) },
    days,
    hours,
  };
}
