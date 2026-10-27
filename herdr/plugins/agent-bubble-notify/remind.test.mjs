// 다시 알림(remind.mjs): 설정 우선순위·AgentBot 설정 읽기(예전 데몬 404) · 세션 단계 따라가기 · 때(간격·되풀이·끝남 최대 번) · 미룸·그만·방해 금지 · 다시 돎·답 · 떠 있는 말풍선과 안 겹침
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  remindConfig, fetchRemindPref, prefCache, newTracker, applyEvent, applyEvents, applyLive, reminderState, stepStatus, markShown,
  firstDue, nextDue, digestPlan, digestActions, listed, stillShown, ownVisible, ownBubbleId, remindMeta, metaFallback, agoText, postWithFallback, META_RETRY_MS, quietKeep, remindItemId, SUMMARY_ID, DEFAULT_EVERY_MIN, DEFAULT_DONE_MAX,
} from "./remind.mjs";
import { machineBubbleId } from "./lib.mjs";

const MIN = 60e3;
const T0 = Date.parse("2026-10-27T01:00:00.000Z");
const at = (m) => T0 + m * MIN;
const ev = (min, type, f = {}) => ({ ts: new Date(at(min)).toISOString(), type, viewer: "집", machine: "local", ...f });
const CFG = remindConfig({});
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("설정: 기본 켜짐 3분·끝남 3번·미룸 1시간 · .env > AgentBot 설정 > 기본 · 입력 대기 고급 값 · 예전 DONE_MIN 빈 값은 끝남 끔", () => {
  assert.equal(DEFAULT_EVERY_MIN, 3);
  assert.equal(DEFAULT_DONE_MAX, 3);
  assert.deepEqual({ ...CFG, from: undefined }, { on: true, everyMs: 3 * MIN, blockedFirstMs: 3 * MIN, blockedEveryMs: 3 * MIN, doneMax: 3, snoozeMs: 60 * MIN, from: undefined });
  assert.deepEqual(CFG.from, { on: "default", every: "default" });
  const app = remindConfig({}, { enabled: true, everyMin: 10 });
  assert.equal(app.everyMs, 10 * MIN);
  assert.equal(app.blockedFirstMs, 10 * MIN);
  assert.equal(app.from.every, "app");
  assert.equal(remindConfig({}, { enabled: false, everyMin: 10 }).on, false); // 설정 창에서 끔
  const env = remindConfig({ AGENT_BUBBLE_REMIND_EVERY_MIN: "5" }, { enabled: true, everyMin: 10 });
  assert.deepEqual([env.everyMs, env.from.every], [5 * MIN, "env"]); // .env 가 이긴다
  assert.equal(remindConfig({ AGENT_BUBBLE_REMIND: "on" }, { enabled: false, everyMin: 10 }).on, true);
  assert.equal(remindConfig({ AGENT_BUBBLE_REMIND: "off" }, { enabled: true, everyMin: 10 }).on, false);
  assert.equal(remindConfig({}, { everyMin: 500 }).everyMs, 3 * MIN); // 이상한 앱 값은 기본
  assert.equal(remindConfig({ AGENT_BUBBLE_REMIND_EVERY_MIN: "0" }, null).everyMs, 3 * MIN); // 0 은 안 받는다
  const adv = remindConfig({ AGENT_BUBBLE_REMIND_BLOCKED_FIRST_MIN: "10", AGENT_BUBBLE_REMIND_BLOCKED_EVERY_MIN: "0", AGENT_BUBBLE_REMIND_DONE_MAX: "5", AGENT_BUBBLE_REMIND_SNOOZE_MIN: "30" });
  assert.deepEqual([adv.blockedFirstMs, adv.blockedEveryMs, adv.doneMax, adv.snoozeMs, adv.everyMs], [10 * MIN, 0, 5, 30 * MIN, 3 * MIN]);
  assert.equal(remindConfig({ AGENT_BUBBLE_REMIND_DONE_MIN: "" }).doneMax, 0);
  assert.equal(remindConfig({ AGENT_BUBBLE_REMIND_DONE_MIN: "30,120" }).doneMax, 3); // 예전 때 목록은 안 쓴다
});

