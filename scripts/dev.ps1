[CmdletBinding()]
param(
    [ValidateSet("All", "Backend", "Frontend")]
    [string]$Start = "All",
    [string]$BackendUrl = "",
    [int]$FrontendPort = 0,
    [switch]$Install,
    [switch]$Check,
    [switch]$Status,
    [ValidateSet("None", "Backend", "Frontend", "All")]
    [string]$Stop = "None"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$WebRoot = Join-Path $RepoRoot "web"
$ConfigPath = Join-Path $RepoRoot "data\config.json"

function Get-ConfigValue {
    param(
        [string]$Path,
        [object]$Default
    )

    if (-not (Test-Path $ConfigPath)) {
        return $Default
    }

    try {
        $Config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
        $Current = $Config
        foreach ($Part in $Path.Split(".")) {
            if ($null -eq $Current -or -not ($Current.PSObject.Properties.Name -contains $Part)) {
                return $Default
            }
            $Current = $Current.$Part
        }
        if ($null -eq $Current) {
            return $Default
        }
        return $Current
    }
    catch {
        return $Default
    }
}

if ([string]::IsNullOrWhiteSpace($BackendUrl)) {
    $SavedBackendPort = [int](Get-ConfigValue -Path "server.port" -Default 8080)
    $BackendUrl = "http://127.0.0.1:$SavedBackendPort"
}

if ($FrontendPort -le 0) {
    $FrontendPort = [int](Get-ConfigValue -Path "dev.frontend_port" -Default 3000)
}

$FrontendUrl = "http://127.0.0.1:$FrontendPort"
$BackendUri = [uri]$BackendUrl
$BackendPort = $BackendUri.Port

function Write-Step {
    param([string]$Message)
    Write-Host "[dev] $Message" -ForegroundColor Cyan
}

function Resolve-RequiredCommand {
    param([string]$Name)

    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $Command) {
        throw "Required command '$Name' was not found in PATH."
    }

    return $Command.Source
}

function Test-PortInUse {
    param([int]$Port)

    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        return $false
    }

    return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-PortListeners {
    param(
        [string]$Service,
        [int]$Port
    )

    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        return @()
    }

    $Connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $Connections) {
        return @()
    }

    $Connections |
        Sort-Object OwningProcess -Unique |
        ForEach-Object {
            $Process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            [pscustomobject]@{
                Service = $Service
                Port = $Port
                PID = $_.OwningProcess
                ProcessName = if ($Process) { $Process.ProcessName } else { "<exited>" }
                Path = if ($Process) { $Process.Path } else { "" }
            }
        }
}

function Get-DevListeners {
    @(
        Get-PortListeners -Service "Backend" -Port $BackendPort
        Get-PortListeners -Service "Frontend" -Port $FrontendPort
    )
}

function Stop-PortListeners {
    param(
        [string]$Service,
        [int]$Port
    )

    $Listeners = @(Get-PortListeners -Service $Service -Port $Port)
    if ($Listeners.Count -eq 0) {
        Write-Step "$Service is not listening on port $Port."
        return
    }

    foreach ($Listener in $Listeners) {
        Write-Step "Stopping $($Listener.Service) on port $($Listener.Port): PID $($Listener.PID) $($Listener.ProcessName)"
        Stop-Process -Id $Listener.PID -Force -ErrorAction Stop
    }
}

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$FileName,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [hashtable]$Environment
    )

    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $FileName
    $StartInfo.Arguments = $Arguments
    $StartInfo.WorkingDirectory = $WorkingDirectory
    $StartInfo.UseShellExecute = $false
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $StartInfo.CreateNoWindow = $true

    foreach ($Key in $Environment.Keys) {
        $StartInfo.Environment[$Key] = [string]$Environment[$Key]
    }

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo
    $Process.EnableRaisingEvents = $true

    [void]$Process.Start()

    $OutputSubscription = Register-ObjectEvent -InputObject $Process -EventName OutputDataReceived -MessageData $Name -Action {
        if ($EventArgs.Data) {
            Write-Host ("[{0}] {1}" -f $Event.MessageData, $EventArgs.Data)
        }
    }

    $ErrorSubscription = Register-ObjectEvent -InputObject $Process -EventName ErrorDataReceived -MessageData $Name -Action {
        if ($EventArgs.Data) {
            Write-Host ("[{0}] {1}" -f $Event.MessageData, $EventArgs.Data) -ForegroundColor DarkYellow
        }
    }

    $script:EventSubscriptions.Add($OutputSubscription) | Out-Null
    $script:EventSubscriptions.Add($ErrorSubscription) | Out-Null

    $Process.BeginOutputReadLine()
    $Process.BeginErrorReadLine()

    return $Process
}

function Ensure-FrontendDependencies {
    if (Test-Path (Join-Path $WebRoot "node_modules")) {
        return
    }

    if ($Install) {
        Write-Step "Installing frontend dependencies with pnpm install..."
        Push-Location $WebRoot
        try {
            & $Pnpm install
        }
        finally {
            Pop-Location
        }
        return
    }

    throw "Missing web/node_modules. Run 'pnpm install' in web, or start with '.\dev-web.cmd -Install'."
}

