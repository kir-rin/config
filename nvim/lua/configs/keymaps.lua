local L = function(key)
	return '<leader>' .. key
end
local C = function(cmd)
	return '<Cmd>' .. cmd .. '<CR>'
end
local map = function(mode, lhs, rhs, desc, opts)
	opts = opts or {}
	opts.desc = desc
	vim.keymap.set(mode, lhs, rhs, opts)
end
local function get_current_buffer_git_root()
	local file = vim.api.nvim_buf_get_name(0)
	if file == "" then
		return nil
	end

	local dir = vim.fn.fnamemodify(file, ":h")
	local cmd = "git -C " .. vim.fn.shellescape(dir) .. " rev-parse --show-toplevel 2>/dev/null"
	local result = vim.fn.systemlist(cmd)
	if vim.v.shell_error == 0 and result and #result > 0 then
		return result[1]
	end
	return nil
end

map('n', L 'w', C 'write', 'Write buffer')
map('n', L 'q', C 'quit', 'Quit buffer')
map('n', L 'e', C 'Oil', 'Open file explorer')

-- navigation
map('n', '<C-k>', '<C-u>zz', 'Scroll up and center')
map('n', '<C-j>', '<C-d>zz', 'Scroll down and center')

-- config files
map({ 'n', 'v', 'x' }, L 'v', C 'e $MYVIMRC', 'Edit nvim config')
map({ 'n', 'v', 'x' }, L 'z', C 'e ~/.zshrc', 'Edit zshrc')
-- Temporarily commented out for w keymap performance
-- map({ 'n', 'v', 'x' }, L 'wz', C 'e ~/.config/wezterm/wezterm.lua', 'Edit wezterm config')
map({ 'n', 'v', 'x' }, L 'o', C 'source $MYVIMRC', 'Source ' .. vim.fn.expand '$MYVIMRC')
map({ 'n', 'v', 'x' }, L 'O', C 'restart', 'Restart vim.')

-- lsp
map('n', L 'lf', C 'lua vim.lsp.buf.format()', 'Format buffer')
map('n', L 'cr', C 'lua vim.lsp.buf.rename()', 'Rename symbol')
map('n', L 'ca', C 'lua vim.lsp.buf.code_action()', 'Code action')
map('n', 'gd', C 'lua vim.lsp.buf.definition()', 'Go to definition')
map('n', 'K', C 'lua vim.lsp.buf.hover()', 'Show type and docs of the symbol')
map('n', 'gr', C 'lua vim.lsp.buf.references()', 'Find references')
map('n', L 'cq', C 'cclose', 'Close Quickfix')
map('n', 'gl', C 'lua vim.diagnostic.open_float()', 'Show diagnostics')
map('n', 'dn', C 'lua vim.diagnostic.jump({ count = 1, float = true })', 'Next diagnostic')
map('n', 'dp', C 'lua vim.diagnostic.jump({ count = -1, float = true })', 'Previous diagnostic')

-- control panes
map('n', 'ss', C 'split', 'Split horizontal', { noremap = true, silent = true })
map('n', 'sv', C 'vsplit', 'Split vertical', { noremap = true, silent = true })
map('n', 'sk', '<C-w>k', 'Focus pane above')
map('n', 'sh', '<C-w>h', 'Focus pane left')
map('n', 'sj', '<C-w>j', 'Focus pane below')
map('n', 'sl', '<C-w>l', 'Focus pane right')
map('n', 'sq', '<C-w>q', 'Close pane')
map('n', '<C-w><left>', '<C-w><', 'Decrease pane width')
map('n', '<C-w><right>', '<C-w>>', 'Increase pane width')
map('n', '<C-w><up>', '<C-w>+', 'Increase pane height')
map('n', '<C-w><down>', '<C-w>-', 'Decrease pane height')

-- terminal
local T = function(mode)
	if mode == 'vertical' then
		return function()
			vim.cmd 'vert split | term'
		end
	elseif mode == 'horizontal' then
		return function()
			vim.cmd 'hor split | term'
		end
	else
		return function()
			vim.cmd('vert split | term ' .. mode)
		end
	end
end
map('n', L 'tv', T 'vertical', 'Open terminal vertically')
map('n', L 'th', T 'horizontal', 'Open terminal horizontally')
map(
	'n',
	L 'ta',
	function()
		if vim.bo.filetype == "oil" then
			local dir = require('oil').get_current_dir()
			vim.cmd("cd " .. dir)
			vim.notify("Moved to current dir: " .. dir)
			return dir
		end

		local root = get_current_buffer_git_root()
		if root then
			vim.cmd("cd " .. root)
			vim.notify("Moved to Git root: " .. root)
			return root
		end

		local current_dir = vim.fn.expand('%:p:h')
		if current_dir ~= "" then
			vim.cmd("cd " .. current_dir)
			vim.notify("Moved to current dir: " .. current_dir)
		end
	end,
	'Change working directory'
)
map('t', 'tq', '<C-\\><C-n>', 'Change to normal mode in terminal')

-- plugin:lazygit
map('n', L 'lg', C 'LazyGit', 'Open LazyGit', { silent = true })

-- plugin:fzf-lua
map('n', L '<space>', C 'FzfLua buffers', 'Find buffers')
map(
	'n',
	L 'f',
	function()
		local root = get_current_buffer_git_root()
		if root and root ~= '' then
			require('fzf-lua').files({ cwd = root })
		else
			require('fzf-lua').files()
		end
	end,
	'Find files (git root or cwd)'
)
map('n', L 'r', C 'FzfLua oldfiles', 'Find recent files')
map('n', L 'b', C 'FzfLua builtin', 'Show FzfLua bultin')

-- plugin:opencode
map({ 'n', 't' }, '<C-,>', C "lua require('opencode').toggle()", 'Toggle opencode')
map({ 'n', 't', 'v' }, '<C-g>', C "lua require('opencode').ask('@this: ', { submit = true })", 'Ask opencode')

-- plugin:zenmode
map('n', '<C-t>', C "lua require('zen-mode').toggle()", 'Toggle zenmode')
