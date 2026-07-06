# ============================================================
#  BUILD SCRIPT - MAGIKTRACKER
#  Run this AFTER build-thrivetracker.ps1.
#  It uses the SAME version number (does NOT increment).
#  Output goes to D:\programming\VaTrackers\MagikTracker\
# ============================================================

$ErrorActionPreference = "Stop"

$INIT_FILE   = ".\thrivetracker\__init__.py"
$CONFIG_FILE = ".\thrivetracker\company_config.py"
$OUTPUT_DIR  = "D:\programming\VaTrackers\MagikTracker"
$INSTALLER_SCRIPT = ".\installer\TrackerInstaller.iss"
$ISCC_PATH = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

function Invoke-InstallerBuild {
    param(
        [string]$AppName,
        [string]$AppVersion,
        [string]$AppPublisher,
        [string]$AppExeName,
        [string]$AppSourceExe,
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

# ------ 1. Read CURRENT version (no increment) ----------------
$content = Get-Content $INIT_FILE -Raw
$match   = [regex]::Match($content, '__version__ = "(\d+)\.(\d+)\.(\d+)"')
$major   = [int]$match.Groups[1].Value
$minor   = [int]$match.Groups[2].Value
$patch   = [int]$match.Groups[3].Value
$newFull = "$major.$minor.$patch"
$newDisplay = "v$major.$minor"        # e.g.  v1.1

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  Building MagikTracker $newDisplay" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# ------ 2. Backup ThriveTracker config ------------------------
$thriveConfig = Get-Content $CONFIG_FILE -Raw
Write-Host "[1/6] ThriveTracker config backed up." -ForegroundColor Green

# ------ 3. Switch company_config.py to Magik ------------------
$magikConfig = @"
NEXT_PUBLIC_SUPABASE_URL = "https://fdrazaffbgwvcxnrxwwc.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcmF6YWZmYmd3dmN4bnJ4d3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzEwNTIsImV4cCI6MjA5Nzg0NzA1Mn0.8MhOWJA2SBBnkx6IosuTSmzaHq3s_hzqbrM85SNIFYg"
SUPABASE_STORAGE_BUCKET = "screenshots"
APP_INTERNAL_NAME = "MagikTracker"
APP_COMPANY_NAME = "Magik"
APP_TIMEZONE = "Asia/Karachi"
"@
Set-Content $CONFIG_FILE $magikConfig -NoNewline
Write-Host "[2/6] company_config.py switched to Magik." -ForegroundColor Green

# ------ 4. Run PyInstaller ------------------------------------
Write-Host "[3/6] Running PyInstaller (this takes 5-10 min)..." -ForegroundColor Yellow
try {
    & ".venv\Scripts\python.exe" -m PyInstaller ThriveTracker.spec --clean --noconfirm
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller exited with code $LASTEXITCODE" }
    Write-Host "[3/6] App build complete." -ForegroundColor Green
} catch {
    # Always restore config even on failure
    Set-Content $CONFIG_FILE $thriveConfig -NoNewline
    Write-Host "ERROR: PyInstaller failed. Config restored." -ForegroundColor Red
    exit 1
}

# ------ 5. Build Windows installer ----------------------------
if (-not (Test-Path $ISCC_PATH)) {
    Set-Content $CONFIG_FILE $thriveConfig -NoNewline
    Write-Host "ERROR: Inno Setup compiler not found at $ISCC_PATH. Config restored." -ForegroundColor Red
    exit 1
}

Write-Host "[4/6] Building Setup.exe installer..." -ForegroundColor Yellow
try {
    $destFile = Invoke-InstallerBuild `
        -AppName "MagikTracker" `
        -AppVersion $newFull `
        -AppPublisher "Magik" `
        -AppExeName "ThriveTracker.exe" `
        -AppSourceExe "$PSScriptRoot\dist\ThriveTracker.exe" `
        -AppIconFile "$PSScriptRoot\assets\icon.ico" `
        -FinalOutputDir $OUTPUT_DIR `
        -OutputBaseFilename "MagikTracker-Setup-$newDisplay" `
        -AppId "MagikTrackerDesktop"
    Write-Host "[4/6] Setup.exe build complete." -ForegroundColor Green
} catch {
    Set-Content $CONFIG_FILE $thriveConfig -NoNewline
    Write-Host "ERROR: Installer build failed. Config restored." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# ------ 6. Confirm output path ------------------------------
New-Item -ItemType Directory -Force -Path $OUTPUT_DIR | Out-Null
Write-Host "[5/6] Saved: $destFile" -ForegroundColor Green

# ------ 7. Restore ThriveTracker config -----------------------
Set-Content $CONFIG_FILE $thriveConfig -NoNewline
Write-Host "[6/6] company_config.py restored to ThriveTracker." -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  DONE!  MagikTracker-Setup-$newDisplay.exe" -ForegroundColor Magenta
Write-Host "  Saved to: $OUTPUT_DIR" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Both builds are ready:" -ForegroundColor White
Write-Host "  ThriveTracker: D:\programming\VaTrackers\ThriveTracker\ThriveTracker-Setup-$newDisplay.exe" -ForegroundColor White
Write-Host "  MagikTracker:  D:\programming\VaTrackers\MagikTracker\MagikTracker-Setup-$newDisplay.exe" -ForegroundColor White