test("AgentBot 설정 읽기: GET /prefs/remind → { enabled, everyMin } · 예전 데몬(404)·꺼짐·이상한 답은 null → 기본 3분 · 30초 기억", async () => {
  const urls = [];
  const ok = async (u) => { urls.push(u); return res(200, { enabled: true, everyMin: 7 }); };
  assert.deepEqual(await fetchRemindPref("http://127.0.0.1:47891/", ok), { enabled: true, everyMin: 7 });
  assert.equal(urls[0], "http://127.0.0.1:47891/prefs/remind");
  assert.equal(await fetchRemindPref("http://x", async () => res(404, { error: "not found" })), null);
  assert.equal(await fetchRemindPref("http://x", async () => { throw new Error("ECONNREFUSED"); }), null);
  assert.equal(await fetchRemindPref("http://x", async () => res(200, [1])), null);
  assert.equal(remindConfig({}, await fetchRemindPref("http://x", async () => res(404, {}))).everyMs, 3 * MIN);
  let n = 0, t = 0;
  const get = prefCache(async () => { n++; return { enabled: true, everyMin: n }; }, 30e3, () => t);
  assert.deepEqual(await get(), { enabled: true, everyMin: 1 });
  t = 29e3;
  assert.deepEqual(await get(), { enabled: true, everyMin: 1 });
  t = 31e3;
  assert.deepEqual(await get(), { enabled: true, everyMin: 2 });
  const fail = prefCache(async () => { throw new Error("x"); }, 30e3, () => 0);
  assert.equal(await fail(), null);
});

test("세션 단계: 대기·끝남으로 들어옴 · 끝난 걸 보기만(idle)은 그대로 · working 뒤 idle 은 끝남 · 대기 뒤 idle·다시 돎·답이면 풀림 · 늦게 읽은 옛 기록은 무시", () => {
  const tr = applyEvents(newTracker(), [
    ev(0, "status", { pane: "d", from: "working", to: "done" }), ev(2, "status", { pane: "d", from: "done", to: "idle" }), // 봤다 — 답은 아니다
    ev(0, "status", { pane: "v", from: "working", to: "idle" }), // 보이는 pane 이 끝남
    ev(0, "status", { pane: "b", from: "working", to: "blocked" }),
    ev(0, "status", { pane: "x", from: "working", to: "blocked" }), ev(1, "status", { pane: "x", from: "blocked", to: "idle" }), // 직접 답했거나 취소
    ev(0, "status", { pane: "w", from: "working", to: "done" }), ev(1, "status", { pane: "w", from: "done", to: "working" }),
    ev(0, "status", { pane: "r", from: "working", to: "done" }), ev(1, "action", { pane: "r", id: "ext:herdr:r", key: "reply", ok: true }),
    ev(0, "status", { machine: "회사", pane: "c", from: "working", to: "done" }), ev(5, "status", { machine: "회사", pane: "c", from: "done", to: "done", missed: true }),
  ]);
  const ph = (k) => tr.sessions.get(k)?.phase ?? null;
  assert.deepEqual(["local|d", "local|v", "local|b", "local|x", "local|w", "local|r", "회사|c"].map(ph), ["done", "done", "blocked", null, null, null, "done"]);
  assert.equal(tr.sessions.get("local|d").since, at(0)); // 본 뒤에도 처음 때 그대로
  assert.equal(tr.sessions.get("회사|c").since, at(5)); // 한 바퀴 돌아 다시 끝남 — 새로
  applyEvent(tr, ev(-1, "status", { pane: "b", from: "blocked", to: "working" })); // 옛 기록
  assert.equal(ph("local|b"), "blocked");
  applyEvent(tr, ev(9, "status", { pane: "b", to: "gone" }));
  assert.equal(tr.sessions.has("local|b"), false);
});

test("지금 목록: 알림이 안 떴던 세션도 잡는다(처음 본 done·blocked 는 지금부터) · 목록에서 사라지면 지운다 · 처음 본 idle 은 아님", () => {
  const tr = newTracker();
  applyLive(tr, "local", [{ pane_id: "a", agent_status: "done" }, { pane_id: "b", agent_status: "blocked" }, { pane_id: "i", agent_status: "idle" }], at(0));
  applyLive(tr, "회사", [{ pane_id: "r", agent_status: "working" }], at(0));
  assert.deepEqual([...tr.sessions.values()].filter((s) => s.phase).map((s) => `${s.key}:${s.phase}@${(s.since - T0) / MIN}`), ["local|a:done@0", "local|b:blocked@0"]);
  applyLive(tr, "회사", [{ pane_id: "r", agent_status: "idle" }], at(1)); // working → idle = 끝남
  assert.equal(tr.sessions.get("회사|r").phase, "done");
  applyLive(tr, "local", [{ pane_id: "a", agent_status: "idle" }], at(2)); // a 는 본 것, b 는 사라짐
  assert.equal(tr.sessions.get("local|a").phase, "done");
  assert.equal(tr.sessions.has("local|b"), false);
  assert.equal(tr.sessions.get("회사|r").phase, "done"); // 다른 머신 목록은 그대로
});

