# Test Compose Fail-Closed Behavior for Required Secrets
$ErrorActionPreference = "Continue"

$tempEnvFile = [System.IO.Path]::GetFullPath("tests/scratch_disposable.env")

$baseTestValues = @{
    "POSTGRES_DB" = "disposable_test_db"
    "POSTGRES_USER" = "disposable_test_user"
    "POSTGRES_PASSWORD" = "disposable_test_password_12345"
    "DATABASE_URL" = "postgresql://disposable_test_user:disposable_test_password_12345@postgres:5432/disposable_test_db?schema=public"
    "NEXTAUTH_URL" = "https://example.com"
    "AUTH_SECRET" = "disposable_test_auth_secret_minimum_32_characters_long"
    "REDIS_HTTP_TOKEN" = "disposable_test_redis_token_12345"
}

function Write-EnvFile($values) {
    $lines = @()
    foreach ($k in $values.Keys) {
        $lines += "$k=$($values[$k])"
    }
    Set-Content -Path $tempEnvFile -Value $lines
}

try {
    Write-Host "=== Testing All Required Secrets Present ==="
    Write-EnvFile $baseTestValues

    $output = (& docker compose --env-file $tempEnvFile -f docker-compose.prod.yml config 2>&1) | Out-String
    $allPresentExit = $LASTEXITCODE
    if ($allPresentExit -eq 0) {
        Write-Host "PASS: Production Compose succeeds with all disposable test values present."
    } else {
        Write-Host "FAIL: Production Compose failed when all values were present (exit code: $allPresentExit)."
        Write-Host $output
    }

    Write-Host "`n=== Testing Fail-Closed on Each Missing Secret ==="
    $requiredKeys = @("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "DATABASE_URL", "NEXTAUTH_URL", "AUTH_SECRET", "REDIS_HTTP_TOKEN")

    $failedClosedCount = 0
    foreach ($keyToOmit in $requiredKeys) {
        $subset = @{}
        foreach ($k in $baseTestValues.Keys) {
            if ($k -ne $keyToOmit) {
                $subset[$k] = $baseTestValues[$k]
            }
        }
        Write-EnvFile $subset

        # Also ensure process environment doesn't have it
        Remove-Item -Path "Env:$keyToOmit" -ErrorAction SilentlyContinue

        $output = (& docker compose --env-file $tempEnvFile -f docker-compose.prod.yml config 2>&1) | Out-String
        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            Write-Host "PASS: Omitting $keyToOmit correctly failed closed (exit code: $exitCode)."
            $failedClosedCount++
        } else {
            Write-Host "FAIL: Omitting $keyToOmit allowed config to succeed (should fail closed)."
        }
    }

    Write-Host "`nSummary: $failedClosedCount / $($requiredKeys.Count) required secrets properly failed closed."
    if ($failedClosedCount -eq $requiredKeys.Count -and $allPresentExit -eq 0) {
        exit 0
    } else {
        exit 1
    }
}
finally {
    if (Test-Path $tempEnvFile) {
        Remove-Item -Path $tempEnvFile -Force -ErrorAction SilentlyContinue
    }
}
