// 다시 알림(remind.mjs): 설정 우선순위·AgentBot 설정 읽기(예전 데몬 404) · 세션 단계 따라가기 · 때(간격·되풀이·끝남 최대 번) · 미룸·그만·방해 금지 · 다시 돎·답 · 떠 있는 말풍선과 안 겹침
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  remindConfig, fetchRemindPref, prefCache, newTracker, applyEvent, applyEvents, applyLive, reminderState, stepStatus, markShown,
  firstDue, nextDue, digestPlan, stillShown, ownVisible, ownBubbleId, remindDetail, remindItemId, SUMMARY_ID, DEFAULT_EVERY_MIN, DEFAULT_DONE_MAX,
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

test("묶음: 때가 된 게 있으면 처음 때가 지난 것 전부(대기 먼저) · 미룸·방해 금지·꺼짐·그만이면 없음 · 다시 돎·답한 건 빠짐 · 끝남 3번 뒤 빠짐", () => {
  const base = [
    ev(0, "status", { pane: "d", from: "working", to: "done" }),
    ev(1, "status", { pane: "b", from: "working", to: "blocked" }),
  ];
  const tr = reminderState(base);
  assert.equal(digestPlan(tr, at(2.9), CFG).round, null);
  assert.deepEqual(digestPlan(tr, at(3), CFG).round.map((s) => s.key), ["local|d"]); // 대기는 아직(1+3)
  assert.deepEqual(digestPlan(tr, at(4), CFG).round.map((s) => s.key), ["local|b", "local|d"]); // 대기 먼저
  assert.equal(digestPlan(tr, at(4), CFG, { quiet: true }).round, null);
  assert.equal(digestPlan(tr, at(4), { ...CFG, on: false }).round, null);
  // 알림 → 다음 간격까지 없음 → 간격 뒤 둘 다
  for (const s of digestPlan(tr, at(4), CFG).round) markShown(tr, s, at(4));
  assert.equal(digestPlan(tr, at(6.9), CFG).round, null);
  assert.deepEqual(digestPlan(tr, at(7), CFG).round.map((s) => s.key), ["local|b", "local|d"]);
  // 기록(같은 ts)을 다시 읽어도 한 번만 센다
  applyEvent(tr, ev(4, "remind", { action: "shown", pane: "d" }));
  assert.equal(tr.sessions.get("local|d").reminded, 1);
  // 미룸(머리 [N분 뒤에])
  const sn = reminderState([...base, ev(4, "remind", { action: "shown", pane: "d" }), ev(4, "remind", { action: "shown", pane: "b" }), ev(5, "remind", { action: "snooze", until: at(65) })]);
  assert.equal(digestPlan(sn, at(64), CFG).round, null);
  assert.ok(digestPlan(sn, at(65), CFG).round.length);
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
  assert.ok(digestPlan(seen, at(4), CFG).round.some((s) => s.key === "local|d"));
  // 끝남 3번 뒤: 대기만
  const three = reminderState([...base, ...[4, 7, 10].flatMap((m) => [ev(m, "remind", { action: "shown", pane: "d" }), ev(m, "remind", { action: "shown", pane: "b" })])]);
  assert.deepEqual(digestPlan(three, at(13), CFG).round.map((s) => s.key), ["local|b"]);
  assert.ok(digestPlan(three, at(13), CFG).alive.has("local|d")); // 줄은 아직 답 안 한 것으로 남는다
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
  assert.deepEqual(digestPlan(tr, at(5), CFG).round.map((s) => s.key), ["local|n"]); // 기록으로 어림
  assert.deepEqual(digestPlan(tr, at(5), CFG, { liveIds: new Set(["ext:herdr:p"]) }).round.map((s) => s.key), ["회사|q", "local|n"]); // 데몬이 아는 대로
  assert.equal(ownVisible(tr.sessions.get("local|p"), at(121), null), false); // 수명이 다 됨
  // 닫으면 닫은 때부터 간격
  const closed = reminderState([...evs, ev(4, "closed", { pane: "p", id: "ext:herdr:p", reason: "dismissed" })]);
  assert.equal(digestPlan(closed, at(6.9), CFG).round.some((s) => s.key === "local|p"), false);
  assert.ok(digestPlan(closed, at(7), CFG).round.some((s) => s.key === "local|p"));
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
  assert.match(remindDetail(s, CFG), /^\d\d:\d\d 부터 기다려요 · 다시 알림 2\/3$/);
  assert.match(remindDetail(tr.sessions.get("local|a"), CFG), /확인을 기다려요 · 2번째/);
  assert.equal(remindItemId("local", "w4:p3"), "herdr:_remind:local:w4:p3");
  assert.equal(SUMMARY_ID, "herdr:_remind");
  const x = { phase: null, raw: undefined, at: -Infinity };
  stepStatus(x, "idle", at(0));
  assert.equal(x.phase, null);
});
