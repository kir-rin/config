# brew
export PATH="$PATH:/opt/homebrew/bin"

# nvim with version manager named bob
export PATH="$PATH:$HOME/.local/share/bob/nvim-bin"

# nvm
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"  # This loads nvm

# pnpm
export PNPM_HOME="$HOME/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PATH:$PNPM_HOME" ;;
esac

# asdf
export PATH="$PATH:$HOME/.asdf/shims"

# java
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$PATH:$JAVA_HOME/bin"

# go
export GOROOT=/usr/local/go
export GOPATH=$HOME/go
export PATH="$PATH:$HOME/go/bin"

# Opencode 
ln -shf $HOME/config/opencode/plugin $HOME/.config/opencode/plugin
ln -shf $HOME/config/opencode/opencode.json $HOME/.config/opencode/opencode.json

# Cursor agent
export PATH="$HOME/.local/bin:$PATH"
