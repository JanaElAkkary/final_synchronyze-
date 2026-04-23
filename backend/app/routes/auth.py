from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from backend.app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from backend.app.database import get_db
from backend.app.models.analyst_user import AnalystUser
from backend.app.schemas.auth import AnalystPublic, AuthResponse, LoginRequest, MeResponse, ProfileUpdateRequest, RegisterRequest


router = APIRouter(prefix="/auth")

bearer_scheme = HTTPBearer(auto_error=False)


def _parse_role(value: str | None) -> tuple[str, str | None]:
    if not value:
        return "analyst", None
    parts = value.split("|")
    base_role = (parts[0] or "analyst").strip() or "analyst"
    avatar_key: str | None = None
    for part in parts[1:]:
        item = (part or "").strip()
        if item.startswith("avatar="):
            avatar_key = item[len("avatar=") :].strip() or None
    return base_role, avatar_key


def _build_role(base_role: str, avatar_key: str | None) -> str:
    base = (base_role or "analyst").strip() or "analyst"
    key = (avatar_key or "").strip()
    if not key:
        return base
    return f"{base}|avatar={key}"


def _to_public(user: AnalystUser) -> AnalystPublic:
    base_role, avatar_key = _parse_role(user.role)
    return AnalystPublic(
        id=user.id,
        full_name=user.full_name,
        username=user.username,
        role=base_role,
        avatar_key=avatar_key,
        created_at=user.created_at,
    )


def _get_current_user(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AnalystUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        user_id = int(sub)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(AnalystUser).filter(AnalystUser.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


@router.post("/register", response_model=AuthResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    full_name = (body.full_name or "").strip()
    username = (body.username or "").strip()
    password = body.password or ""

    if not full_name:
        raise HTTPException(status_code=400, detail="full_name is required")
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if not password:
        raise HTTPException(status_code=400, detail="password is required")

    existing = db.query(AnalystUser).filter(AnalystUser.username == username).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="username already registered")

    user = AnalystUser(
        full_name=full_name,
        username=username,
        password_hash=hash_password(password),
        role=_build_role("analyst", "ink-01"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    base_role, avatar_key = _parse_role(user.role)
    token = create_access_token(
        subject=str(user.id),
        extra_claims={"username": user.username, "role": base_role, "avatar_key": avatar_key},
    )
    return AuthResponse(token=token, analyst=_to_public(user))


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    username = (body.username or "").strip()
    password = body.password or ""

    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required")

    user = db.query(AnalystUser).filter(AnalystUser.username == username).first()
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    base_role, avatar_key = _parse_role(user.role)
    token = create_access_token(
        subject=str(user.id),
        extra_claims={"username": user.username, "role": base_role, "avatar_key": avatar_key},
    )
    return AuthResponse(token=token, analyst=_to_public(user))


@router.get("/me", response_model=MeResponse)
def me(current_user: AnalystUser = Depends(_get_current_user)):
    return MeResponse(analyst=_to_public(current_user))


@router.put("/profile", response_model=AuthResponse)
def update_profile(
    body: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AnalystUser = Depends(_get_current_user),
):
    full_name = (body.full_name or "").strip()
    username = (body.username or "").strip()
    avatar_key = (body.avatar_key or "").strip() or None

    if not full_name:
        raise HTTPException(status_code=400, detail="full_name is required")
    if not username:
        raise HTTPException(status_code=400, detail="username is required")

    existing = (
        db.query(AnalystUser)
        .filter(AnalystUser.username == username)
        .filter(AnalystUser.id != current_user.id)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail="username already registered")

    base_role, _ = _parse_role(current_user.role)
    current_user.full_name = full_name
    current_user.username = username
    current_user.role = _build_role(base_role, avatar_key)
    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    base_role, avatar_key = _parse_role(current_user.role)
    token = create_access_token(
        subject=str(current_user.id),
        extra_claims={"username": current_user.username, "role": base_role, "avatar_key": avatar_key},
    )
    return AuthResponse(token=token, analyst=_to_public(current_user))
