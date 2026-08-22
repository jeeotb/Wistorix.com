# =====================================================================
#  Qranty Landing - dung thu muc _deploy de tai len Vercel
#  Chi copy dung nhung file thuc su duoc trang web tham chieu.
#  Doc danh sach tu deploy-manifest.txt (cung thu muc).
# =====================================================================
$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $root 'deploy-manifest.txt'
$out      = Join-Path $root '_deploy'

if (-not (Test-Path $manifest)) { Write-Host "Thieu deploy-manifest.txt" -ForegroundColor Red; Read-Host "Enter de thoat"; exit 1 }

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

$ok = 0; $missing = @(); $bytes = 0
foreach ($line in Get-Content $manifest -Encoding UTF8) {
    $rel = $line.Trim()
    if (-not $rel) { continue }
    $src = Join-Path $root ($rel -replace '/', '\')
    if (-not (Test-Path $src)) { $missing += $rel; continue }
    $dst = Join-Path $out ($rel -replace '/', '\')
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $src $dst -Force
    $ok++; $bytes += (Get-Item $src).Length
}

Write-Host ""
Write-Host "Da copy $ok file  (~$([math]::Round($bytes/1MB,1)) MB)" -ForegroundColor Green
if ($missing.Count -gt 0) {
    Write-Host "Thieu $($missing.Count) file:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "   $_" -ForegroundColor Yellow }
}
Write-Host ""
Write-Host "Thu muc da san sang:" -ForegroundColor Cyan
Write-Host "   $out"
Write-Host ""
Write-Host "Buoc tiep theo: keo thu muc _deploy tha vao trang vercel.com/new dang mo tren Chrome."
Write-Host ""
Start-Process explorer.exe $root
Read-Host "Nhan Enter de dong"
