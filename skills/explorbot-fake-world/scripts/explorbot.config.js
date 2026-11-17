// Explorbot 설정 — LLM 게이트웨이(Anthropic /v1/messages 호환)로 부른다. 키는 환경변수에서만 읽는다(파일·로그에 싣지 않는다).
// run.sh 가 ANTHROPIC_API_KEY·ANTHROPIC_BASE_URL·EXPLORBOT_ANTHROPIC_SDK·FAKE_URL 을 채운다.
const {createAnthropic}=await import(process.env.EXPLORBOT_ANTHROPIC_SDK);
const gw=createAnthropic({baseURL:process.env.ANTHROPIC_BASE_URL,apiKey:process.env.ANTHROPIC_API_KEY});
const M=process.env.EXPLORBOT_MODEL||'claude-sonnet-5-5';
export default {
  web:{url:process.env.FAKE_URL||'http://127.0.0.1:8899'},   // 가짜 세계만. 실제 Artifact·서비스 주소 금지
  playwright:{browser:'chromium',show:false},
  // haiku 는 게이트웨이에서 ThrottlingException(429)이 잦아 연결 확인이 실패했다 — 세 칸 모두 sonnet
  ai:{model:gw(M),visionModel:gw(M),agenticModel:gw(M)},
};
