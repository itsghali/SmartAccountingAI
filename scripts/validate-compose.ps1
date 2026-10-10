param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$FilePath
)

$previousGroqKey = $env:GROQ_API_KEY
$previousOpenRouterKey = $env:OPENROUTER_API_KEY
$previousOpenAiKey = $env:OPENAI_API_KEY

try {
    $env:GROQ_API_KEY = "[REDACTED]"
    $env:OPENROUTER_API_KEY = "[REDACTED]"
    $env:OPENAI_API_KEY = "[REDACTED]"

    & docker compose -f $FilePath config
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    if ($null -ne $previousGroqKey) {
        $env:GROQ_API_KEY = $previousGroqKey
    }
    else {
        Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
    }

    if ($null -ne $previousOpenRouterKey) {
        $env:OPENROUTER_API_KEY = $previousOpenRouterKey
    }
    else {
        Remove-Item Env:OPENROUTER_API_KEY -ErrorAction SilentlyContinue
    }

    if ($null -ne $previousOpenAiKey) {
        $env:OPENAI_API_KEY = $previousOpenAiKey
    }
    else {
        Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    }
}