test("때: 간격 이상 계속 기다리면 · 간격마다 되풀이 · 끝남은 최대 3번 · 입력 대기는 계속 · 처음 말풍선을 닫았으면 닫은 때부터 · 고급 값", () => {
  const s = { phase: "blocked", since: at(0), reminded: 0, lastRemindAt: null, muted: false, ownClosedAt: null };
  assert.equal(firstDue(s, CFG), at(3));
  assert.equal(nextDue(s, CFG), at(3));
  assert.equal(nextDue({ ...s, reminded: 1, lastRemindAt: at(3) }, CFG), at(6));
  assert.equal(nextDue({ ...s, reminded: 9, lastRemindAt: at(30) }, CFG), at(33)); // 입력 대기는 계속
  assert.equal(nextDue({ ...s, ownClosedAt: at(10) }, CFG), at(13)); // 닫자마자 다시 알리지 않는다
  const d = { ...s, phase: "done" };
  assert.equal(nextDue({ ...d, reminded: 2, lastRemindAt: at(6) }, CFG), at(9));
  assert.equal(nextDue({ ...d, reminded: 3, lastRemindAt: at(9) }, CFG), null); // 끝남 최대 3번
  assert.equal(nextDue(d, { ...CFG, doneMax: 0 }), null);
  assert.equal(nextDue({ ...s, muted: true }, CFG), null);
  const adv = remindConfig({ AGENT_BUBBLE_REMIND_BLOCKED_FIRST_MIN: "10", AGENT_BUBBLE_REMIND_BLOCKED_EVERY_MIN: "0" });
  assert.equal(nextDue(s, adv), at(10));
  assert.equal(nextDue({ ...s, reminded: 1, lastRemindAt: at(10) }, adv), null); // 한 번만
  assert.equal(nextDue(d, adv), at(3)); // 끝남은 공통 간격
});

test("묶음: 제 때가 된 것만 알리고 센다(대기 먼저) · 남의 때에 묻어 세지 않는다 · 미룸·방해 금지·꺼짐·그만이면 없음 · 다시 돎·답한 건 빠짐 · 끝남 3번 뒤엔 알림 대신 줄로", () => {
  const base = [
    ev(0, "status", { pane: "d", from: "working", to: "done" }),
    ev(1, "status", { pane: "b", from: "working", to: "blocked" }),
  ];
  const tr = reminderState(base);
  assert.equal(digestPlan(tr, at(2.9), CFG).due, null);
  assert.deepEqual(digestPlan(tr, at(3), CFG).due.map((s) => s.key), ["local|d"]); // 대기는 아직(1+3)
  for (const s of digestPlan(tr, at(3), CFG).due) markShown(tr, s, at(3));
  const p4 = digestPlan(tr, at(4), CFG);
  assert.deepEqual([p4.due.map((s) => s.key), p4.keep.map((s) => s.key)], [["local|b"], ["local|d"]]); // b 만 센다 — d 는 떠 있는 줄 그대로
  assert.equal(tr.sessions.get("local|d").reminded, 1);
  assert.deepEqual([digestPlan(tr, at(4), CFG, { quiet: true }).due, digestPlan(tr, at(4), CFG, { quiet: true }).pause], [null, "quiet"]);
  assert.deepEqual([digestPlan(tr, at(4), { ...CFG, on: false }).due, digestPlan(tr, at(4), { ...CFG, on: false }).pause], [null, "off"]);
  // 세션마다 제 간격: d 는 6분, b 는 7분
  for (const s of p4.due) markShown(tr, s, at(4));
  assert.equal(digestPlan(tr, at(5.9), CFG).due, null);
  assert.deepEqual(digestPlan(tr, at(6), CFG).due.map((s) => s.key), ["local|d"]);
  assert.deepEqual(digestPlan(tr, at(7), CFG).due.map((s) => s.key), ["local|b", "local|d"]);
  // 기록(같은 ts)을 다시 읽어도 한 번만 센다
  applyEvent(tr, ev(3, "remind", { action: "shown", pane: "d" }));
  assert.equal(tr.sessions.get("local|d").reminded, 1);
  // 미룸(머리 [N분 뒤에])
  const sn = reminderState([...base, ev(4, "remind", { action: "shown", pane: "d" }), ev(4, "remind", { action: "shown", pane: "b" }), ev(5, "remind", { action: "snooze", until: at(65) })]);
  assert.deepEqual([digestPlan(sn, at(64), CFG).due, digestPlan(sn, at(64), CFG).pause], [null, "snooze"]);
  assert.ok(digestPlan(sn, at(65), CFG).due.length);
  // 그만(그 세션만, 그 단계 동안)
  const mu = reminderState([...base, ev(5, "remind", { action: "mute", pane: "b" })]);
  assert.deepEqual([...digestPlan(mu, at(10), CFG).alive], ["local|d"]);
  const again = reminderState([...base, ev(5, "remind", { action: "mute", pane: "b" }), ev(6, "status", { pane: "b", from: "blocked", to: "working" }), ev(8, "status", { pane: "b", from: "working", to: "blocked" })]);
  assert.ok(again.sessions.get("local|b").phase === "blocked" && !again.sessions.get("local|b").muted); // 새 대기는 다시
  // 그사이 다시 돎·답함
  const moved = reminderState([...base, ev(2, "status", { pane: "d", from: "done", to: "working" }), ev(2, "action", { pane: "b", id: "ext:herdr:b", key: "reply", ok: true })]);
  assert.equal(digestPlan(moved, at(10), CFG).alive.size, 0);
  // 본(idle) 끝남은 그대로 알린다
  const seen = reminderState([...base, ev(2, "status", { pane: "d", from: "done", to: "idle" }), ev(2, "focus", { pane: "d" })]);
  assert.ok(digestPlan(seen, at(4), CFG).due.some((s) => s.key === "local|d"));
  // 끝남 3번 뒤: 대기만
  const three = reminderState([...base, ...[4, 7, 10].flatMap((m) => [ev(m, "remind", { action: "shown", pane: "d" }), ev(m, "remind", { action: "shown", pane: "b" })])]);
  assert.deepEqual(digestPlan(three, at(13), CFG).due.map((s) => s.key), ["local|b"]);
  assert.ok(digestPlan(three, at(13), CFG).alive.has("local|d")); // 줄은 아직 답 안 한 것으로 남는다
  assert.deepEqual(digestPlan(three, at(13), CFG).keep.map((s) => s.key), ["local|d"]);
});

