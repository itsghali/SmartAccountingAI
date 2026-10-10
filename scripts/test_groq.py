import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

client = Groq(
    api_key=os.environ.get("GROQ_API_KEY"),
)

try:
    chat_completion = client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": "Return a JSON object with a single key 'status' and value 'ok'",
            }
        ],
        model=os.environ.get("GROQ_MODEL", "llama3-8b-8192"),
        response_format={"type": "json_object"},
    )
    print("Success:")
    print(chat_completion.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")
