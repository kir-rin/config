vim.pack.add({
	{ name = 'mini.starter',  src = 'https://github.com/nvim-mini/mini.starter'},

	{ name = 'smear-cursor',  src = 'https://github.com/sphamba/smear-cursor.nvim'},

	{ name = 'gitsigns',      src = 'https://github.com/lewis6991/gitsigns.nvim'},

	{ name = 'plenary',       src = 'https://github.com/nvim-lua/plenary.nvim' }, 
	{ name = 'lazygit.nvim',  src = 'https://github.com/kdheepak/lazygit.nvim' }, -- lazy loading for lazygit

	{ name = 'oil',           src = 'https://github.com/stevearc/oil.nvim' },

	{ name = 'rose-pine',     src = 'https://github.com/rose-pine/neovim' },

	-- Mason helps with installing and managing them.
	{ name = 'mason',         src = 'https://github.com/mason-org/mason.nvim' },
	
	-- lspconfig automatically fills in options and provides helpful guidance. 
	{ name = 'lspconfig',     src = 'https://github.com/neovim/nvim-lspconfig' },

	{ name = 'fzf',						src = 'https://github.com/junegunn/fzf' },
	{ name = 'fzf-lua',				src = 'https://github.com/ibhagwan/fzf-lua'},
  
	{ name = 'snack', src = 'https://github.com/folke/snacks.nvim' },
	{ name = 'opencode', src = 'https://github.com/NickvanDyke/opencode.nvim' },

	{ name = 'winsep', src = 'https://github.com/nvim-zh/colorful-winsep.nvim' },

	{ name = 'zenmode', src = 'https://github.com/folke/zen-mode.nvim' },

	{ name = 'flutter-tools', src = 'https://github.com/nvim-flutter/flutter-tools.nvim' },

	-- debug
	{ name = 'nvim-dap', src = 'https://github.com/mfussenegger/nvim-dap' },
	{ name = 'nvim-dap-ui', src = 'https://github.com/rcarriga/nvim-dap-ui' },
	{ name = 'nvim-nio', src = 'https://github.com/nvim-neotest/nvim-nio' },
	{ name = 'nvim-dap-virtual-text', src = 'https://github.com/thehamsta/nvim-dap-virtual-text' },
	{ name = 'one-small-step-for-vimkind', src = 'https://github.com/jbyuki/one-small-step-for-vimkind' },
})
local starter = require('mini.starter')
starter.setup({
	header = '🦒',
	items = {
		starter.sections.recent_files(3, false, false),  -- 최근 파일 3개 (경로 표시 없음)
		-- nvim을 실행한 현재 경로(cwd) 탐색 — 별도 섹션, 항목명에 실제 경로 표시
		function()
			local cwd = vim.fn.fnamemodify(vim.fn.getcwd(), ':~')
			return {
				{
					name    = 'Browse ' .. cwd,
					action  = function()
						require('fzf-lua').files({ cwd = vim.fn.getcwd() })
					end,
					section = 'Current directory',
				},
			}
		end,
	},
})
require('smear_cursor').setup({})
require('gitsigns').setup({})
require('rose-pine').setup({})
require('mason').setup({})
require('oil').setup {
	lsp_file_methods = {
		enabled = true,
		timeout_ms = 1000,
		autosave_changes = true,
	},
	view_options = {
		show_hidden = true,
	},
	columns = {
		'permissions',
		'icon',
	},
	float = {
		max_width = 0.7,
		max_height = 0.6,
		border = 'rounded',
	},
}
vim.cmd('colorscheme rose-pine')
require('fzf-lua').setup({})
-- opencode
vim.g.opencode_opts = {
  provider = {
    enabled = "snacks",
		snacks = {
			win = {
				position = 'left',
				width = 0.4,
			},
		},
		cmd = "opencode --port",
  },
	events = {
    enabled = true,
    reload = true,
    permissions = {
      enabled = false,
      idle_delay_ms = 1000,
    },
  },
}
require('snacks').setup {
      input = { enabled = true },
}
require('colorful-winsep').setup {
	-- https://github.com/nvim-zh/colorful-winsep.nvim
	border = 'rounded',
	excluded_ft = { 'mason' },
	animate = {
		-- NOTE: progressive option doesn't work well, check below
		-- https://github.com/nvim-zh/colorful-winsep.nvim/issues/107
		enabled = 'shift',
	},
}
vim.api.nvim_set_hl(0, 'ColorfulWinSep', { fg = '#00FF00', bg = 'black' })
require("flutter-tools").setup {
	flutter_path = "/opt/homebrew/bin/flutter",
	debugger = {
		enabled = true,
	},
}
local dap = require "dap"
local ui = require "dapui"
ui.setup({})
dap.configurations.lua = { 
  { 
    type = 'nlua', 
    request = 'attach',
    name = "Attach to running Neovim instance",
  }
}


dap.adapters.nlua = function(callback, config)
  callback({ type = 'server', host = config.host or "127.0.0.1", port = config.port or 8086 })
end
dap.listeners.before.attach.dapui_config = function()
	ui.open()
end
dap.listeners.before.launch.dapui_config = function()
	ui.open()
end
dap.listeners.before.event_terminated.dapui_config = function()
	ui.close()
end
dap.listeners.before.event_exited.dapui_config = function()
	ui.close()
end