test("떠 있는 말풍선과 안 겹침: 그 세션 말풍선이 떠 있으면 묶음에 안 넣는다(데몬 live 목록 · 예전 데몬이면 기록의 shown·closed·ttl)", () => {
  const evs = [
    ev(0, "status", { pane: "p", from: "working", to: "done" }), ev(0, "shown", { pane: "p", id: "ext:herdr:p", ttlMs: 120 * MIN }),
    ev(0, "status", { machine: "회사", pane: "q", from: "working", to: "blocked" }), ev(0, "shown", { machine: "회사", pane: "q", id: "ext:herdr:회사:q" }),
    ev(0, "status", { pane: "n", from: "working", to: "done" }), // 말풍선이 안 떴다(보고 있던 pane)
  ];
  const tr = reminderState(evs);
  assert.equal(ownBubbleId("local", "p"), "ext:herdr:p");
  assert.equal(ownBubbleId("회사", "q"), `ext:${machineBubbleId("회사", "q")}`);
  assert.deepEqual(digestPlan(tr, at(5), CFG).due.map((s) => s.key), ["local|n"]); // 기록으로 어림
  assert.deepEqual(digestPlan(tr, at(5), CFG, { liveIds: new Set(["ext:herdr:p"]) }).due.map((s) => s.key), ["회사|q", "local|n"]); // 데몬이 아는 대로
  assert.equal(ownVisible(tr.sessions.get("local|p"), at(121), null), false); // 수명이 다 됨
  // 닫으면 닫은 때부터 간격
  const closed = reminderState([...evs, ev(4, "closed", { pane: "p", id: "ext:herdr:p", reason: "dismissed" })]);
  assert.equal((digestPlan(closed, at(6.9), CFG).due ?? []).some((s) => s.key === "local|p"), false);
  assert.ok(digestPlan(closed, at(7), CFG).due.some((s) => s.key === "local|p"));
});

test("다리를 다시 켬: 알렸고 그 뒤 안 닫은 줄만 아직 떠 있다 · 줄 요약 글 · id", () => {
  const evs = [
    ev(0, "status", { pane: "a", from: "working", to: "blocked" }), ev(0, "status", { pane: "b", from: "working", to: "done" }),
    ev(3, "remind", { action: "shown", pane: "a" }), ev(3, "remind", { action: "shown", pane: "b" }), ev(4, "remind", { action: "dismissed", pane: "b" }),
  ];
  const tr = reminderState(evs);
  assert.deepEqual(stillShown(tr, new Set(["local|a", "local|b"])).map((s) => s.key), ["local|a"]);
  assert.deepEqual([...tr.everReminded].sort(), ["local|a", "local|b"]);
  const s = tr.sessions.get("local|b");
  assert.deepEqual(remindMeta(s, CFG), { since: at(0), text: "{ago} 기다려요 · 다시 알림 2/3" });
  assert.deepEqual(remindMeta(tr.sessions.get("local|a"), CFG), { since: at(0), text: "{ago} 확인을 기다려요 · 2번째 다시 알림" });
  assert.equal(remindItemId("local", "w4:p3"), "herdr:_remind:local:w4:p3");
  assert.equal(SUMMARY_ID, "herdr:_remind");
  const x = { phase: null, raw: undefined, at: -Infinity };
  stepStatus(x, "idle", at(0));
  assert.equal(x.phase, null);
});

