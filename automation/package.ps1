# 1. Pull version from package.json in the root (one level up from /automations)
$packageJsonPath = "./package.json"

if (Test-Path $packageJsonPath) {
    $packageData = Get-Content $packageJsonPath | ConvertFrom-Json
    $version = $packageData.version
} else {
    $version = "unknown"
    Write-Warning "package.json not found at $packageJsonPath. Using 'unknown' for version."
}

# 2. Define the destination zip file name with versioning
$zipPath = "./release-v$($version).zip"

# 3. Define the folders to include (relative to the project root)
$foldersToZip = @("./scripts", "./style", "./assets")
$filesToZip = @("./manifest.json", "./package.json", "./popup.html", "./offscreen.html")

# Check if an old bundle exists and remove it
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}

# 4. Create a temporary directory to stage the files
$tempDir = New-Item -ItemType Directory -Path "./temp_bundle" -Force

foreach ($folder in $foldersToZip) {
    if (Test-Path $folder) {
        # Copy-Item into temp directory
        Copy-Item -Path $folder -Destination $tempDir -Recurse
    } else {
        Write-Warning "Folder '$folder' not found. Skipping..."
    }
}

foreach ($file in $filesToZip) {
    if (Test-Path $file) {
        Copy-Item -Path $file -Destination $tempDir
    } else {
        Write-Warning "File '$file' not found. Skipping..."
    }
}

# 5. Compress and Clean up
Compress-Archive -Path "$($tempDir.FullName)\*" -DestinationPath $zipPath
Remove-Item -Path $tempDir -Recurse -Force

Write-Host "Success! Bundle created at $zipPath" -ForegroundColor Green