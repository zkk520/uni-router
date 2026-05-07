$Script = Join-Path $PSScriptRoot "scripts\dev.ps1"
& $Script @args
exit $LASTEXITCODE
