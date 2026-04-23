from datetime import datetime

from pydantic import BaseModel


class CaseActorRef(BaseModel):
    id: int
    platform: str | None = None
    handle: str | None = None
    display_name: str | None = None


class CaseCreateForActorRequest(BaseModel):
    actor_id: int
    title: str | None = None


class CaseStatusUpdateRequest(BaseModel):
    status: str


class CaseResponse(BaseModel):
    id: int
    title: str
    actor_id: int
    owner_id: int
    status: str
    created_at: datetime | None = None
    actor: CaseActorRef | None = None


class CaseListResponse(BaseModel):
    status: str = "ok"
    count: int
    items: list[CaseResponse]


class CaseDetailResponse(BaseModel):
    status: str = "ok"
    case: CaseResponse
    posts: list[dict] = []
    post_count: int = 0
