# Zipline Audit API - Optimized Local FastAPI Version

This version reduces token cost by moving deterministic normalization into Python:

- Ghana phone normalization
- Facility suffix normalization
- Medical item synonym normalization
- OSU item normalization
- Zero-loaded fulfilment hints

The model receives a smaller instruction block plus normalized context.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## Test

```bash
curl -X POST http://localhost:8000/audit \
  -H "Content-Type: application/json" \
  -H "x-api-key: local-dev-key" \
  -d '{
    "whatsappMessage": "Please send 10 OPV to Kade Health Center. Phone 0244123456",
    "fulfillmentConfirmation": "Kade HC, +233244123456, OPV 0/10",
    "osuItems": ["OPV"]
  }'
```
