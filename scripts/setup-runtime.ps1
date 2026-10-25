#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'Portable setup supports Windows x64 only. Install Node.js >=22.23.4 <23 for your platform.'
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = [IO.Path]::GetFullPath((Join-Path $projectRoot '.faultline/runtime'))
foreach ($directory in @((Join-Path $projectRoot '.faultline'), $runtimePath)) {
    if ((Test-Path -LiteralPath $directory) -and
        ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Runtime directories must be ordinary directories inside this project.'
    }
}
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$runtimePath = (Resolve-Path -LiteralPath $runtimePath).Path
$target = [IO.Path]::GetFullPath((Join-Path $runtimePath 'node.exe'))
$temporary = [IO.Path]::GetFullPath((Join-Path $runtimePath ("node-$([guid]::NewGuid().ToString('N')).download.exe")))
foreach ($file in @($target, $temporary)) {
    if ([IO.Path]::GetDirectoryName($file) -ine $runtimePath) {
        throw 'Runtime file path escaped the project runtime directory.'
    }
}

$release = 'https://nodejs.org/dist/v22.23.4'
try {
    $checksums = (Invoke-WebRequest -Uri "$release/SHASUMS256.txt" -TimeoutSec 60).Content
    $entries = [regex]::Matches($checksums, '(?m)^([0-9a-fA-F]{64})[ \t]+\*?win-x64/node\.exe\r?$')
    if ($entries.Count -ne 1) { throw 'Official checksum list does not identify one Windows x64 executable.' }
    Invoke-WebRequest -Uri "$release/win-x64/node.exe" -OutFile $temporary -TimeoutSec 120
    $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
    if ($actualHash -ine $entries[0].Groups[1].Value) { throw 'Node download failed SHA256 verification.' }
    if ((Get-AuthenticodeSignature -LiteralPath $temporary).Status -ne 'Valid') {
        throw 'Node download failed Windows Authenticode verification.'
    }
    $version = & $temporary --version
    if ($LASTEXITCODE -ne 0 -or $version -ne 'v22.23.4') { throw 'Verified download has an unexpected Node version.' }
    if ((Test-Path -LiteralPath $target) -and
        ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Runtime executable must be an ordinary file inside the runtime directory.'
    }
    Move-Item -LiteralPath $temporary -Destination $target -Force
    Write-Output "Project runtime installed: $version"
} finally {
    if (Test-Path -LiteralPath $temporary) {
        if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($temporary)) -ine $runtimePath) {
            throw 'Refusing cleanup outside the project runtime directory.'
        }
        Remove-Item -LiteralPath $temporary
    }
}
