# Quazar's PowerShell integration (Windows), run after the user's profile: tells Quazar each command
# (preexec) and the current folder at each prompt (precmd), and types a restored tab's resume command
# onto the first prompt without running it. Events go to Quazar's named pipe, one JSON line each.

if ($env:QUAZAR_TAB_ID -and $env:QUAZAR_SOCK) {
  $global:__quazarPipe = $env:QUAZAR_SOCK -replace '^\\\\\.\\pipe\\', ''

  function global:__QuazarSend([hashtable]$Event) {
    $Event.tab = $env:QUAZAR_TAB_ID
    try {
      $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $global:__quazarPipe, [System.IO.Pipes.PipeDirection]::Out)
      $pipe.Connect(500)
      $writer = [System.IO.StreamWriter]::new($pipe)
      $writer.WriteLine((ConvertTo-Json $Event -Compress))
      $writer.Flush()
      $pipe.Dispose()
    } catch {}
  }

  # precmd: wrap the prompt (the user's own, e.g. oh-my-posh, keeps working).
  $global:__quazarPrompt = $function:prompt
  function global:prompt {
    __QuazarSend @{ kind = 'precmd'; cwd = $PWD.ProviderPath }
    & $global:__quazarPrompt
  }

  # preexec: PSReadLine hands every accepted command line to this handler before running it.
  if (Get-Module PSReadLine) {
    $previous = (Get-PSReadLineOption).AddToHistoryHandler
    Set-PSReadLineOption -AddToHistoryHandler {
      param([string]$line)
      __QuazarSend @{ kind = 'preexec'; cmd = $line; cwd = $PWD.ProviderPath }
      if ($previous) { & $previous $line } else { $true }
    }.GetNewClosure()
  }

  # Restored tab: put the resume command on the prompt once PSReadLine is waiting for input.
  if ($env:QUAZAR_PREFILL) {
    $global:__quazarPrefill = $env:QUAZAR_PREFILL
    $null = Register-EngineEvent -SourceIdentifier PowerShell.OnIdle -MaxTriggerCount 1 -Action {
      [Microsoft.PowerShell.PSConsoleReadLine]::Insert($global:__quazarPrefill)
    }
  }
}
Remove-Item Env:QUAZAR_PREFILL -ErrorAction SilentlyContinue
