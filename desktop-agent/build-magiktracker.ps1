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

# ------ 1. Read CURRENT version (no increment) ----------------
$content = Get-Content $INIT_FILE -Raw
$match   = [regex]::Match($content, '__version__ = "(\d+)\.(\d+)\.(\d+)"')
$major   = [int]$match.Groups[1].Value
$minor   = [int]$match.Groups[2].Value
$newDisplay = "v$major.$minor"        # e.g.  v1.1

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  Building MagikTracker $newDisplay" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# ------ 2. Backup ThriveTracker config ------------------------
$thriveConfig = Get-Content $CONFIG_FILE -Raw
Write-Host "[1/5] ThriveTracker config backed up." -ForegroundColor Green

# ------ 3. Switch company_config.py to Magik ------------------
$magikConfig = @"
NEXT_PUBLIC_SUPABASE_URL = "https://fdrazaffbgwvcxnrxwwc.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcmF6YWZmYmd3dmN4bnJ4d3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzEwNTIsImV4cCI6MjA5Nzg0NzA1Mn0.8MhOWJA2SBBnkx6IosuTSmzaHq3s_hzqbrM85SNIFYg"
SUPABASE_STORAGE_BUCKET = "screenshots"
APP_COMPANY_NAME = "Magik"
APP_TIMEZONE = "Asia/Karachi"
"@
Set-Content $CONFIG_FILE $magikConfig -NoNewline
Write-Host "[2/5] company_config.py switched to Magik." -ForegroundColor Green

# ------ 4. Run PyInstaller ------------------------------------
Write-Host "[3/5] Running PyInstaller (this takes 5-10 min)..." -ForegroundColor Yellow
try {
    & ".venv\Scripts\python.exe" -m PyInstaller ThriveTracker.spec --clean --noconfirm
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller exited with code $LASTEXITCODE" }
    Write-Host "[3/5] Build complete." -ForegroundColor Green
} catch {
    # Always restore config even on failure
    Set-Content $CONFIG_FILE $thriveConfig -NoNewline
    Write-Host "ERROR: PyInstaller failed. Config restored." -ForegroundColor Red
    exit 1
}

# ------ 5. Copy to output folder ------------------------------
New-Item -ItemType Directory -Force -Path $OUTPUT_DIR | Out-Null
$destFile = "$OUTPUT_DIR\MagikTracker-$newDisplay.exe"
Copy-Item "dist\ThriveTracker.exe" $destFile -Force
Write-Host "[4/5] Saved: $destFile" -ForegroundColor Green

# ------ 6. Restore ThriveTracker config -----------------------
Set-Content $CONFIG_FILE $thriveConfig -NoNewline
Write-Host "[5/5] company_config.py restored to ThriveTracker." -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  DONE!  MagikTracker-$newDisplay.exe" -ForegroundColor Magenta
Write-Host "  Saved to: $OUTPUT_DIR" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Both builds are ready:" -ForegroundColor White
Write-Host "  ThriveTracker: D:\programming\VaTrackers\ThriveTracker\ThriveTracker-$newDisplay.exe" -ForegroundColor White
Write-Host "  MagikTracker:  D:\programming\VaTrackers\MagikTracker\MagikTracker-$newDisplay.exe" -ForegroundColor White
