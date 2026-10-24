// 켜기/끄기: node toggle.mjs [on|off]
import { loadDotEnv, modeEnabled, setMode } from "./lib.mjs";

loadDotEnv();
const arg = process.argv[2];
const next = arg === "on" ? true : arg === "off" ? false : !modeEnabled();
setMode(next);
console.log(`agent bubble notify ${next ? "on" : "off"}`);
