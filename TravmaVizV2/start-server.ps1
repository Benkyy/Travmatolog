$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$securePassword = $null
$secretPointer = [IntPtr]::Zero
$hadPassword = Test-Path Env:ADMIN_PASSWORD
$previousPassword = $env:ADMIN_PASSWORD

if (-not $env:ADMIN_PASSWORD) {
  $securePassword = Read-Host 'Задайте пароль администратора (не менее 16 символов)' -AsSecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
}

if ($env:ADMIN_PASSWORD.Length -lt 16) {
  if ($hadPassword) { $env:ADMIN_PASSWORD = $previousPassword } else { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue }
  throw 'Пароль должен содержать не менее 16 символов.'
}

if (-not $env:DATA_DIR -and $env:LOCALAPPDATA) {
  $env:DATA_DIR = Join-Path $env:LOCALAPPDATA 'TravmaVizV2-data'
}

Push-Location $siteRoot
try {
  node .\server.mjs
} finally {
  Pop-Location
  if ($hadPassword) { $env:ADMIN_PASSWORD = $previousPassword } else { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue }
}
