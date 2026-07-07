# ============================================================
#  BUILD SCRIPT - THRIVETRACKER
#  Run this FIRST before building MagikTracker.
#  It increments the version number automatically.
#  Output goes to D:\programming\VaTrackers\ThriveTracker\
# ============================================================

$ErrorActionPreference = "Stop"

$INIT_FILE      = ".\thrivetracker\__init__.py"
$CONFIG_FILE    = ".\thrivetracker\company_config.py"
$ENV_FILE       = ".\..\env"          # root .env (one level up)
$ENV_FILE_ROOT  = "$PSScriptRoot\..\env"
$OUTPUT_DIR     = "D:\programming\VaTrackers\ThriveTracker"
$INSTALLER_SCRIPT = ".\installer\TrackerInstaller.iss"
$ISCC_PATH = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

function Invoke-InstallerBuild {
    param(
        [string]$AppName,
        [string]$AppVersion,
        [string]$AppPublisher,
        [string]$AppExeName,
        [string]$AppSourceExe,
        [string]$AppSourceDir,
        [string]$AppIconFile,
        [string]$FinalOutputDir,
        [string]$OutputBaseFilename,
        [string]$AppId
    )

    $maxAttempts = 3

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $tempOutputDir = Join-Path $env:TEMP ("tracker-installer-build-" + [guid]::NewGuid().ToString())
        New-Item -ItemType Directory -Force -Path $tempOutputDir | Out-Null

        try {
            & $ISCC_PATH `
                "/DMyAppName=$AppName" `
                "/DMyAppVersion=$AppVersion" `
                "/DMyAppPublisher=$AppPublisher" `
                "/DMyAppExeName=$AppExeName" `
                "/DMyAppSourceExe=$AppSourceExe" `
                "/DMyAppSourceDir=$AppSourceDir" `
                "/DMyAppIconFile=$AppIconFile" `
                "/DMyAppOutputDir=$tempOutputDir" `
                "/DMyAppOutputBaseFilename=$OutputBaseFilename" `
                "/DMyAppId=$AppId" `
                $INSTALLER_SCRIPT

            if ($LASTEXITCODE -ne 0) {
                throw "Installer build exited with code $LASTEXITCODE"
            }

            $builtInstaller = Join-Path $tempOutputDir ($OutputBaseFilename + ".exe")
            if (-not (Test-Path $builtInstaller)) {
                throw "Expected installer was not created: $builtInstaller"
            }

            New-Item -ItemType Directory -Force -Path $FinalOutputDir | Out-Null
            $finalInstaller = Join-Path $FinalOutputDir ($OutputBaseFilename + ".exe")

            for ($copyAttempt = 1; $copyAttempt -le 5; $copyAttempt++) {
                try {
                    Copy-Item -LiteralPath $builtInstaller -Destination $finalInstaller -Force
                    return $finalInstaller
                } catch {
                    if ($copyAttempt -eq 5) {
                        throw
                    }

                    Start-Sleep -Seconds 2
                }
            }
        } catch {
            if ($attempt -eq $maxAttempts) {
                throw
            }

            Write-Host "Installer build attempt $attempt failed. Retrying in 5 seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        } finally {
            if (Test-Path $tempOutputDir) {
                Remove-Item -LiteralPath $tempOutputDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# ------ 1. Read current version --------------------------------
$content = Get-Content $INIT_FILE -Raw
$match   = [regex]::Match($content, '__version__ = "(\d+)\.(\d+)\.(\d+)"')
$major   = [int]$match.Groups[1].Value
$minor   = [int]$match.Groups[2].Value
$patch   = [int]$match.Groups[3].Value

# Increment minor version  (1.0.0 -> 1.1.0 -> 1.2.0 ...)
$minor++
$newFull    = "$major.$minor.$patch"
$newDisplay = "v$major.$minor"        # e.g.  v1.1

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Building ThriveTracker $newDisplay" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ------ 2. Write new version to __init__.py -------------------
$content = $content -replace '__version__ = "\d+\.\d+\.\d+"', "__version__ = `"$newFull`""
Set-Content $INIT_FILE $content -NoNewline
Write-Host "[1/6] Version updated to $newFull" -ForegroundColor Green

# ------ 3. Make sure company_config.py has ThriveTracker values
$thriveConfig = @"
NEXT_PUBLIC_SUPABASE_URL = "https://gblftoqzztpzfxzbixdy.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdibGZ0b3F6enRwemZ4emJpeGR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjE2NjYsImV4cCI6MjA5NzE5NzY2Nn0.3P50L__0fXwsPn8DG03SY6iQgDv-fho4NY7guc6JU-I"
SUPABASE_STORAGE_BUCKET = "screenshots"
APP_INTERNAL_NAME = "ThriveTracker"
APP_COMPANY_NAME = "ThriveTracker"
APP_TIMEZONE = "UTC"
"@
Set-Content $CONFIG_FILE $thriveConfig -NoNewline
Write-Host "[2/6] company_config.py set to ThriveTracker" -ForegroundColor Green

# ------ 4. Run PyInstaller ------------------------------------
Write-Host "[3/6] Running PyInstaller (this takes 5-10 min)..." -ForegroundColor Yellow
& ".venv\Scripts\python.exe" -m PyInstaller ThriveTracker.spec --clean --noconfirm
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: PyInstaller failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[3/6] App build complete." -ForegroundColor Green

# ------ 5. Build Windows installer ----------------------------
if (-not (Test-Path $ISCC_PATH)) {
    Write-Host "ERROR: Inno Setup compiler not found at $ISCC_PATH" -ForegroundColor Red
    exit 1
}

Write-Host "[4/6] Building Setup.exe installer..." -ForegroundColor Yellow
try {
    $destFile = Invoke-InstallerBuild `
        -AppName "ThriveTracker" `
        -AppVersion $newFull `
        -AppPublisher "ThriveTracker" `
        -AppExeName "ThriveTracker.exe" `
        -AppSourceExe "$PSScriptRoot\dist\ThriveTracker\ThriveTracker.exe" `
        -AppSourceDir "$PSScriptRoot\dist\ThriveTracker" `
        -AppIconFile "$PSScriptRoot\assets\icon.ico" `
        -FinalOutputDir $OUTPUT_DIR `
        -OutputBaseFilename "ThriveTracker-Setup-$newDisplay" `
        -AppId "ThriveTrackerDesktop"
} catch {
    Write-Host "ERROR: Installer build failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
Write-Host "[4/6] Setup.exe build complete." -ForegroundColor Green

# ------ 6. Confirm output path --------------------------------
New-Item -ItemType Directory -Force -Path $OUTPUT_DIR | Out-Null
Write-Host "[5/6] Saved: $destFile" -ForegroundColor Green

# ------ 7. Push version change to GitHub ---------------------
Write-Host "[6/6] Pushing version bump to GitHub..." -ForegroundColor Yellow
git -C "$PSScriptRoot\.." add "desktop-agent/thrivetracker/__init__.py"
git -C "$PSScriptRoot\.." commit -m "chore: bump desktop version to $newFull"
git -C "$PSScriptRoot\.." push origin master
Write-Host "[6/6] GitHub updated." -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  DONE!  ThriveTracker-Setup-$newDisplay.exe" -ForegroundColor Cyan
Write-Host "  Saved to: $OUTPUT_DIR" -ForegroundColor Cyan
Write-Host "  Now run build-magiktracker.ps1 for Magik!" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
