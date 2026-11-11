# 计算每个家具贴图「每一行第一格」的内容包围盒（alpha > 8），写进 assets/manifest.json 的 bboxRows
# 用法：pwsh -NoProfile -File office/tools/gen_bboxrows.ps1
Add-Type -AssemblyName System.Drawing | Out-Null
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$assets = Join-Path $root "web\assets"
$manifestPath = Join-Path $assets "manifest.json"
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

$updated = 0
$report = @()
foreach ($prop in $manifest.PSObject.Properties) {
  $name = $prop.Name
  $m = $prop.Value
  if (-not $m.frameW -or -not $m.frameH) { continue }
  $png = Join-Path $assets "$name.png"
  if (-not (Test-Path $png)) { continue }
  $bmp = [System.Drawing.Bitmap]::FromFile($png)
  try {
    $fw = [int]$m.frameW
    $fh = [int]$m.frameH
    $rows = [int][Math]::Floor($bmp.Height / $fh)
    if ($rows -lt 1) { continue }
    $out = @()
    for ($r = 0; $r -lt $rows; $r++) {
      $y0 = $r * $fh
      $minX = 9999; $maxX = -1; $minY = 9999; $maxY = -1
      for ($y = $y0; $y -lt ($y0 + $fh); $y++) {
        for ($x = 0; $x -lt $fw; $x++) {
          if ($bmp.GetPixel($x, $y).A -gt 8) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
          }
        }
      }
      if ($maxX -ge 0) {
        $out += ,@($minX, ($minY - $y0), ($maxX - $minX + 1), ($maxY - $minY + 1))
      } else {
        $out += ,@(0, 0, $fw, $fh)
      }
    }
    $m | Add-Member -NotePropertyName bboxRows -NotePropertyValue $out -Force
    $updated++
    if ($rows -gt 1) {
      $diff = $false
      for ($i = 1; $i -lt $rows; $i++) {
        if (($out[$i][2] -ne $out[0][2]) -or ($out[$i][3] -ne $out[0][3])) { $diff = $true }
      }
      if ($diff) {
        $report += ("{0}: {1}" -f $name, (($out | ForEach-Object { "[{0}]" -f ($_ -join ",") }) -join " "))
      }
    }
  } finally { $bmp.Dispose() }
}

$manifest | ConvertTo-Json -Depth 12 -Compress | Set-Content $manifestPath -Encoding UTF8
Write-Host ("已写入 bboxRows：{0} 个资产" -f $updated)
Write-Host ("各行尺寸不同的资产（{0} 个）：" -f $report.Count)
$report | ForEach-Object { Write-Host ("  " + $_) }
