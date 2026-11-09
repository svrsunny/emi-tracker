# Creates the Android release signing key (emi-release.jks) and keystore.properties in this folder.
# Both files are git-ignored. The password is typed by you, hidden, and never shown or logged.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Test-Path emi-release.jks) { Write-Host 'emi-release.jks already exists here - not overwriting it.' -ForegroundColor Yellow; return }

function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }
do {
    $pa = Plain (Read-Host 'Choose a keystore password (8+ characters, no backslash)' -AsSecureString)
    $pb = Plain (Read-Host 'Type the same password again' -AsSecureString)
    $ok = $pa.Length -ge 8 -and $pa -ceq $pb -and -not $pa.Contains('\')
    if (-not $ok) { Write-Host 'The two entries differ, are shorter than 8 characters, or contain \ - please try again.' -ForegroundColor Red }
} until ($ok)

# keytool from PATH, JAVA_HOME or Android Studio's bundled JDK
$keytool = @(
    (Get-Command keytool -ErrorAction SilentlyContinue).Source,
    $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\keytool.exe' }),
    "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) { throw 'keytool not found: install a JDK 17+ (or Android Studio) or set JAVA_HOME.' }
$env:EMI_KS_PASS = $pa
try {
    & $keytool -genkeypair -keystore emi-release.jks -storetype PKCS12 -keyalg RSA -keysize 4096 -validity 10000 `
        -alias emi -dname 'CN=EMI Tracker, O=EMI Tracker' -storepass:env EMI_KS_PASS -keypass:env EMI_KS_PASS
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
    "storeFile=emi-release.jks`nstorePassword=$pa`nkeyAlias=emi`nkeyPassword=$pa" | Set-Content -Encoding ascii keystore.properties
} finally {
    Remove-Item Env:EMI_KS_PASS -ErrorAction SilentlyContinue
    Remove-Variable pa, pb -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Done: emi-release.jks and keystore.properties were created.' -ForegroundColor Green
Write-Host 'NOW back up emi-release.jks somewhere off this PC, and keep the password in a password manager.' -ForegroundColor Yellow
Write-Host 'Without both you can never publish an update that installs over this version.' -ForegroundColor Yellow
Write-Host "Folder: $PSScriptRoot"
