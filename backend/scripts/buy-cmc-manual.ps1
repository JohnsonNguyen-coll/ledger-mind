& {
    $ErrorActionPreference = "Stop"

    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host " CMC x402 - BUY ETH DATA (ROBUST PACED VERSION)" -ForegroundColor Cyan
    Write-Host " REAL PAYMENT: exactly 0.01 USDC" -ForegroundColor Cyan
    Write-Host " Network: Base / 8453" -ForegroundColor Cyan
    Write-Host " Features: Auto-Retry WAF, Anti-Reset Sleep" -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host ""

    # ==================================================
    # 0. LOAD BINANCE AGENTIC WALLET CLI
    # ==================================================
    if (-not $bawCli) {
        $line = Get-Content ".\.env" |
            Where-Object { $_ -match '^BAW_CLI_JS=' } |
            Select-Object -First 1

        if (-not $line) {
            throw "BAW_CLI_JS not found in .env"
        }

        $bawCli = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    }

    if (-not (Test-Path $bawCli)) {
        throw "BAW CLI not found at: $bawCli"
    }

    # ==================================================
    # 1. CHECK WALLET
    # ==================================================
    Write-Host "[1] Checking Wallet Status..." -ForegroundColor Yellow
    $walletRaw = node "$bawCli" wallet status --json
    $wallet = $walletRaw | ConvertFrom-Json

    if (-not $wallet.success) {
        $wallet | ConvertTo-Json -Depth 10
        throw "Wallet API error."
    }

    if ($wallet.data.status -ne "CONNECTED") {
        throw "Wallet is not CONNECTED."
    }
    Write-Host " -> Wallet CONNECTED" -ForegroundColor Green


    # ==================================================
    # 2. GET BRAND NEW CMC 402 CHALLENGE
    # ==================================================
    New-Item -ItemType Directory -Force ".\tmp" | Out-Null
    Remove-Item ".\tmp\cmc-real-headers.txt" -ErrorAction SilentlyContinue
    Remove-Item ".\tmp\cmc-real-data.json" -ErrorAction SilentlyContinue
    Remove-Item ".\tmp\cmc-402.json" -ErrorAction SilentlyContinue

    $url = "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=ETH"
    Write-Host "[2] Fetching fresh 402 challenge from CMC..." -ForegroundColor Yellow

    $firstCode = curl.exe -sS `
        --max-time 20 `
        -D ".\tmp\cmc-402-headers.txt" `
        -o ".\tmp\cmc-402.json" `
        -w "%{http_code}" `
        "$url"

    $curlExit = $LASTEXITCODE
    if ($curlExit -ne 0) {
        throw "Network error when calling CMC. curl exit=$curlExit"
    }

    if ($firstCode -ne "402") {
        Write-Host "HTTP: $firstCode"
        if (Test-Path ".\tmp\cmc-402.json") {
            Get-Content ".\tmp\cmc-402.json" -Raw
        }
        throw "CMC did not return 402 Payment Required."
    }

    $paymentLine = Get-Content ".\tmp\cmc-402-headers.txt" |
        Where-Object { $_ -match '^(?i)payment-required:' } |
        Select-Object -First 1

    if (-not $paymentLine) {
        throw "PAYMENT-REQUIRED header not found."
    }

    $paymentRequired = ($paymentLine -split ':', 2)[1].Trim()
    Write-Host " -> Fresh PAYMENT-REQUIRED received (Length: $($paymentRequired.Length))" -ForegroundColor Green


    # ==================================================
    # 3. PREVIEW WITH ANTI-RESET RETRY & PACING
    # ==================================================
    Write-Host "[3] Requesting x402 Preview with auto-retry protection..." -ForegroundColor Yellow
    $preview = $null
    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        Start-Sleep -Seconds 3  # Pacing sleep to avoid Binance WAF connection reset
        Write-Host " -> Calling Binance x402-payment preview (Attempt $attempt/$maxAttempts)..."

        $previewRaw = node "$bawCli" x402-payment preview `
            --paymentRequirements "$paymentRequired" `
            --json

        try {
            $parsed = $previewRaw | ConvertFrom-Json
            if ($parsed.success) {
                $preview = $parsed
                break
            } else {
                Write-Host "    Binance response: $($parsed.error.name) - $($parsed.error.message)" -ForegroundColor DarkYellow
                if ($parsed.error.code -eq 50001001 -and $attempt -lt $maxAttempts) {
                    Write-Host "    WAF Reset detected. Waiting 4 seconds before retry..." -ForegroundColor DarkYellow
                    Start-Sleep -Seconds 4
                    continue
                }
                $parsed | ConvertTo-Json -Depth 20
                throw "Preview failed."
            }
        } catch {
            if ($attempt -ge $maxAttempts) {
                throw $_
            }
        }
    }

    if (-not $preview) {
        throw "Could not obtain preview from Binance after $maxAttempts attempts."
    }
    Write-Host " -> Preview obtained successfully!" -ForegroundColor Green


    # ==================================================
    # 4. STRICT GUARD: Base, USDC, 0.01, eip3009, no approval
    # ==================================================
    $option = $preview.data.options |
        Where-Object {
            $_.status -eq "READY_TO_SIGN" -and
            [string]$_.binanceChainId -eq "8453" -and
            $_.tokenSymbol -eq "USDC" -and
            [decimal]$_.amount -eq [decimal]"0.01" -and
            $_.assetTransferMethod -eq "eip3009" -and
            $_.needApproveFirst -eq $false
        } |
        Select-Object -First 1

    if (-not $option) {
        Write-Host ""
        Write-Host "=== AVAILABLE OPTIONS ===" -ForegroundColor Red
        $preview.data.options |
            Format-Table index, status, binanceChainId, tokenSymbol, amount, assetTransferMethod, currentBalance, needApproveFirst
        throw "STOP: Option with exactly 0.01 USDC on Base via EIP3009 not found."
    }

    # ==================================================
    # 5. VERIFY USDC EIP712 DOMAIN
    # ==================================================
    $extraName    = $option.originalAccept.extra.name
    $extraVersion = $option.originalAccept.extra.version

    if ($extraName -ne "USD Coin") {
        throw "STOP: EIP712 name is not USD Coin."
    }
    if ([string]$extraVersion -ne "2") {
        throw "STOP: EIP712 version is not 2."
    }

    Write-Host ""
    Write-Host "=== PAYMENT VERIFIED ===" -ForegroundColor Cyan
    Write-Host "Amount:       $($option.amount) $($option.tokenSymbol)"
    Write-Host "Network:      Base / $($option.binanceChainId)"
    Write-Host "Method:       $($option.assetTransferMethod)"
    Write-Host "Balance:      $($option.currentBalance)"
    Write-Host "Pay to:       $($option.payTo)"
    Write-Host "EIP712 name:  $extraName"
    Write-Host "EIP712 ver:   $extraVersion"
    Write-Host ""
    Write-Host " -> Guard PASSED" -ForegroundColor Green


    # ==================================================
    # 6. SIGN WITH ANTI-RESET RETRY & PACING
    # ==================================================
    Write-Host "[4] Signing payment via Binance Agentic Wallet (with retry protection)..." -ForegroundColor Yellow
    $sign = $null
    $maxSignAttempts = 3
    for ($signAttempt = 1; $signAttempt -le $maxSignAttempts; $signAttempt++) {
        Start-Sleep -Seconds 3.5  # Pacing sleep to avoid Binance WAF connection reset
        Write-Host " -> Calling Binance x402-payment sign (Attempt $signAttempt/$maxSignAttempts)..."

        $signRaw = node "$bawCli" x402-payment sign `
            --paymentId $preview.data.paymentId `
            --selectedIndex $option.index `
            --json

        try {
            $parsedSign = $signRaw | ConvertFrom-Json
            if ($parsedSign.success) {
                $sign = $parsedSign
                break
            } else {
                Write-Host "    Binance sign response: $($parsedSign.error.name) - $($parsedSign.error.message)" -ForegroundColor DarkYellow
                if ($parsedSign.error.code -eq 50001001 -and $signAttempt -lt $maxSignAttempts) {
                    Write-Host "    WAF Reset detected during sign. Waiting 4 seconds before retry..." -ForegroundColor DarkYellow
                    Start-Sleep -Seconds 4
                    continue
                }
                $parsedSign | ConvertTo-Json -Depth 20
                throw "SIGN FAILED: $($parsedSign.error.message)"
            }
        } catch {
            if ($signAttempt -ge $maxSignAttempts) {
                throw $_
            }
        }
    }

    if (-not $sign -or -not $sign.success) {
        throw "Could not obtain signature from Binance after $maxSignAttempts attempts."
    }

    if (-not $sign.data.paymentHeaderName -or -not $sign.data.paymentHeaderValue) {
        throw "Missing payment header data in sign response."
    }
    Write-Host " -> SIGN OK (Signature generated)" -ForegroundColor Green


    # ==================================================
    # 7. CRITICAL: WAIT 4s TO GUARANTEE Base block.timestamp > validAfter
    # ==================================================
    Write-Host "[5] Waiting 4s to ensure Base block.timestamp > validAfter..." -ForegroundColor Yellow
    Start-Sleep -Seconds 4

    # ==================================================
    # 8. REPLAY PAYMENT-SIGNATURE TO CMC
    # ==================================================
    $headerName  = $sign.data.paymentHeaderName
    $headerValue = $sign.data.paymentHeaderValue

    Write-Host "[6] Sending PAYMENT-SIGNATURE to CoinMarketCap..." -ForegroundColor Yellow

    $httpCode = curl.exe -sS `
        --max-time 20 `
        --request GET `
        --url "$url" `
        --header "${headerName}: $headerValue" `
        --header "Accept: application/json" `
        -D ".\tmp\cmc-real-headers.txt" `
        -o ".\tmp\cmc-real-data.json" `
        -w "%{http_code}"

    $curlExit = $LASTEXITCODE
    if ($curlExit -ne 0) {
        Write-Host "curl exit: $curlExit" -ForegroundColor Red
        throw "Network error AFTER SIGN. DO NOT create new signature."
    }

    Write-Host ""
    if ($httpCode -eq "200") {
        Write-Host "HTTP STATUS: $httpCode" -ForegroundColor Green
    } else {
        Write-Host "HTTP STATUS: $httpCode" -ForegroundColor Yellow
    }

    # ==================================================
    # 9. CHECK RESULT
    # ==================================================
    if ($httpCode -ne "200") {
        Write-Host ""
        Write-Host "=== CMC RESPONSE BODY ===" -ForegroundColor DarkYellow
        if (Test-Path ".\tmp\cmc-real-data.json") {
            Get-Content ".\tmp\cmc-real-data.json" -Raw
        } else {
            Write-Host "CMC returned no response body."
        }
        Write-Host ""
        Write-Host "STOP - Preserving journal; not creating second payment/signature." -ForegroundColor Yellow
        throw "CMC did not accept payment (HTTP $httpCode)."
    }

    # ==================================================
    # 10. PAYMENT SETTLEMENT SUCCESS
    # ==================================================
    $responseLine = Get-Content ".\tmp\cmc-real-headers.txt" |
        Where-Object { $_ -match '^(?i)payment-response:' } |
        Select-Object -First 1

    if ($responseLine) {
        try {
            $encoded = ($responseLine -split ':', 2)[1].Trim()
            $normalized = $encoded.Replace('-', '+').Replace('_', '/')
            switch ($normalized.Length % 4) {
                2 { $normalized += "==" }
                3 { $normalized += "=" }
            }
            $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($normalized))
            $settlement = $decoded | ConvertFrom-Json

            Write-Host ""
            Write-Host "==============================================" -ForegroundColor Green
            Write-Host " PAYMENT SETTLED ON-CHAIN" -ForegroundColor Green
            Write-Host "==============================================" -ForegroundColor Green
            Write-Host "Success:   $($settlement.success)"
            Write-Host "Network:   $($settlement.networkId)"
            Write-Host "Tx Hash:   $($settlement.txHash)"
            Write-Host "Explorer:  https://basescan.org/tx/$($settlement.txHash)"
        } catch {
            Write-Host "Payment succeeded (HTTP 200) but settlement header decode failed."
        }
    } else {
        Write-Host "WARNING: HTTP 200 but no PAYMENT-RESPONSE header." -ForegroundColor DarkYellow
    }

    # ==================================================
    # 11. PRINT PURCHASED DATA
    # ==================================================
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host " COINMARKETCAP DATA PURCHASED" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
    $raw = Get-Content ".\tmp\cmc-real-data.json" -Raw
    try {
        $data = $raw | ConvertFrom-Json
        $data | ConvertTo-Json -Depth 30
    } catch {
        Write-Host $raw
    }

    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host " SUCCESS - Saved to .\tmp\cmc-real-data.json" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
}
