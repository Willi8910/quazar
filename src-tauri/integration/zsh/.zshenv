# Quazar shell integration: load the user's own startup file, then keep pointing at the shim.
QUAZAR_SHIM_DIR=$ZDOTDIR
ZDOTDIR=${QUAZAR_USER_ZDOTDIR:-$HOME}
[[ -f $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
QUAZAR_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$QUAZAR_SHIM_DIR
