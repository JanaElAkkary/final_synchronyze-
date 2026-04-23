from datetime import timedelta, datetime
import math

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.app.core.security import decode_access_token
from backend.app.database import get_db
from backend.app.models import Account, Post, PostAnalysis, CoordinatedGroup, Alert, Case, AnalystUser
from backend.app.schemas.cases import (
    CaseCreateForActorRequest,
    CaseListResponse,
    CaseResponse,
    CaseDetailResponse,
    CaseStatusUpdateRequest,
)
from backend.app.models.trending_item import TrendingItem
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import date


router = APIRouter()

bearing_scheme = HTTPBearer(auto_error=False)


def _ensure_trending_items_table(db: Session) -> None:
    """Create the local dev trending table if migrations have not been run."""
    bind = db.get_bind()
    TrendingItem.__table__.create(bind=bind, checkfirst=True)


def _get_current_user(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearing_scheme),
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


def _case_to_response(case: Case, actor: Account | None = None) -> CaseResponse:
    actor_obj = actor or case.actor
    actor_ref = None
    if actor_obj is not None:
        actor_ref = {
            "id": actor_obj.id,
            "platform": actor_obj.platform.value if actor_obj.platform else None,
            "handle": actor_obj.handle,
            "display_name": actor_obj.display_name,
        }
    return CaseResponse(
        id=case.id,
        title=case.title,
        actor_id=case.actor_id,
        owner_id=case.owner_id,
        status=case.status,
        created_at=case.created_at,
        actor=actor_ref,
    )


@router.get("/cases/me", response_model=CaseListResponse)
def get_my_cases(
    db: Session = Depends(get_db),
    current_user: AnalystUser = Depends(_get_current_user),
):
    rows = (
        db.query(Case, Account)
        .join(Account, Case.actor_id == Account.id)
        .filter(Case.owner_id == current_user.id)
        .order_by(Case.created_at.desc())
        .all()
    )

    items = []
    for case, actor in rows:
        items.append(_case_to_response(case, actor))

    return {"status": "ok", "count": len(items), "items": items}


