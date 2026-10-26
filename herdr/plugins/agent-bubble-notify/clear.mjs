// pane.focused → 그 pane 의 말풍선 걷기(직접 보러 갔으니)
import { loadDotEnv, modeEnabled, readJsonEnv, bus, bubbleId, logEvent } from "./lib.mjs";

loadDotEnv();
const event = readJsonEnv("HERDR_PLUGIN_EVENT_JSON");
const pane = event?.data?.pane_id ?? event?.pane_id;
if (pane) logEvent("focus", { pane }); // 리포트 재료: 그 pane 을 봤다(꺼 둔 동안에도)
if (!modeEnabled()) process.exit(0);
if (pane) await bus(`/bubbles/${encodeURIComponent(bubbleId(pane))}/clear`);
