param(
  [string]$Source = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'shiguang'),
  [string]$OutDir = [Environment]::GetFolderPath('Desktop'),
  [string]$Cs     = (Join-Path $PSScriptRoot 'installer.cs')
)

# 重新生成安装包（改完源码后跑一次即可）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File pack\make-installer.ps1
# 需要：.NET Framework 4 的 csc.exe（系统自带）
# 产物：<OutDir>\shiguang-setup-<版本>.exe

$ErrorActionPreference = 'Stop'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（需要 .NET Framework 4）' }
if (-not (Test-Path $Source)) { throw "找不到源目录：$Source" }

$pkg = Get-Content (Join-Path $PSScriptRoot '..\shiguang\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
$work = Join-Path $env:TEMP ('sg-build-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null

Write-Host '=== 1) 编译 setup.exe / uninstall.exe ==='
$src = Get-Content $Cs -Raw -Encoding UTF8
$src = [regex]::Replace($src, 'public const string Version = "[^"]*";', ('public const string Version = "' + $version + '";'))
$csFile = Join-Path $work 'installer.cs'
[IO.File]::WriteAllText($csFile, $src, (New-Object Text.UTF8Encoding($true)))

$refs = @(
  '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
  '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll'
)
$common = @('/nologo', '/codepage:65001', '/optimize+', '/target:winexe') + $refs
# 安装器图标 = 拾光自己的 ico（找不到就退回到默认图标）
$icon = Join-Path $Source 'resources\app\build\拾光.ico'
if (Test-Path $icon) { $common += ('/win32icon:' + $icon) }
& $csc @common '/main:Setup' ('/out:' + (Join-Path $work 'setup.exe')) $csFile
if ($LASTEXITCODE -ne 0) { throw 'setup.exe 编译失败' }
& $csc @common '/main:Uninstall' ('/out:' + (Join-Path $work 'uninstall.exe')) $csFile
if ($LASTEXITCODE -ne 0) { throw 'uninstall.exe 编译失败' }
Write-Host ('setup.exe     {0} KB' -f [math]::Round((Get-Item (Join-Path $work 'setup.exe')).Length / 1KB))
Write-Host ('uninstall.exe {0} KB' -f [math]::Round((Get-Item (Join-Path $work 'uninstall.exe')).Length / 1KB))

Write-Host '=== 2) 打包 payload ==='
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $work 'payload.zip'
$sw = [Diagnostics.Stopwatch]::StartNew()
[IO.Compression.ZipFile]::CreateFromDirectory($Source, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$za = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Update)
[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, (Join-Path $work 'uninstall.exe'), 'uninstall.exe', [IO.Compression.CompressionLevel]::Optimal)
$za.Dispose()
$sw.Stop()
Write-Host ('payload.zip   {0} MB（{1}s）' -f [math]::Round((Get-Item $zip).Length / 1MB, 1), [math]::Round($sw.Elapsed.TotalSeconds, 0))

Write-Host '=== 3) 拼装单文件安装包 ==='
$out = Join-Path $OutDir ('shiguang-setup-' + $version + '.exe')
if (Test-Path $out) { Remove-Item $out -Force }
$fs = [IO.File]::Create($out)
foreach ($part in @((Join-Path $work 'setup.exe'), $zip)) {
  $in = [IO.File]::OpenRead($part); $in.CopyTo($fs); $in.Dispose()
}
$fs.Write([BitConverter]::GetBytes([int64](Get-Item $zip).Length), 0, 8)
$fs.Write([Text.Encoding]::ASCII.GetBytes('SGSETUP1'), 0, 8)
$fs.Dispose()
Write-Host ('安装包        {0}' -f $out)
Write-Host ('              {0} MB' -f [math]::Round((Get-Item $out).Length / 1MB, 1))

Write-Host '=== 4) 清理 ==='
Remove-Item $work -Recurse -Force
Write-Host '完成'