test("끝남 N번 뒤: 다시 알리지는 않고(셈·due 없음) 묶음 줄로 조용히 남는다 · 다른 세션 때문에 묶음이 새로 떠도 빠지지 않는다", () => {
  const evs = [
    ev(0, "status", { pane: "d", from: "working", to: "done" }),
    ...[3, 6, 9].map((m) => ev(m, "remind", { action: "shown", pane: "d" })),
    ev(10, "status", { pane: "e", from: "working", to: "done" }), // 나중에 끝난 다른 세션
  ];
  const tr = reminderState(evs);
  const d = tr.sessions.get("local|d");
  assert.equal(d.reminded, 3);
  assert.equal(nextDue(d, CFG), null); // 더는 안 알린다
  assert.ok(quietKeep(d, CFG));
  assert.equal(digestPlan(tr, at(12), CFG).due, null); // d 만으로는 묶음이 다시 안 뜬다
  assert.ok(digestPlan(tr, at(12), CFG).alive.has("local|d")); // 떠 있는 줄은 그대로 둔다
  const p = digestPlan(tr, at(13), CFG); // e 가 때가 됨
  assert.deepEqual(p.due.map((s) => s.key), ["local|e"]); // 알리는(세는) 건 e 뿐
  assert.deepEqual(p.keep.map((s) => s.key), ["local|d"]); // d 는 조용히 같이 남는다
  for (const s of p.due) markShown(tr, s, at(13));
  assert.equal(d.reminded, 3); // d 는 세지 않는다
  // 몇 시간 뒤에도(e 가 계속 되풀이) d 는 남는다
  for (const m of [16, 19]) { // e 의 2·3번째
    const q = digestPlan(tr, at(m), CFG);
    assert.deepEqual([q.due.map((s) => s.key), q.keep.map((s) => s.key)], [["local|e"], ["local|d"]], `${m}분`);
    for (const s of q.due) markShown(tr, s, at(m));
  }
  assert.equal(d.reminded, 3);
  // 둘 다 다 알림: 몇 시간 뒤에도 새로 안 뜨고(due 없음) 둘 다 떠 있는 줄로 남는다
  for (const m of [22, 60, 240]) {
    const q = digestPlan(tr, at(m), CFG);
    assert.equal(q.due, null);
    assert.deepEqual([...q.alive].sort(), ["local|d", "local|e"]);
  }
  // 그때 새 세션이 때가 되면 둘 다 조용히 같이
  applyEvent(tr, ev(250, "status", { pane: "f", from: "working", to: "done" }));
  const late = digestPlan(tr, at(253), CFG);
  assert.deepEqual([late.due.map((s) => s.key), late.keep.map((s) => s.key)], [["local|f"], ["local|d", "local|e"]]);
  // 블로킹은 그대로 — 계속 다시 알린다(조용히 남김 대상 아님)
  const b = reminderState([ev(0, "status", { pane: "b", from: "working", to: "blocked" }), ...[3, 6, 9, 12, 15].map((m) => ev(m, "remind", { action: "shown", pane: "b" }))]);
  const bs = b.sessions.get("local|b");
  assert.equal(quietKeep(bs, CFG), false);
  assert.deepEqual(digestPlan(b, at(18), CFG).due.map((s) => s.key), ["local|b"]);
  assert.deepEqual(remindMeta(bs, CFG), { since: at(0), text: "{ago} 확인을 기다려요 · 6번째 다시 알림" });
  // DONE_MAX 0 이면 끝남은 줄로도 안 남긴다(한 번도 안 알렸다)
  assert.equal(quietKeep({ ...d, reminded: 0, lastRemindAt: null }, { ...CFG, doneMax: 0 }), false);
});

test("조용히 남은 줄이 빠지는 때: 답함·다시 돎·✕(줄 닫기)·머리 닫기·그만·세션 사라짐 · 미룸으로 걷힌 건 다음 묶음에 다시", () => {
  const base = [
    ev(0, "status", { pane: "d", from: "working", to: "done" }),
    ...[3, 6, 9].map((m) => ev(m, "remind", { action: "shown", pane: "d" })),
    ev(10, "status", { pane: "e", from: "working", to: "done" }),
  ];
  const quietAt = (extra, m = 13) => digestPlan(reminderState([...base, ...extra]), at(m), CFG).keep.map((s) => s.key);
  assert.deepEqual(quietAt([], 12), ["local|d"]); // 알림이 없는 때도 남길 줄이다
  assert.deepEqual(quietAt([]), ["local|d"]);
  assert.deepEqual(quietAt([ev(11, "action", { pane: "d", id: "ext:herdr:_remind:local:d", key: "reply", ok: true })]), []); // 답함
  assert.deepEqual(quietAt([ev(11, "status", { pane: "d", from: "done", to: "working" })]), []); // 다시 돎
  assert.deepEqual(quietAt([ev(11, "remind", { action: "dismissed", pane: "d" })]), []); // ✕ — 다시 안 넣는다
  assert.deepEqual(quietAt([ev(11, "remind", { action: "mute", pane: "d" })]), []); // 그만
  assert.deepEqual(quietAt([ev(11, "status", { pane: "d", to: "gone" })]), []); // 세션 사라짐
  assert.equal(reminderState([...base, ev(11, "remind", { action: "mute", pane: "d" })]).sessions.get("local|d").muted, true);
  // ✕ 를 아직 알리던 때(2번째 뒤) 눌렀으면 3번째 알림에서 다시 보이고, 그 뒤 조용히 남는다(닫은 건 그 묶음만)
  const early = reminderState([ev(0, "status", { pane: "d", from: "working", to: "done" }), ev(3, "remind", { action: "shown", pane: "d" }), ev(6, "remind", { action: "shown", pane: "d" }), ev(7, "remind", { action: "dismissed", pane: "d" }), ev(9, "remind", { action: "shown", pane: "d" })]);
  assert.ok(quietKeep(early.sessions.get("local|d"), CFG));
  // 미룸: 기간 동안 due 없음 → 끝나면 다음 묶음에 d 도 다시(미룸은 닫기가 아니다)
  const sn = reminderState([...base, ev(11, "remind", { action: "snooze", until: at(71) })]);
  assert.equal(digestPlan(sn, at(70), CFG).due, null);
  assert.deepEqual(digestPlan(sn, at(71), CFG).keep.map((s) => s.key), ["local|d"]);
  // 다리를 다시 켬: 조용히 남던 줄도 이어받는다(닫은 건 아님)
  const tr = reminderState(base);
  assert.deepEqual(stillShown(tr, digestPlan(tr, at(12), CFG).alive).map((s) => s.key), ["local|d"]);
});

