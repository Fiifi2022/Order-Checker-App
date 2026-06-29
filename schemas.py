from typing import List, Literal
from pydantic import BaseModel, Field


class AuditRequest(BaseModel):
    whatsappMessage: str
    fulfillmentConfirmation: str
    osuItems: List[str] = []


class MetaField(BaseModel):
    whatsappValue: str
    fulfillmentValue: str
    status: Literal["match", "mismatch"]


class AuditItem(BaseModel):
    name: str
    category: Literal["Vaccine", "Medical Product", "Blood Product", "Consumable"]
    requested: str
    found: str
    status: Literal[
        "match",
        "quantity mismatch",
        "missing item",
        "extra item",
        "out of stock",
    ]
    action: str = ""


class AuditMeta(BaseModel):
    customerName: MetaField
    phone: MetaField
    facility: MetaField
    date: MetaField
    ordererName: MetaField
    facilityName: MetaField
    dropArea: MetaField
    district: MetaField
    deliveryTime: MetaField


class AuditResponse(BaseModel):
    confidence: int = Field(ge=0, le=100)
    verdict: str
    allMatch: bool
    issueCount: int
    items: List[AuditItem]
    meta: AuditMeta
    insights: List[str] = Field(min_length=2, max_length=4)
