// pane.focused → 그 pane 의 말풍선 걷기(직접 보러 갔으니)
import { loadDotEnv, modeEnabled, readJsonEnv, bus, bubbleId } from "./lib.mjs";

loadDotEnv();
if (!modeEnabled()) process.exit(0);
const event = readJsonEnv("HERDR_PLUGIN_EVENT_JSON");
const pane = event?.data?.pane_id ?? event?.pane_id;
if (pane) await bus(`/bubbles/${encodeURIComponent(bubbleId(pane))}/clear`);
