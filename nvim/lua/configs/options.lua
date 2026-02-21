vim.g.mapleader = ' '
vim.g.maplocalleader = ' '
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

vim.o.mouse = 'a'
vim.o.tabstop = 2
vim.o.shiftwidth = 2
vim.o.signcolumn = 'yes'
vim.o.wrap = false
vim.o.cursorcolumn = false
vim.o.ignorecase = true
vim.o.smartindent = true
vim.o.termguicolors = true
vim.o.undofile = true
vim.o.number = true
vim.o.relativenumber = true
vim.o.winborder = 'rounded'
vim.o.splitright = true
vim.o.splitbelow = true

vim.cmd [[set noswapfile]]
vim.cmd ':hi satusline guibg=NONE'

vim.schedule(function()
  vim.opt.clipboard = 'unnamedplus'
end)
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('highlight-when-yank', { clear = true }),
  callback = function()
    vim.highlight.on_yank()
  end,
})
vim.api.nvim_create_autocmd('DirChanged', {
	pattern = '*',
	callback = function()
		print('Current directory changed to: ' .. vim.fn.getcwd())
	end,
})
vim.api.nvim_create_autocmd("FileType", {
  pattern = "qf",
  callback = function()
    vim.keymap.set("n", "<CR>", "<CR><cmd>cclose<CR>", { buffer = true, silent = true })
  end,
})