@router.get("/cases/{case_id}", response_model=CaseDetailResponse)
def get_case_detail(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: AnalystUser = Depends(_get_current_user),
    limit: int = 100,
    model_version: str = "tfidf_lr_v1",
):
    row = (
        db.query(Case, Account)
        .join(Account, Case.actor_id == Account.id)
        .filter(Case.id == case_id)
        .filter(Case.owner_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")

    case, account = row
    
    # Fetch Posts (reusing timeline logic)
    posts_query = (
        db.query(Post)
        .filter(Post.account_id == account.id)
        .order_by(Post.captured_at.desc(), Post.created_at.desc())
        .limit(limit)
    )
    posts = posts_query.all()
    total_posts = db.query(Post).filter(Post.account_id == account.id).count()

    items = []
    for post in posts:
        analysis = (
            db.query(PostAnalysis)
            .filter(PostAnalysis.post_id == post.id)
            .filter(PostAnalysis.model_version == model_version)
            .order_by(PostAnalysis.created_at.desc())
            .first()
        )

        analysis_data = None
        if analysis:
            analysis_data = {
                "clean_text": analysis.clean_text,
                "predicted_label": analysis.predicted_label,
                "confidence": analysis.confidence,
                "topic_vector": analysis.topic_vector,
                "model_version": analysis.model_version,
            }

        items.append({
            "post_id": post.id,
            "platform": post.platform.value,
            "platform_post_id": post.platform_post_id,
            "url": post.url,
            "raw_text": post.raw_text,
            "captured_at": post.captured_at,
            "published_at": post.published_at,
            "created_at": post.created_at,
            "analysis": analysis_data,
        })

    return CaseDetailResponse(
        status="ok",
        case=_case_to_response(case, account),
        posts=items,
        post_count=total_posts
    )


@router.delete("/cases/{case_id}")
def delete_case(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: AnalystUser = Depends(_get_current_user),
):
    case = (
        db.query(Case)
        .filter(Case.id == case_id)
        .filter(Case.owner_id == current_user.id)
        .first()
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    db.delete(case)
    db.commit()

    return {"status": "ok", "deleted": case_id}


@router.post("/cases/open", response_model=CaseResponse)
def open_case_for_actor(
    body: CaseCreateForActorRequest,
    db: Session = Depends(get_db),
    current_user: AnalystUser = Depends(_get_current_user),
):
    actor = db.query(Account).filter(Account.id == body.actor_id).first()
    if actor is None:
        raise HTTPException(status_code=404, detail="Actor not found")

    existing = (
        db.query(Case)
        .filter(Case.owner_id == current_user.id)
        .filter(Case.actor_id == actor.id)
        .filter(Case.status != "closed")
        .order_by(Case.created_at.desc())
        .first()
    )
    if existing is not None:
        return _case_to_response(existing, actor)

    title = (body.title or "").strip()
    if not title:
        if actor.handle:
            title = f"Case: @{actor.handle}"
        else:
            title = f"Case: Actor #{actor.id}"

    case = Case(
        title=title,
        actor_id=actor.id,
        owner_id=current_user.id,
        status="open",
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    return _case_to_response(case, actor)


@router.patch("/cases/{case_id}/status", response_model=CaseResponse)
def update_case_status(
    case_id: int,
    body: CaseStatusUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AnalystUser = Depends(_get_current_user),
):
    case = (
        db.query(Case)
        .filter(Case.id == case_id)
        .filter(Case.owner_id == current_user.id)
        .first()
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    new_status = (body.status or "").strip().lower()
    if new_status == "active":
        new_status = "open"

    if new_status not in {"open", "closed"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    case.status = new_status
    db.add(case)
    db.commit()
    db.refresh(case)

    actor = db.query(Account).filter(Account.id == case.actor_id).first()
    return _case_to_response(case, actor)


@router.get("/actor/{account_id}/timeline")
def get_actor_timeline(
    account_id: int,
    limit: int = 50,
    model_version: str = "tfidf_lr_v1",
    db: Session = Depends(get_db),
):
    if limit <= 0:
        limit = 50

    account = db.query(Account).filter(Account.id == account_id).first()

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    posts_query = (
        db.query(Post)
        .filter(Post.account_id == account.id)
        .order_by(Post.published_at.desc(), Post.captured_at.desc(), Post.created_at.desc())
        .limit(limit)
    )

    posts = posts_query.all()

    items = []

    for post in posts:
        analysis = (
            db.query(PostAnalysis)
            .filter(PostAnalysis.post_id == post.id)
            .filter(PostAnalysis.model_version == model_version)
            .first()
        )

        if analysis is None:
            analysis_data = None
        else:
            analysis_data = {
                "clean_text": analysis.clean_text,
                "predicted_label": analysis.predicted_label,
                "confidence": analysis.confidence,
                "topic_vector": analysis.topic_vector,
                "model_version": analysis.model_version,
            }

        item = {
            "post_id": post.id,
            "platform": post.platform.value,
            "platform_post_id": post.platform_post_id,
            "url": post.url,
            "raw_text": post.raw_text,
            "captured_at": post.captured_at,
            "published_at": post.published_at,
            "created_at": post.created_at,
            "analysis": analysis_data,
        }

        items.append(item)

    return {
        "status": "ok",
        "account_id": account.id,
        "count": len(items),
        "items": items,
    }


@router.get("/actor/{account_id}/drift")
def get_actor_drift(
    account_id: int,
    model_version: str = "tfidf_lr_v1",
    weeks: int = 12,
    db: Session = Depends(get_db),
):
    account = db.query(Account).filter(Account.id == account_id).first()

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    query = (
        db.query(Post, PostAnalysis)
        .join(PostAnalysis, Post.id == PostAnalysis.post_id)
        .filter(Post.account_id == account.id)
        .filter(PostAnalysis.model_version == model_version)
    )

    rows = query.all()

    weekly = {}

    for post, analysis in rows:
        vector = analysis.topic_vector
        if vector is None:
            continue
        if not isinstance(vector, list):
            continue
        if len(vector) == 0:
            continue

        dt = post.published_at
        if dt is None:
            dt = post.captured_at
        if dt is None:
            dt = post.created_at
        if dt is None:
            continue

        date_value = dt.date()
        week_start_date = date_value - timedelta(days=date_value.weekday())
        week_key = week_start_date.isoformat()

        if week_key not in weekly:
            sums = []
            index = 0
            while index < len(vector):
                sums.append(0.0)
                index = index + 1
            weekly[week_key] = {"sum": sums, "count": 0}

        info = weekly[week_key]
        sums = info["sum"]

        index = 0
        while index < len(vector):
            try:
                value = float(vector[index])
            except Exception:
                value = 0.0
            sums[index] = sums[index] + value
            index = index + 1

        info["count"] = info["count"] + 1

    week_keys = list(weekly.keys())
    week_keys.sort()

    avg_weeks = []

    for key in week_keys:
        info = weekly[key]
        count = info["count"]
        if count == 0:
            continue

        sums = info["sum"]
        avg_vector = []

        index = 0
        while index < len(sums):
            avg_value = sums[index] / float(count)
            avg_vector.append(avg_value)
            index = index + 1

        avg_weeks.append({"week_start": key, "vector": avg_vector})

    if len(avg_weeks) < 2:
        return {
            "status": "ok",
            "account_id": account.id,
            "model_version": model_version,
            "points": [],
            "max_drift": None,
        }

    drift_points = []

    index = 1
    while index < len(avg_weeks):
        prev = avg_weeks[index - 1]
        curr = avg_weeks[index]

        a = prev["vector"]
        b = curr["vector"]

        length = len(a)
        if len(b) < length:
            length = len(b)

        dot = 0.0
        norm_a = 0.0
        norm_b = 0.0

        i = 0
        while i < length:
            va = float(a[i])
            vb = float(b[i])
            dot = dot + va * vb
            norm_a = norm_a + va * va
            norm_b = norm_b + vb * vb
            i = i + 1

        if norm_a <= 0.0 or norm_b <= 0.0:
            sim = 0.0
        else:
            sim = dot / (math.sqrt(norm_a) * math.sqrt(norm_b))

        drift_value = 1.0 - sim

        drift_points.append(
            {"week_start": curr["week_start"], "drift": drift_value}
        )

        index = index + 1

    if weeks is None or weeks <= 0:
        weeks = 12

    if len(drift_points) > weeks:
        drift_points = drift_points[len(drift_points) - weeks :]

    max_drift = None

    for point in drift_points:
        if max_drift is None:
            max_drift = {
                "week_start": point["week_start"],
                "drift": point["drift"],
            }
        else:
            if point["drift"] > max_drift["drift"]:
                max_drift = {
                    "week_start": point["week_start"],
                    "drift": point["drift"],
                }

    return {
        "status": "ok",
        "account_id": account.id,
        "model_version": model_version,
        "points": drift_points,
        "max_drift": max_drift,
    }


@router.get("/coordination")
def get_coordination(
    limit: int = 50,
    week_start: str | None = None,
    db: Session = Depends(get_db),
):
    if limit <= 0:
        limit = 50

    query = db.query(CoordinatedGroup)

    if week_start is not None:
        try:
            date_value = datetime.strptime(week_start, "%Y-%m-%d").date()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid week_start format")
        query = query.filter(CoordinatedGroup.week_start == date_value)

    query = query.order_by(
        CoordinatedGroup.week_start.desc(),
        CoordinatedGroup.created_at.desc(),
    ).limit(limit)

    groups = query.all()

    # Collect all account IDs
    all_account_ids = set()
    for group in groups:
        if group.member_account_ids:
            # member_account_ids is a JSON array of ints
            for aid in group.member_account_ids:
                all_account_ids.add(aid)
    
    # Fetch accounts
    accounts_map = {}
    if all_account_ids:
        accounts = db.query(Account).filter(Account.id.in_(all_account_ids)).all()
        for acc in accounts:
            accounts_map[acc.id] = acc.handle

    items = []

    for group in groups:
        # Resolve actor names
        actor_names = []
        if group.member_account_ids:
            for aid in group.member_account_ids:
                if aid in accounts_map:
                    actor_names.append(accounts_map[aid])
                else:
                    actor_names.append(f"Unknown ({aid})")

        item = {
            "id": group.id,
            "week_start": group.week_start,
            "from_label": group.from_label,
            "to_label": group.to_label,
            "similarity": group.similarity,
            "member_account_ids": group.member_account_ids,
            "actors": actor_names,
            "details": group.details,
            "created_at": group.created_at,
        }
        items.append(item)

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
    }


@router.get("/alerts")
def get_alerts(
    limit: int = 50,
    alert_type: str | None = None,
    is_read: bool | None = None,
    db: Session = Depends(get_db),
):
    if limit <= 0:
        limit = 50

    query = db.query(Alert)

    if alert_type is not None:
        query = query.filter(Alert.alert_type == alert_type)

    if is_read is not None:
        query = query.filter(Alert.is_read == is_read)

    query = query.order_by(Alert.created_at.desc()).limit(limit)

    alerts = query.all()

    items = []
    actor_cache = {}
    group_cache = {}

    for alert in alerts:
        # 1. Resolve Actor
        related_actor = None
        act_id = alert.account_id
        
        # Fallback: parse from message if not in column
        if act_id is None and alert.message:
            marker = "Actor ID: "
            if marker in alert.message:
                parts = alert.message.split(marker)
                if len(parts) > 1:
                    # simple digit parse
                    digits = ""
                    for char in parts[1]:
                        if char.isdigit():
                            digits += char
                        else:
                            break
                    if len(digits) > 0:
                        try:
                            act_id = int(digits)
                        except:
                            pass

        if act_id is not None:
            if act_id in actor_cache:
                related_actor = actor_cache[act_id]
            else:
                act = db.query(Account).filter(Account.id == act_id).first()
                if act:
                    platform_val = None
                    if act.platform:
                        platform_val = act.platform.value
                    
                    related_actor = {
                        "id": act.id,
                        "platform": platform_val,
                        "handle": act.handle,
                        "display_name": act.display_name
                    }
                actor_cache[act_id] = related_actor

        # 2. Resolve Group
        related_group = None
        grp_id = alert.coordinated_group_id
        
        if grp_id is not None:
            if grp_id in group_cache:
                related_group = group_cache[grp_id]
            else:
                grp = db.query(CoordinatedGroup).filter(CoordinatedGroup.id == grp_id).first()
                if grp:
                    related_group = {"id": grp.id}
                group_cache[grp_id] = related_group

        item = {
            "id": alert.id,
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "account_id": alert.account_id,
            "coordinated_group_id": alert.coordinated_group_id,
            "message": alert.message,
            "payload": alert.payload,
            "is_read": alert.is_read,
            "created_at": alert.created_at,
            "related_actor": related_actor,
            "related_group": related_group,
        }
        items.append(item)

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
    }


@router.post("/alerts/mark_all_read")
def mark_all_alerts_read(db: Session = Depends(get_db)):
    # Update all alerts where is_read is not True (False or None)
    # Using false equality check which handles 0/False. Handling None needs is_(None) or similar if not covered.
    # Simple approach: Update ALL alerts to read=True.
    
    # Check for unread
    query = db.query(Alert).filter(Alert.is_read != True)
    count = query.update({Alert.is_read: True}, synchronize_session=False)
    db.commit()
    
    return {"status": "ok", "updated": count}


@router.get("/actors/{actor_id}")
def get_actor_detail(actor_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == actor_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Actor not found")

    platform_value = account.platform.value if account.platform else None
    post_stats = (
        db.query(
            func.count(Post.id).label("post_count"),
            func.max(func.coalesce(Post.captured_at, Post.created_at)).label("last_seen"),
        )
        .filter(Post.account_id == account.id)
        .one()
    )
    analyzed_count = (
        db.query(func.count(func.distinct(PostAnalysis.post_id)))
        .join(Post, Post.id == PostAnalysis.post_id)
        .filter(Post.account_id == account.id)
        .filter(PostAnalysis.model_version == "tfidf_lr_v1")
        .scalar()
    )

    return {
        "status": "ok",
        "actor": {
            "id": account.id,
            "platform": platform_value,
            "handle": account.handle,
            "display_name": account.display_name,
            "created_at": account.created_at,
            "post_count": post_stats.post_count or 0,
            "analyzed_count": analyzed_count or 0,
            "last_seen": post_stats.last_seen,
        }
    }


@router.get("/actors")
def get_actors(
    page: int = 1,
    limit: int = 100,
    search: str | None = None,
    platform: str | None = None,
    db: Session = Depends(get_db),
):
    # Validate/sanitize page and limit
    if page < 1:
        page = 1
    if limit <= 0:
        limit = 100
    if limit > 1000:
        # Cap limit but keep it high enough for legacy calls
        limit = 1000

    # 1. Platform normalization (x -> twitter)
    platform_filter = platform
    if platform_filter:
        platform_filter = platform_filter.lower().strip()
        if platform_filter == "x":
            platform_filter = "twitter"
        if platform_filter == "all":
            platform_filter = None

    # 2. Subquery for Post stats (post_count, last_seen)
    # Using MAX(COALESCE(captured_at, created_at)) as requested
    post_stats_sub = (
        db.query(
            Post.account_id,
            func.count(Post.id).label("post_count"),
            func.max(func.coalesce(Post.captured_at, Post.created_at)).label("last_seen"),
        )
        .group_by(Post.account_id)
        .subquery()
    )

    # 3. Subquery for Analysis stats (analyzed_count)
    analysis_stats_sub = (
        db.query(
            Post.account_id,
            func.count(func.distinct(PostAnalysis.post_id)).label("analyzed_count"),
        )
        .join(PostAnalysis, Post.id == PostAnalysis.post_id)
        .filter(PostAnalysis.model_version == "tfidf_lr_v1")
        .group_by(Post.account_id)
        .subquery()
    )

    # 4. Main Query with filtering
    query = db.query(
        Account,
        post_stats_sub.c.post_count,
        post_stats_sub.c.last_seen,
        analysis_stats_sub.c.analyzed_count,
    ).outerjoin(post_stats_sub, Account.id == post_stats_sub.c.account_id) \
     .outerjoin(analysis_stats_sub, Account.id == analysis_stats_sub.c.account_id)

    if platform_filter:
        query = query.filter(Account.platform == platform_filter)

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                Account.handle.ilike(search_pattern),
                Account.display_name.ilike(search_pattern),
            )
        )

    # 5. Total count for pagination
    total_count = query.count()
    total_pages = math.ceil(total_count / limit) if total_count > 0 else 0

    # 6. Pagination and ordering (stable order by created_at)
    query = query.order_by(Account.created_at.desc())
    query = query.offset((page - 1) * limit).limit(limit)

    rows = query.all()

    items = []
    for account, post_count, last_seen, analyzed_count in rows:
        platform_value = account.platform.value if account.platform else None

        item = {
            "id": account.id,
            "platform": platform_value,
            "handle": account.handle,
            "display_name": account.display_name,
            "created_at": account.created_at,
            "post_count": post_count or 0,
            "analyzed_count": analyzed_count or 0,
            "last_seen": last_seen,
        }
        items.append(item)

    return {
        "status": "ok",
        "count": len(items),
        "total": total_count,
        "page": page,
        "limit": limit,
        "pages": total_pages,
        "items": items,
    }


class TrendingItemCreate(BaseModel):
    rank: int
    label: str
    item_type: Optional[str] = "unknown"
    raw_payload: Optional[Dict] = None


class TrendingSnapshotRequest(BaseModel):
    platform: str
    category: str
    source_url: Optional[str] = None
    task_id: Optional[int] = None
    snapshot_date: Optional[date] = None
    items: List[TrendingItemCreate]


@router.post("/trending/snapshot")
def save_trending_snapshot(
    body: TrendingSnapshotRequest,
    db: Session = Depends(get_db)
):
    _ensure_trending_items_table(db)

    # 1. Validation
    platform = body.platform.lower().strip()
    if platform == 'x':
        platform = 'twitter'
    
    category = body.category.lower().strip()
    if category not in ["trending", "news"]:
        raise HTTPException(status_code=400, detail="Invalid category. Must be 'trending' or 'news'")
    
    snapshot_date = body.snapshot_date or datetime.utcnow().date()
    
    # 2. Normalization Helper
    def normalize_label(label: str) -> str:
        if not label:
            return ""
        # trim, lowercase, collapse internal whitespace
        val = label.strip().lower()
        val = " ".join(val.split())
        return val

    # 3. Process Items
    saved_count = 0
    skipped_count = 0
    skipped_reasons = []
    today_items = []
    seen_ranks = set()
    
    for item_data in body.items:
        rank = item_data.rank
        if rank < 1 or rank > 35:
            skipped_count += 1
            skipped_reasons.append({"rank": rank, "reason": "invalid_rank", "label": item_data.label})
            continue

        raw_data = item_data.raw_payload if isinstance(item_data.raw_payload, dict) else {}
        raw_lines = raw_data.get("lines", [])
        raw_context = raw_data.get("context", "")
        raw_text = " ".join([str(raw_context)] + [str(line) for line in raw_lines]).lower()
        if "promoted by" in raw_text or "promoted" == raw_text.strip():
            skipped_count += 1
            skipped_reasons.append({"rank": rank, "reason": "promoted_item", "label": item_data.label})
            continue

        if rank in seen_ranks:
            skipped_count += 1
            skipped_reasons.append({"rank": rank, "reason": "duplicate_rank", "label": item_data.label})
            continue
            
        # Validate Label
        label = item_data.label
        if not is_valid_trend_label(label):
            # Try to recover from raw_payload
            context = raw_data.get("context", "")
            if is_valid_trend_label(context):
                label = context
            else:
                lines = raw_data.get("lines", [])
                for line in lines:
                    if is_valid_trend_label(line):
                        label = line
                        break
            
            # Still invalid? Skip.
            if not is_valid_trend_label(label):
                skipped_count += 1
                skipped_reasons.append({"rank": rank, "reason": "invalid_label", "label": item_data.label})
                continue

        # Validate item_type (Metadata)
        item_type = item_data.item_type or "trending"
        if item_type.isdigit() or item_type == "-" or item_type == "trending":
             # Use the original label as item_type if it was actually metadata
             if not is_valid_trend_label(item_data.label):
                 item_type = item_data.label

        norm = normalize_label(label)
        if not norm:
            skipped_count += 1
            skipped_reasons.append({"rank": rank, "reason": "empty_normalization", "label": label})
            continue
            
        # Upsert logic (Delete existing rank if present for same day/cat)
        db.query(TrendingItem).filter(
            TrendingItem.platform == platform,
            TrendingItem.category == category,
            TrendingItem.snapshot_date == snapshot_date,
            TrendingItem.rank == rank
        ).delete()
        
        ti = TrendingItem(
            platform=platform,
            category=category,
            snapshot_date=snapshot_date,
            rank=rank,
            label=label,
            normalized_label=norm,
            item_type=item_type,
            source_url=body.source_url,
            task_id=body.task_id,
            raw_payload=item_data.raw_payload
        )
        db.add(ti)
        today_items.append(ti)
        saved_count += 1
        seen_ranks.add(rank)
    
    db.commit()

    # 4. Alerting Logic
    warnings = []
    alerts_created = 0
    
    # 4.a Fetch Previous Snapshot
    prev_snapshot_date = db.query(func.max(TrendingItem.snapshot_date)).filter(
        TrendingItem.platform == platform,
        TrendingItem.category == category,
        TrendingItem.snapshot_date < snapshot_date
    ).scalar()
    
    if not prev_snapshot_date:
        warnings.append("no_previous_snapshot_for_comparison")
        
    if saved_count < 10:
        warnings.append("snapshot_too_small_for_alerting")
    else:
        if saved_count < 30:
            warnings.append("partial_snapshot")
            
        if prev_snapshot_date:
            # Load previous labels
            rows = db.query(TrendingItem.normalized_label).filter(
                TrendingItem.platform == platform,
                TrendingItem.category == category,
                TrendingItem.snapshot_date == prev_snapshot_date
            ).all()
            prev_labels = {r[0] for r in rows}
            
            # 4.b Compare and Alert
            for item in today_items:
                # If new (not in previous top 30)
                if item.normalized_label not in prev_labels:
                    # Severity
                    severity = "medium"
                    if item.rank <= 10:
                        severity = "high"
                    elif item.rank == 30:
                        severity = "low"
                    
                    # Deduplication Key
                    snapshot_date_str = snapshot_date.strftime("%Y-%m-%d") if hasattr(snapshot_date, "strftime") else str(snapshot_date)
                    event_key = f"{platform}:{category}:{snapshot_date_str}:new-entry:{item.normalized_label}"
                    
                    # Check for existing alert
                    existing_alerts = db.query(Alert).filter(Alert.alert_type == "trend_new_entry").all()
                    existing_alert = next((a for a in existing_alerts if a.payload and a.payload.get("event_key") == event_key), None)
                    
                    if not existing_alert:
                        msg = f"New X {category} entry: {item.label} entered {category.capitalize()} at rank #{item.rank}"
                        alert_payload = {
                            "event_key": event_key,
                            "platform": platform,
                            "category": category,
                            "snapshot_date": str(snapshot_date),
                            "rank": item.rank,
                            "label": item.label,
                            "normalized_label": item.normalized_label,
                            "item_type": item.item_type,
                            "source_url": item.source_url,
                            "previous_snapshot_date": str(prev_snapshot_date),
                        }
                        
                        alert = Alert(
                            alert_type="trend_new_entry",
                            severity=severity,
                            message=msg,
                            payload=alert_payload
                        )
                        db.add(alert)
                        alerts_created += 1
    
    db.commit()

    return {
        "status": "ok",
        "saved_count": saved_count,
        "skipped_count": skipped_count,
        "skipped_reasons": skipped_reasons,
        "platform": platform,
        "category": category,
        "snapshot_date": str(snapshot_date),
        "alerts_created": alerts_created,
        "warnings": warnings
    }


def is_valid_trend_label(label: str) -> bool:
    if not label:
        return False
    val = label.strip()
    # 1. Reject pure numbers
    if val.isdigit():
        return False
    # 2. Reject dot
    if val == "·":
        return False
    # 3. Reject generic metadata
    low = val.lower()
    generic = [
        "trending", "show more", "posts", "explore", 
        "see new posts", "global trending", "the most popular posts",
        "what's happening"
    ]
    if low in generic:
        return False
    
    # 4. Reject metadata patterns unless it is a hashtag
    # (e.g. "Trending in Egypt", "Sports · Trending")
    if not val.startswith("#") and ("trending" in low or "·" in low):
        return False

    # 5. Reject "Trending with ..."
    if low.startswith("trending with"):
        return False
    # 6. Reject post counts (e.g. "10K posts", "1,234 posts", "50 posts")
    if "posts" in low:
        if any(c.isdigit() for c in val):
            return False
    # 7. Minimum length
    if len(val) < 2:
        return False
    return True


@router.get("/trending/latest")
def get_trending_latest(
    platform: str = "twitter",
    category: str = "trending",
    db: Session = Depends(get_db)
):
    # 1. Fetch latest snapshot_date for platform/category
    latest_date = db.query(func.max(TrendingItem.snapshot_date)).filter(
        TrendingItem.platform == platform,
        TrendingItem.category == category
    ).scalar()
    
    if not latest_date:
        return {
            "status": "ok",
            "platform": platform,
            "category": category,
            "snapshot_date": None,
            "previous_snapshot_date": None,
            "count": 0,
            "partial": False,
            "warnings": [],
            "items": []
        }
    
    # 2. Fetch previous snapshot_date before latest
    previous_date = db.query(func.max(TrendingItem.snapshot_date)).filter(
        TrendingItem.platform == platform,
        TrendingItem.category == category,
        TrendingItem.snapshot_date < latest_date
    ).scalar()
    
    # 3. Fetch latest TrendingItem rows
    latest_items = db.query(TrendingItem).filter(
        TrendingItem.platform == platform,
        TrendingItem.category == category,
        TrendingItem.snapshot_date == latest_date
    ).order_by(TrendingItem.rank.asc()).all()
    
    # 4. Fetch previous TrendingItem rows to build rank lookup
    prev_lookup = {}
    if previous_date:
        prev_rows = db.query(TrendingItem.normalized_label, TrendingItem.rank).filter(
            TrendingItem.platform == platform,
            TrendingItem.category == category,
            TrendingItem.snapshot_date == previous_date
        ).all()
        prev_lookup = {r.normalized_label: r.rank for r in prev_rows}
        
    # 5. Fetch alerts for latest snapshot date to map severity
    # Format: "{platform}:{category}:{snapshot_date}:new-entry:{normalized_label}"
    latest_date_str = latest_date.strftime("%Y-%m-%d") if hasattr(latest_date, "strftime") else str(latest_date)
    alert_prefix = f"{platform}:{category}:{latest_date_str}:new-entry:"
    
    # Fetch candidate alerts (trend_new_entry) for this platform/category
    # We filter by message content as a fallback or payload if we can, 
    # but Python-side payload filtering is more robust across dialects.
    candidate_alerts = db.query(Alert).filter(
        Alert.alert_type == "trend_new_entry"
    ).all()
    
    severity_map = {}
    for alert in candidate_alerts:
        if alert.payload and "event_key" in alert.payload:
            ek = alert.payload["event_key"]
            if ek.startswith(alert_prefix):
                norm_label = ek.replace(alert_prefix, "")
                severity_map[norm_label] = alert.severity

    # 6. Compute movement and build response items
    items = []
    for item in latest_items:
        prev_rank = prev_lookup.get(item.normalized_label)
        
        movement = "same"
        movement_delta = 0
        
        if prev_rank is None:
            movement = "new"
            movement_delta = None
        elif item.rank < prev_rank:
            movement = "up"
            movement_delta = prev_rank - item.rank
        elif item.rank > prev_rank:
            movement = "down"
            movement_delta = prev_rank - item.rank # will be negative
            
        display_label = item.label
        display_item_type = item.item_type
        
        # Recovery Logic for Dirty Data (Metadata saved as Label)
        if not is_valid_trend_label(display_label):
            raw_data = item.raw_payload if isinstance(item.raw_payload, dict) else {}
            # Try to recover from context
            context = raw_data.get("context", "")
            if is_valid_trend_label(context):
                display_label = context
                if not display_item_type or display_item_type.isdigit() or display_item_type == "trending":
                    display_item_type = item.label
            else:
                # Try lines as last resort
                lines = raw_data.get("lines", [])
                for line in lines:
                    if is_valid_trend_label(line):
                        display_label = line
                        if not display_item_type or display_item_type.isdigit() or display_item_type == "trending":
                            display_item_type = item.label
                        break

        # Final Sanitization
        if not is_valid_trend_label(display_label):
            display_label = "-"
        
        if not display_item_type or display_item_type.isdigit() or display_item_type == "-":
            display_item_type = "-"

        # Category from DB or Request, fallback to "trending" if trash
        display_category = item.category or category
        if display_category.isdigit() or display_category == "-":
            display_category = category # use the safe route param
                
        items.append({
            "label": display_label,
            "normalized_label": item.normalized_label,
            "item_type": display_item_type,
            "category": display_category,
            "current_rank": item.rank,
            "previous_rank": prev_rank,
            "movement": movement,
            "movement_delta": movement_delta,
            "severity": severity_map.get(item.normalized_label),
            "snapshot_date": str(item.snapshot_date),
            "previous_snapshot_date": str(previous_date) if previous_date else None,
            "source_url": item.source_url
        })
        
    # 7. Partial snapshot logic and warnings
    count = len(items)
    partial = count < 30
    warnings = []
    
    if count < 10:
        warnings.append("snapshot_too_small_for_alerting")
    elif count < 30:
        warnings.append("partial_snapshot")
        
    return {
        "status": "ok",
        "platform": platform,
        "category": category,
        "snapshot_date": str(latest_date),
        "previous_snapshot_date": str(previous_date) if previous_date else None,
        "count": count,
        "partial": partial,
        "warnings": warnings,
        "items": items
    }
