param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$FilePath
)

$sensitiveVariables = @(
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "NEXTAUTH_URL",
    "AUTH_SECRET",
    "REDIS_HTTP_TOKEN"
)
$previousValues = @{}

try {
    foreach ($variableName in $sensitiveVariables) {
        $previousValues[$variableName] = [Environment]::GetEnvironmentVariable($variableName, "Process")
        Set-Item -Path "Env:$variableName" -Value "[REDACTED]"
    }

    & docker compose -f $FilePath config
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    foreach ($variableName in $sensitiveVariables) {
        if ($null -ne $previousValues[$variableName]) {
            Set-Item -Path "Env:$variableName" -Value $previousValues[$variableName]
        }
        else {
            Remove-Item -Path "Env:$variableName" -ErrorAction SilentlyContinue
        }
    }
}