test("meta: { since, text } — text 에 {ago} 꼭 하나·80자 안 · 같은 세션은 알릴 때만 글이 바뀐다 · 끝남 N번째부터 「끝」 글 그대로", () => {
  const d = { phase: "done", since: at(0), reminded: 0, lastRemindAt: null };
  const texts = [];
  for (const cfg of [CFG, { ...CFG, doneMax: 1 }, { ...CFG, doneMax: 99 }]) {
    for (let n = 1; n <= cfg.doneMax + 2 && n < 6; n++) texts.push(remindMeta(d, cfg, n).text);
  }
  for (const n of [1, 2, 99]) texts.push(remindMeta({ ...d, phase: "blocked" }, CFG, n).text);
  for (const t of texts) {
    assert.equal(t.split("{ago}").length - 1, 1, t);
    assert.ok(t.length >= 1 && t.length <= 80, t);
  }
  assert.equal(remindMeta(d, CFG, 1).text, "{ago} 기다려요 · 다시 알림 1/3");
  assert.equal(remindMeta(d, CFG, 2).text, "{ago} 기다려요 · 다시 알림 2/3");
  const last = remindMeta(d, CFG, 3).text;
  assert.equal(last, "{ago} 기다려요 · 다시 알림 끝(3/3) · 답할 때까지 둘게요");
  assert.equal(remindMeta({ ...d, reminded: 3 }, CFG, 3).text, last); // 조용히 남길 때·다시 보낼 때 — 같은 글(다시 뜬 걸로 안 보이게)
  assert.equal(remindMeta({ ...d, reminded: 3 }, CFG).text, last); // 넘쳐도 그대로
  assert.equal(remindMeta(d, CFG).since, at(0));
  assert.ok(Number.isFinite(remindMeta(d, CFG).since) && remindMeta(d, CFG).since > 0);
});

test("지난 시간 글(앱 규칙과 같음): 방금 · N분째 · N시간 M분째(0분 뺌) · N일째 · 예전 데몬용 글", () => {
  assert.deepEqual([0, 59e3, MIN, 12 * MIN + 30e3, 59 * MIN, 60 * MIN, 61 * MIN, 125 * MIN, 24 * 60 * MIN - 1, 24 * 60 * MIN, 50 * 60 * MIN, -5].map(agoText),
    ["방금", "방금", "1분째", "12분째", "59분째", "1시간째", "1시간 1분째", "2시간 5분째", "23시간 59분째", "1일째", "2일째", "방금"]);
  assert.equal(metaFallback({ since: at(0), text: "{ago} 기다려요 · 다시 알림 3/3" }, at(12)), "12분째 기다려요 · 다시 알림 3/3");
});

