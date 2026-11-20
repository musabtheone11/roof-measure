param([int]$Port = 8080, [switch]$Open)
# Minimal local server for Roof Measure at http://localhost:8080/
# - serves the app files
# - POST /save?name=<file>  writes the request body into the "reports" folder (used by "Save to Reports folder")
# Only needed if you restrict your API key by website or want reports saved straight to disk; otherwise double-click index.html.
$root = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$reports = Join-Path $root "reports"
if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Path $reports | Out-Null }
# large height-model cache files (_ccache_*) stay on this PC, outside OneDrive
$cache = Join-Path $env:LOCALAPPDATA "RoofMeasureCache"
if (-not (Test-Path $cache)) { New-Item -ItemType Directory -Path $cache | Out-Null }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Roof Measure running at http://localhost:$Port/   (close this window to stop)"
if ($Open) { Start-Process "http://localhost:$Port/" }
$mime = @{ ".html"="text/html; charset=utf-8"; ".js"="application/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".json"="application/json"; ".png"="image/png"; ".jpg"="image/jpeg"; ".svg"="image/svg+xml"; ".ico"="image/x-icon"; ".md"="text/plain; charset=utf-8"; ".pdf"="application/pdf" }
# ---- drone flights: DJI Fly waypoint routes on an Android phone over USB (adb)
$djiWp = "/sdcard/Android/data/dji.go.v5/files/waypoint"
$idRx = '^[A-Za-z0-9_-]{4,80}$'
function Get-Adb {
  $c = Get-Command adb -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $cache "platform-tools\adb.exe"
  if (Test-Path $p) { return $p }
  Write-Host "Downloading Android platform-tools (adb) from Google..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $cache "platform-tools.zip"
  Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $cache -Force
  Remove-Item $zip -Force
  if (-not (Test-Path $p)) { throw "adb download failed" }
  return $p
}
function Send-Json($res, $obj, [int]$code = 200) {
  $b = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 4))
  $res.StatusCode = $code; $res.ContentType = "application/json"; $res.Headers.Add("Cache-Control", "no-store")
  $res.ContentLength64 = $b.Length; $res.OutputStream.Write($b, 0, $b.Length)
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq "/relay/pao" -or $path -eq "/relay/clay") {
      # fixed public-record relays only (these sites block cross-site requests from the browser); no open proxy
      $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
      try {
        if ($path -eq "/relay/pao") {
          $re = ($req.QueryString["re"] -replace '[^0-9]', '')
          if ($re.Length -lt 6 -or $re.Length -gt 12) { throw "bad RE" }
          $r = Invoke-WebRequest -Uri ("https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=" + $re) -UseBasicParsing -TimeoutSec 30 -Headers @{ 'User-Agent' = $ua }
          $body = [Text.Encoding]::UTF8.GetBytes($r.Content); $res.ContentType = "text/html; charset=utf-8"
        } else {
          if ($req.HttpMethod -ne "POST") { throw "POST only" }
          $sr = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8); $json = $sr.ReadToEnd()
          if ($json.Length -gt 20000) { throw "too large" }
          $r = Invoke-WebRequest -Uri "https://claycountyfl-energovpub.tylerhost.net/apps/selfservice/api/energov/search/search" -Method Post -Body $json -ContentType "application/json;charset=UTF-8" -UseBasicParsing -TimeoutSec 60 -Headers @{ 'User-Agent' = $ua; 'tenantId' = '1'; 'tenantName' = 'ClayCountyFL'; 'Tyler-TenantUrl' = 'ClayCountyFL'; 'Tyler-Tenant-Culture' = 'en-US' }
          $body = [Text.Encoding]::UTF8.GetBytes($r.Content); $res.ContentType = "application/json; charset=utf-8"
        }
      } catch { $res.StatusCode = 502; $body = [Text.Encoding]::UTF8.GetBytes('{"error":"relay failed"}'); $res.ContentType = "application/json" }
      $res.Headers.Add("Cache-Control", "no-store"); $res.ContentLength64 = $body.Length; $res.OutputStream.Write($body, 0, $body.Length)
    } elseif ($path.StartsWith("/drone/")) {
      try {
        $adb = Get-Adb
        if ($path -eq "/drone/status") {
          $devs = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\S" })
          $ready = @($devs | Where-Object { $_ -match "\tdevice$" })
          if (-not $ready.Count) {
            $err = if (@($devs | Where-Object { $_ -match "unauthorized" }).Count) { "The phone is asking to allow USB debugging. Unlock it and tap Allow." } else { "No phone found. Plug it in with USB debugging on." }
            Send-Json $res @{ adb = $true; device = $null; routes = @(); error = $err }
          } else {
            $ls = & $adb shell "cd $djiWp 2>/dev/null && for d in `$(ls -t); do [ -f `$d/`$d.kmz ] && echo `$d; done"
            $routes = @($ls | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match $idRx })
            Send-Json $res @{ adb = $true; device = ($ready[0] -split "\t")[0]; routes = $routes }
          }
        } elseif ($path -eq "/drone/placeholder") {
          $id = "" + $req.QueryString["id"]; if ($id -notmatch $idRx) { throw "bad route id" }
          $tmp = Join-Path $cache "dji_placeholder.kmz"; if (Test-Path $tmp) { Remove-Item $tmp -Force }
          & $adb pull "$djiWp/$id/$id.kmz" "$tmp" | Out-Null
          if (-not (Test-Path $tmp)) { throw "Could not read the route from the phone" }
          $bak = Join-Path $cache "dji_backup_$id.kmz"; if (-not (Test-Path $bak)) { Copy-Item $tmp $bak }   # first copy seen of each route
          $b = [IO.File]::ReadAllBytes($tmp)
          $res.ContentType = "application/vnd.google-earth.kmz"; $res.Headers.Add("Cache-Control", "no-store"); $res.ContentLength64 = $b.Length; $res.OutputStream.Write($b, 0, $b.Length)
        } elseif ($path -eq "/drone/push" -and $req.HttpMethod -eq "POST") {
          $id = "" + $req.QueryString["id"]; if ($id -notmatch $idRx) { throw "bad route id" }
          $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms)
          if ($ms.Length -lt 100 -or $ms.Length -gt 5MB) { throw "bad route file" }
          $tmp = Join-Path $cache "dji_route.kmz"; [IO.File]::WriteAllBytes($tmp, $ms.ToArray())
          & $adb shell am force-stop dji.go.v5 | Out-Null          # DJI Fly must not overwrite the file while it is open
          $o = (& $adb push "$tmp" "$djiWp/$id/$id.kmz") -join " "
          if ($LASTEXITCODE -ne 0) { throw "adb push failed: $o" }
          Send-Json $res @{ ok = $true; id = $id }
        } else { $res.StatusCode = 404 }
      } catch { Send-Json $res @{ adb = $false; error = "$($_.Exception.Message)" } 500 }
    } elseif ($req.HttpMethod -eq "POST" -and $path -eq "/save") {
      $name = $req.QueryString["name"]; if (-not $name) { $name = "report.html" }
      $name = ($name -replace '[\\/:*?"<>|]', '_')
      $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms)
      $target = if ($name.StartsWith("_ccache_")) { Join-Path $cache $name } else { Join-Path $reports $name }
      [IO.File]::WriteAllBytes($target, $ms.ToArray())
      $body = [Text.Encoding]::UTF8.GetBytes('{"saved":"' + ($target -replace '\\', '\\\\') + '"}')
      $res.ContentType = "application/json"; $res.ContentLength64 = $body.Length; $res.OutputStream.Write($body, 0, $body.Length)
    } else {
      if ($path -eq "/") { $path = "/index.html" }
      $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
      $full = [IO.Path]::GetFullPath($file)
      $okRoot = $root
      if ($path.StartsWith("/reports/_ccache_")) { $full = [IO.Path]::GetFullPath((Join-Path $cache ($path.Substring(9) -replace '[\\/:*?"<>|]', '_'))); $okRoot = $cache }
      if ($full.StartsWith($okRoot) -and (Test-Path $full -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLower()
        if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = "application/octet-stream" }
        $res.Headers.Add("Cache-Control", "no-store")
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $res.StatusCode = 404 }
    }
  } catch { $res.StatusCode = 500 } finally { $res.OutputStream.Close() }
}
