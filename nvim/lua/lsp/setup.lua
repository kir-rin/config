vim.lsp.enable({'lua_ls', 'gopls', 'ts_ls', 'eslint', 'tailwindcss', 'pyright'})

vim.api.nvim_create_autocmd('LspAttach', {
	group = vim.api.nvim_create_augroup('auto_completion', {}),
	callback = function(args)
		local client = assert(vim.lsp.get_client_by_id(args.data.client_id))
		if client:supports_method 'textDocument/completion' then
			local chars = {}
			for i = 32, 126 do
				table.insert(chars, string.char(i))
			end
			client.server_capabilities.completionProvider.triggerCharacters = chars
			vim.lsp.completion.enable(true, client.id, args.buf, { autotrigger = true})
		end
	end,
})
vim.cmd [[set completeopt+=menuone,noselect,popup]]
