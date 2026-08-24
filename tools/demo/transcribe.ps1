# Transcribe every wav in a folder with the offline Windows recogniser.
#
#   powershell -File tools\demo\transcribe.ps1 -Dir <folder> -OutFile <json>
#
# Accuracy is poor on accented speech and that is fine — callers use this to tell one known line
# from another by word overlap, not to produce a readable transcript.
param(
  [string]$Dir = 'tools\demo\out\seg16',
  [string]$OutFile = 'tools\demo\out\transcript.json'
)

Add-Type -AssemblyName System.Speech

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
# A read take has long deliberate pauses; without these the engine stops at the first one.
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(0)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(0)
$engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.5)

# NOTE: PowerShell variables are case-insensitive, so this must not be called $out — that would
# silently overwrite the $OutFile parameter and send the results to a nonexistent drive.
$rows = @()
foreach ($f in (Get-ChildItem $Dir -Filter *.wav | Sort-Object Name)) {
  $engine.SetInputToWaveFile($f.FullName)
  $parts = @()
  while ($true) {
    try { $r = $engine.Recognize() } catch { break }
    if ($null -eq $r) { break }
    $parts += $r.Text
  }
  $text = ($parts -join ' ')
  $rows += [pscustomobject]@{ file = $f.BaseName; text = $text }
  Write-Host ("  {0,-14} {1}" -f $f.BaseName, $text.Substring(0, [Math]::Min(72, $text.Length)))
}

$engine.Dispose()
$rows | ConvertTo-Json -Depth 4 | Out-File $OutFile -Encoding utf8
Write-Host ("transcribed {0} -> {1}" -f $rows.Count, $OutFile)
