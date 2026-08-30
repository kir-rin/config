# zsh
## This options works like APPEND_HISTORY except that new history lines are added to the $HISTFILE incrementally (as soon as they are entered), rather than waiting until the shell exits.
setopt INC_APPEND_HISTORY
setopt autocd

# colortheme
eval "$(starship init zsh)"

# zoxide
eval "$(zoxide init zsh)"

# alias
alias v='nvim .'
alias nv='nvim'
alias oc='opencode'
alias herdrp='herdr --remote yunhui-macbookpro --remote-keybindings server'

# claude / codex danger-mode shortcuts
alias ycl='claude --dangerously-skip-permissions'
alias yclr='claude --dangerously-skip-permissions --resume'
alias yco='codex --dangerously-bypass-approvals-and-sandbox'
alias ycor='codex --dangerously-bypass-approvals-and-sandbox resume'

# function: colima start with fzf architecture selector
cs() {
  local arch=$(echo -e "arm64\namd64" | fzf --prompt="Select architecture: " --height=3)
  [[ -z "$arch" ]] && return 1
  colima delete -f && \
  colima start --arch "$arch" --vm-type vz --dns 8.8.8.8 && \
  sudo ln -sf "$HOME/.colima/default/docker.sock" /var/run/docker.sock
}

## eza
alias __eza_base='eza --all --show-symlinks --header --long --grid --icons --hyperlink --no-user --no-filesize --color=always --color-scale --color-scale-mode=gradient --time-style=relative'
alias ll='__eza_base'
alias lt='__eza_base --tree --level=2'

# search history via Ctrl+R
source <(fzf --zsh)

