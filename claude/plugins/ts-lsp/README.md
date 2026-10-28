# ts-lsp

Gives Claude Code's `LSP` tool (goToDefinition, findReferences, hover, documentSymbol,
workspaceSymbol, incomingCalls/outgoingCalls) a TypeScript language server.

It runs the TypeScript 7 native compiler's built-in language server from the project itself:
`${CLAUDE_PROJECT_DIR}/node_modules/.bin/tsc --lsp --stdio`. Nothing is installed into this
plugin folder, so there is no `node_modules` here. The project must have `typescript@7`
installed (`npm install`). Projects on TypeScript 5.x will fail to start the server
(their `tsc` has no `--lsp` flag); use `typescript-language-server` for those.

## Install (once per machine)

```bash
claude plugin marketplace add ~/config/claude/plugins     # marketplace "kir-local", loaded in place
cd <project> && claude plugin install ts-lsp@kir-local --scope local
```

`defaultEnabled` is false, so the plugin only runs in projects whose
`.claude/settings.local.json` has `"ts-lsp@kir-local": true`.
Subagents need `LSP` in their `tools:` list to use it.
