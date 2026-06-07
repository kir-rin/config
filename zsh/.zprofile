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

# Infisical: inject secrets from cloud with local cache (TTL 24h)
_INFISICAL_CACHE="$HOME/.cache/infisical-secrets.sh"
_INFISICAL_TTL=86400

if [ -f "$_INFISICAL_CACHE" ] && [ $(( $(date +%s) - $(stat -f %m "$_INFISICAL_CACHE" 2>/dev/null || echo 0) )) -lt $_INFISICAL_TTL ]; then
  source "$_INFISICAL_CACHE"
else
  _result="$(infisical export --format=dotenv-export --env=prod --projectId=89a3b232-0a29-4b0f-869f-0c6d06d9d00d 2>/dev/null)"
  if [ -n "$_result" ]; then
    eval "$_result"
    mkdir -p "$HOME/.cache"
    echo "$_result" > "$_INFISICAL_CACHE"
  elif [ -f "$_INFISICAL_CACHE" ]; then
    source "$_INFISICAL_CACHE"
  fi
fi
