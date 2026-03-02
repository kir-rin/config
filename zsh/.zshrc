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
alias cs='
  colima delete -f &&
  colima start --dns 8.8.8.8 &&
  sudo ln -sf $HOME/.colima/default/docker.sock /var/run/docker.sock
' # docker for MacOS

# search history via Ctrl+R
source <(fzf --zsh)
