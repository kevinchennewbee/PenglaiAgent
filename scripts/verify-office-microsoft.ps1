param(
  [Parameter(Mandatory = $true)][string]$Docx,
  [Parameter(Mandatory = $true)][string]$Xlsx,
  [Parameter(Mandatory = $true)][string]$Pptx
)

$ErrorActionPreference = 'Stop'
$word = $null
$excel = $null
$powerpoint = $null

function Release-ComObject([object]$Value) {
  if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
  }
}

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($Docx, $false, $true)
  $content = $document.Content
  $wordText = [string]$content.Text
  Release-ComObject $content
  $document.Close(0)
  Release-ComObject $document

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open($Xlsx, 0, $true)
  $worksheet = $workbook.Worksheets.Item(1)
  $range = $worksheet.Range('B1')
  $cell = [string]$range.Text
  Release-ComObject $range
  Release-ComObject $worksheet
  $workbook.Close($false)
  Release-ComObject $workbook

  $powerpoint = New-Object -ComObject PowerPoint.Application
  $presentation = $powerpoint.Presentations.Open($Pptx, $true, $false, $false)
  $slideText = @()
  for ($slideIndex = 1; $slideIndex -le $presentation.Slides.Count; $slideIndex += 1) {
    $slide = $presentation.Slides.Item($slideIndex)
    for ($shapeIndex = 1; $shapeIndex -le $slide.Shapes.Count; $shapeIndex += 1) {
      $shape = $slide.Shapes.Item($shapeIndex)
      if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
        $textFrame = $shape.TextFrame
        $textRange = $textFrame.TextRange
        $slideText += [string]$textRange.Text
        Release-ComObject $textRange
        Release-ComObject $textFrame
      }
      Release-ComObject $shape
    }
    Release-ComObject $slide
  }
  $presentation.Close()
  Release-ComObject $presentation

  $result = [ordered]@{
    word = $wordText.Contains('typed-paragraph')
    excel = $cell -eq 'typed-cell'
    powerpoint = ($slideText -join ' ').Contains('typed-slide')
  }
  $result | ConvertTo-Json -Compress
  if (-not $result.word -or -not $result.excel -or -not $result.powerpoint) { exit 1 }
} catch {
  [ordered]@{ word = $false; excel = $false; powerpoint = $false; error = 'MICROSOFT_OFFICE_VALIDATION_FAILED' } |
    ConvertTo-Json -Compress
  exit 1
} finally {
  if ($powerpoint) { $powerpoint.Quit(); Release-ComObject $powerpoint }
  if ($excel) { $excel.Quit(); Release-ComObject $excel }
  if ($word) { $word.Quit(); Release-ComObject $word }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
