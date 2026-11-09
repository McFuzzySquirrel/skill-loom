param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:LOOM_TEST_PRIVILEGED_NATIVE -ne '1' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Native fixtures require explicitly opted-in disposable hosted Windows runners.'
}
$executable = Join-Path $Root 'actor.exe'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-native-scope.cs') -OutputAssembly $executable -OutputType ConsoleApplication
Add-Type -Path $executable
[WindowsNativeScopeFixture]::Probe($Root, $executable)