function Start-BackendForeground {
    if (Test-PortInUse $BackendPort) {
        throw "Backend port $BackendPort is already in use. Stop the existing process or set -BackendUrl."
    }

    $env:OCTOPUS_DEBUG = "true"
    $env:OCTOPUS_SERVER_PORT = [string]$BackendPort
    if ($Start -eq "All") {
        $env:OCTOPUS_MANAGE_FRONTEND = "true"
    }
    Set-Location $RepoRoot
    Write-Step "Starting backend at $BackendUrl"
    & $Go run main.go start
    exit $LASTEXITCODE
}

function Start-FrontendForeground {
    Ensure-FrontendDependencies

    if (Test-PortInUse $FrontendPort) {
        throw "Frontend port $FrontendPort is already in use. Stop the existing process or set -FrontendPort."
    }

    $env:NEXT_PUBLIC_API_BASE_URL = $BackendUrl
    Set-Location $WebRoot
    Write-Step "Starting frontend at $FrontendUrl with API $BackendUrl"
    & cmd.exe /d /s /c "pnpm exec next dev -p $FrontendPort"
    exit $LASTEXITCODE
}

Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot "go.mod"))) {
    throw "This script must run from inside the Octopus repository."
}

if (-not (Test-Path (Join-Path $WebRoot "package.json"))) {
    throw "Frontend package.json was not found at '$WebRoot'."
}

if ($Status) {
    $Listeners = @(Get-DevListeners)
    if ($Listeners.Count -eq 0) {
        Write-Step "No dev services are listening on backend port $BackendPort or frontend port $FrontendPort."
    }
    else {
        $Listeners | Format-Table -AutoSize
    }
    exit 0
}

if ($Stop -ne "None") {
    if ($Stop -eq "Backend" -or $Stop -eq "All") {
        Stop-PortListeners -Service "Backend" -Port $BackendPort
    }
    if ($Stop -eq "Frontend" -or $Stop -eq "All") {
        Stop-PortListeners -Service "Frontend" -Port $FrontendPort
    }
    exit 0
}

$NeedsBackend = $Start -eq "All" -or $Start -eq "Backend"
$NeedsFrontend = $Start -eq "All" -or $Start -eq "Frontend"

if ($NeedsBackend) {
    $Go = Resolve-RequiredCommand "go"
}

if ($NeedsFrontend) {
    $Pnpm = Resolve-RequiredCommand "pnpm"
}

if ($Start -eq "Backend") {
    Start-BackendForeground
}

if ($Start -eq "Frontend") {
    Start-FrontendForeground
}

Ensure-FrontendDependencies

if (Test-PortInUse $BackendPort) {
    throw "Backend port $BackendPort is already in use. Stop the existing process or set -BackendUrl."
}

if ($NeedsFrontend -and (Test-PortInUse $FrontendPort)) {
    throw "Frontend port $FrontendPort is already in use. Stop the existing process or set -FrontendPort."
}

if ($Check) {
    Write-Step "Check passed. Backend $BackendUrl and frontend $FrontendUrl are available."
    exit 0
}

$Processes = New-Object System.Collections.Generic.List[object]
$script:EventSubscriptions = New-Object System.Collections.Generic.List[object]
$script:Stopping = $false

function Stop-DevProcesses {
    if ($script:Stopping) {
        return
    }

    $script:Stopping = $true
    Write-Step "Stopping dev services..."

    foreach ($Item in $Processes) {
        $Process = $Item.Process
        if ($Process -and -not $Process.HasExited) {
            try {
                $Process.Kill($true)
            }
            catch {
                try {
                    $Process.Kill()
                }
                catch {
                }
            }
        }
    }
}

try {
    Write-Step "Starting backend at $BackendUrl"
    $Backend = Start-LoggedProcess `
        -Name "api" `
        -FileName $Go `
        -Arguments "run main.go start" `
        -WorkingDirectory $RepoRoot `
        -Environment @{ OCTOPUS_DEBUG = "true"; OCTOPUS_SERVER_PORT = $BackendPort; OCTOPUS_MANAGE_FRONTEND = "true" }

    $Processes.Add([pscustomobject]@{ Name = "api"; Process = $Backend })

    Write-Step "Ready. Backend will manage frontend at $FrontendUrl. Press Ctrl+C to stop services."

    while ($Processes.Count -gt 0) {
        for ($Index = $Processes.Count - 1; $Index -ge 0; $Index--) {
            $Item = $Processes[$Index]
            $Process = $Item.Process
            if ($Process.HasExited) {
                Write-Step "$($Item.Name) exited with code $($Process.ExitCode)."
                $Processes.RemoveAt($Index)
            }
        }

        Start-Sleep -Milliseconds 500
    }

    Write-Step "All dev services have stopped."
}
finally {
    Stop-DevProcesses
    foreach ($Subscription in $script:EventSubscriptions) {
        Unregister-Event -SubscriptionId $Subscription.Id -ErrorAction SilentlyContinue
    }
}
