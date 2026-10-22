ZDOTDIR=$QUAZAR_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zlogin ]] && source $ZDOTDIR/.zlogin
# Shells started from here on (subshells, nested terminals) use the user's normal config.
unset QUAZAR_SHIM_DIR
