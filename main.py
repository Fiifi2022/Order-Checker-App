import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI, APIStatusError, RateLimitError

from instructions import SYSTEM_INSTRUCTIONS
from normalizer import build_normalized_context
from schemas import AuditRequest, AuditResponse

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PROXY_API_KEY = os.getenv("PROXY_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing")

client = OpenAI(
    api_key=OPENAI_API_KEY,
    timeout=30,
    max_retries=0,
)

app = FastAPI(title="Zipline Audit API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later for your extension origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "zipline-audit-api",
        "model": OPENAI_MODEL,
    }


def verify_proxy_key(x_api_key: str | None):
    if PROXY_API_KEY and x_api_key != PROXY_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.post("/audit", response_model=AuditResponse)
def audit_order(
    payload: AuditRequest,
    x_api_key: str | None = Header(default=None),
):
    verify_proxy_key(x_api_key)

    context = build_normalized_context(
        whatsapp_message=payload.whatsappMessage,
        fulfillment_confirmation=payload.fulfillmentConfirmation,
        osu_items=payload.osuItems,
    )

    prompt = f"""
Compare the two messages below and return ONLY valid JSON matching the required audit schema.

Use both the raw text and normalized context.
The normalized context is only a helper. If raw text conflicts with normalized text, use the raw text and explain the ambiguity.

IMPORTANT:
- Facility names were intentionally NOT normalized by Python.
- Compare facility names using the raw messages and surrounding context.
- Do not assume facility type suffixes are interchangeable.
- Return JSON only. Do not wrap in markdown.

=== NORMALIZED CONTEXT ===
{json.dumps(context, ensure_ascii=False, indent=2)}

=== RAW WHATSAPP SOURCE MESSAGE ===
{payload.whatsappMessage}

=== RAW FULFILMENT RECIPIENT SYSTEM LOG ===
{payload.fulfillmentConfirmation}

=== ACTIVE OUT-OF-STOCK ITEMS ===
{json.dumps(context["normalized_osu_items"], ensure_ascii=False)}
"""

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_INSTRUCTIONS},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )

        content = response.choices[0].message.content

        if not content:
            raise HTTPException(
                status_code=500,
                detail="OpenAI returned an empty response",
            )

        parsed = json.loads(content)
        return AuditResponse.model_validate(parsed)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"OpenAI returned invalid JSON: {str(e)}",
        )

    except RateLimitError as e:
        error_text = str(e)
        if getattr(e, "response", None) is not None:
            try:
                error_text = e.response.text
            except Exception:
                pass

        raise HTTPException(
            status_code=429,
            detail=f"OpenAI rate/quota error: {error_text}",
        )

    except APIStatusError as e:
        error_text = str(e)
        if getattr(e, "response", None) is not None:
            try:
                error_text = e.response.text
            except Exception:
                pass

        raise HTTPException(
            status_code=e.status_code,
            detail=f"OpenAI API error: {error_text}",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))