test("보내기: meta 를 받으면 그대로 · 예전 데몬(400 unknown field: meta)이면 meta 빼고 그때 지난 시간 글을 detail 로 · group 도 모르면 그것도 빼고 · 다른 실패는 그만", async () => {
  const body = { id: "herdr:_remind:local:d", text: "✅ x 끝난 뒤 답이 없어요", kind: "done", sticky: true, group: "herdr-remind", buttons: [], meta: { since: at(0), text: "{ago} 기다려요 · 다시 알림 2/3" } };
  const sent = [];
  const newer = async (b) => { sent.push(b); return { ok: true, status: 201 }; };
  assert.equal(await postWithFallback(newer, body, at(12)), true);
  assert.deepEqual(sent, [body]);
  // meta 만 모르는 데몬
  const old = [];
  const noMeta = async (b) => { old.push(b); return "meta" in b ? { ok: false, status: 400, error: '{"error":"unknown field: meta"}' } : { ok: true, status: 201 }; };
  assert.equal(await postWithFallback(noMeta, body, at(12)), true);
  assert.equal(old.length, 2);
  assert.equal("meta" in old[1], false);
  assert.equal(old[1].detail, "12분째 기다려요 · 다시 알림 2/3");
  assert.equal(old[1].group, "herdr-remind"); // 다른 건 그대로
  // group·meta 둘 다 모르는 더 옛 데몬(첫 모르는 필드만 말한다)
  const older = [];
  const oldest = async (b) => {
    older.push(b);
    const bad = ["group", "groupSummary", "meta"].find((k) => k in b);
    return bad ? { ok: false, status: 400, error: `{"error":"unknown field: ${bad}"}` } : { ok: true, status: 201 };
  };
  assert.equal(await postWithFallback(oldest, body, at(65)), true);
  assert.equal(older.length, 3);
  assert.deepEqual(Object.keys(older[2]).sort(), ["buttons", "detail", "id", "kind", "sticky", "text"]);
  assert.equal(older[2].detail, "1시간 5분째 기다려요 · 다시 알림 2/3");
  // 꺼짐·다른 400 은 다시 안 보낸다
  let n = 0;
  assert.equal(await postWithFallback(async () => { n++; return { ok: false, status: 0, error: "ECONNREFUSED" }; }, body), false);
  assert.equal(await postWithFallback(async () => { n++; return { ok: false, status: 400, error: '{"error":"text must be 1..500 chars"}' }; }, body), false);
  assert.equal(n, 2);
  // 데몬이 meta 모양을 거절해도(새 데몬의 검증) 같은 길
  const v = [];
  assert.equal(await postWithFallback(async (b) => { v.push(b); return b.meta ? { ok: false, status: 400, error: '{"error":"meta.text must contain {ago} exactly once"}' } : { ok: true }; }, body, at(3)), true);
  assert.equal(v[1].detail, "3분째 기다려요 · 다시 알림 2/3");
});

// 다리 한 틱(remindTick 과 같은 순서): 줄 집합·센 수·보낸 것을 본다
const tick = (tr, shown, m, cfg = CFG, opt = {}) => {
  const plan = digestPlan(tr, at(m), cfg, opt);
  const act = digestActions(plan, new Set(shown.keys()));
  const out = { act, alerted: [], added: [] };
  if (act.hide) { shown.clear(); return out; }
  for (const k of act.clear) shown.delete(k);
  if (act.alert.length) for (const s of act.add) s.expiredAt = null;
  for (const s of act.alert) { shown.set(s.key, s); markShown(tr, s, at(m)); out.alerted.push(s.key); }
  for (const s of act.add) { shown.set(s.key, s); out.added.push(s.key); }
  return out;
};

test("다리 틱: 끝남 다 알린 줄만 남았을 때 미룸·꺼짐이 끝나면 조용히 돌아온다(셈·알림 없음) · 떠 있는 줄은 안 보낸다 · 방해 금지엔 안 넣는다", () => {
  const tr = reminderState([ev(0, "status", { pane: "d", from: "working", to: "done" }), ev(0, "status", { pane: "e", from: "working", to: "done" })]);
  const shown = new Map();
  for (const m of [3, 6, 9]) assert.deepEqual(tick(tr, shown, m).alerted, ["local|d", "local|e"], `${m}분`);
  // 다 알림: 몇 시간 동안 아무것도 안 보낸다(떠 있는 줄은 손대지 않음)
  for (const m of [9.5, 12, 60, 600]) {
    const o = tick(tr, shown, m);
    assert.deepEqual([o.alerted, o.added, o.act.clear], [[], [], []], `${m}분`);
    assert.deepEqual([...shown.keys()].sort(), ["local|d", "local|e"]);
  }
  // 미룸(11분 → 71분): 그동안 걷힘 → 끝나면 다른 알림이 없어도 둘 다 다시(센 수 그대로)
  tr.snoozeUntil = at(71);
  assert.equal(tick(tr, shown, 11).act.hide, true);
  assert.equal(shown.size, 0);
  assert.equal(tick(tr, shown, 70).act.hide, true);
  const back = tick(tr, shown, 72);
  assert.deepEqual([back.alerted, back.added], [[], ["local|d", "local|e"]]);
  assert.deepEqual([tr.sessions.get("local|d").reminded, tr.sessions.get("local|e").reminded], [3, 3]);
  assert.deepEqual(tick(tr, shown, 73).added, []); // 한 번만
  // 다시 알림을 껐다 켬
  assert.equal(tick(tr, shown, 80, { ...CFG, on: false }).act.hide, true);
  assert.deepEqual(tick(tr, shown, 81).added, ["local|d", "local|e"]);
  // 방해 금지 동안 걷힌 줄은 안 넣고, 끝나면 넣는다
  shown.delete("local|d");
  assert.deepEqual(tick(tr, shown, 82, CFG, { quiet: true }).added, []);
  assert.deepEqual(tick(tr, shown, 83).added, ["local|d"]);
  // 제 말풍선이 떠 있는 동안은 빠졌다가, 닫히면(새 단계 아님) 다시 줄로
  const o = tick(tr, shown, 84, CFG, { liveIds: new Set(["ext:herdr:d"]) });
  assert.deepEqual(o.act.clear, ["local|d"]);
  assert.deepEqual(tick(tr, shown, 85, CFG, { liveIds: new Set() }).added, ["local|d"]);
  // ✕(닫기)는 돌아오지 않는다
  tr.sessions.get("local|d").hiddenAt = at(86);
  shown.delete("local|d");
  assert.deepEqual([tick(tr, shown, 87).added, tick(tr, shown, 200).added], [[], []]);
  assert.deepEqual([...shown.keys()], ["local|e"]);
});

