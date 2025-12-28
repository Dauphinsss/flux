Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(1024,1024)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.Clear([System.Drawing.Color]::FromArgb(99,102,241))
$font = New-Object System.Drawing.Font('Arial',400,[System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$graphics.DrawString('PDF',$font,$brush,100,300)
$graphics.Dispose()
$bmp.Save('app-icon.png',[System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Icon created successfully!"
