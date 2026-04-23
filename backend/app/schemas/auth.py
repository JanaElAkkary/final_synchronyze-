from datetime import datetime

from pydantic import BaseModel


class RegisterRequest(BaseModel):
    full_name: str
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class AnalystPublic(BaseModel):
    id: int
    full_name: str
    username: str
    role: str
    avatar_key: str | None = None
    created_at: datetime | None = None


class AuthResponse(BaseModel):
    status: str = "ok"
    token: str
    analyst: AnalystPublic


class MeResponse(BaseModel):
    status: str = "ok"
    analyst: AnalystPublic


class ProfileUpdateRequest(BaseModel):
    full_name: str
    username: str
    avatar_key: str | None = None
