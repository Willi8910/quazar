ZDOTDIR=$QUAZAR_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
QUAZAR_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$QUAZAR_SHIM_DIR

if [[ -n $QUAZAR_TAB_ID && -S $QUAZAR_SOCK ]]; then
  autoload -Uz add-zsh-hook

  _quazar_json() {
    local s=$1
    s=${s//\\/\\\\}; s=${s//\"/\\\"}
    s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}
    print -rn -- "\"$s\""
  }
  _quazar_send() { print -r -- "$1" | nc -U -w 1 "$QUAZAR_SOCK" >/dev/null 2>&1 &! }
  _quazar_preexec() {
    _quazar_send "{\"tab\":\"$QUAZAR_TAB_ID\",\"kind\":\"preexec\",\"cmd\":$(_quazar_json "$1"),\"cwd\":$(_quazar_json "$PWD")}"
  }
  _quazar_precmd() {
    _quazar_send "{\"tab\":\"$QUAZAR_TAB_ID\",\"kind\":\"precmd\",\"cwd\":$(_quazar_json "$PWD")}"
  }
  add-zsh-hook preexec _quazar_preexec
  add-zsh-hook precmd _quazar_precmd

  # Restored tab: put the resume command on the prompt without running it.
  if [[ -n $QUAZAR_PREFILL ]]; then
    print -z -- "$QUAZAR_PREFILL"
  fi
fi
unset QUAZAR_PREFILL

if [[ ! -o login ]]; then
  ZDOTDIR=$QUAZAR_USER_ZDOTDIR
fi