test("다리 틱: 남의 때에 묻어 세지 않는다 — 세 세션이 따로 끝나도 끝남은 각자 3분 간격으로 3번 · 그 뒤 줄로 남음", () => {
  const tr = reminderState([0.5, 1, 2].map((m, i) => ev(m, "status", { pane: "abc"[i], from: "working", to: "done" })));
  const shown = new Map();
  const when = { "local|a": [], "local|b": [], "local|c": [] };
  for (let m = 0; m <= 30; m += 0.5) for (const k of tick(tr, shown, m).alerted) when[k].push(m);
  assert.deepEqual(when, { "local|a": [3.5, 6.5, 9.5], "local|b": [4, 7, 10], "local|c": [5, 8, 11] });
  assert.deepEqual([...shown.keys()].sort(), ["local|a", "local|b", "local|c"]);
  // 입력 대기는 그대로 — 끝없이 제 간격
  const b = reminderState([ev(0, "status", { pane: "x", from: "working", to: "blocked" })]);
  const bs = new Map(), bw = [];
  for (let m = 0; m <= 20; m += 0.5) if (tick(b, bs, m).alerted.length) bw.push(m);
  assert.deepEqual(bw, [3, 6, 9, 12, 15, 18]);
});

test("다리 틱: 앱이 넘쳐 버린 줄(expired)은 바로 다시 넣지 않고 다음 알림 때 다시 · ✕ 와 다르다", () => {
  const tr = reminderState([ev(0, "status", { pane: "d", from: "working", to: "done" }), ...[3, 6, 9].map((m) => ev(m, "remind", { action: "shown", pane: "d" }))]);
  const shown = new Map([["local|d", tr.sessions.get("local|d")]]);
  tr.sessions.get("local|d").expiredAt = at(10);
  shown.delete("local|d");
  assert.deepEqual(tick(tr, shown, 11).added, []); // 곧 또 버려지지 않게
  assert.ok(listed(tr.sessions.get("local|d"), CFG)); // 닫은 건 아니다
  applyEvent(tr, ev(12, "status", { pane: "e", from: "working", to: "done" }));
  const o = tick(tr, shown, 15); // e 가 알릴 때 같이
  assert.deepEqual([o.alerted, o.added], [["local|e"], ["local|d"]]);
  assert.equal(tr.sessions.get("local|d").expiredAt, null);
  assert.equal(tr.sessions.get("local|d").reminded, 3);
});

test("보내기: 데몬이 meta 를 모른다고 하면 10분 동안은 처음부터 빼고 한 번에 · 그 뒤 다시 물어본다 · 모양 거절은 기억 안 함", async () => {
  const body = { id: "herdr:_remind:local:d", text: "x", kind: "done", meta: { since: at(0), text: "{ago} 기다려요 · 다시 알림 끝(3/3) · 답할 때까지 둘게요" } };
  const seen = {};
  const sent = [];
  const old = async (b) => { sent.push(b); return "meta" in b ? { ok: false, status: 400, error: '{"error":"unknown field: meta"}' } : { ok: true }; };
  assert.equal(await postWithFallback(old, body, at(4), seen), true);
  assert.deepEqual([sent.length, seen.meta], [2, false]);
  assert.equal(await postWithFallback(old, body, at(9), seen), true);
  assert.equal(sent.length, 3); // 요청 한 번
  assert.equal(sent[2].detail, "9분째 기다려요 · 다시 알림 끝(3/3) · 답할 때까지 둘게요"); // 보낼 때마다 지금 지난 시간
  assert.equal(await postWithFallback(async (b) => { sent.push(b); return { ok: true }; }, body, at(4) + META_RETRY_MS, seen), true);
  assert.ok("meta" in sent.at(-1)); // 새 데몬으로 바뀌었나 다시 본다
  assert.equal(seen.meta, true);
  const v = {};
  await postWithFallback(async (b) => (b.meta ? { ok: false, status: 400, error: '{"error":"meta.text must contain {ago} exactly once"}' } : { ok: true }), body, at(3), v);
  assert.notEqual(v.meta, false);
});
