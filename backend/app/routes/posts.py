from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Account, Post, PlatformEnum, Task
from backend.app.services.case_service import get_or_create_case_for_actor


router = APIRouter()


@router.post("/capture")
def capture_post(payload: dict, db: Session = Depends(get_db)):
    platform = payload.get("platform")
    handle = payload.get("handle")
    display_name = payload.get("display_name")
    platform_post_id = payload.get("platform_post_id")
    url = payload.get("url")
    published_at = payload.get("published_at")
    
    # Defensive raw_text mapping
    raw_text = payload.get("raw_text")
    if not raw_text:
        raw_text = payload.get("text")
    if not raw_text:
        raw_text = payload.get("caption")
    if not raw_text:
        raw_text = payload.get("content")
    if not raw_text:
        raw_text = "NO_TEXT | " + (url or "no_url")

    raw_payload = payload.get("raw_payload")
    captured_at = payload.get("captured_at")

    if platform is None or handle is None or platform_post_id is None:
        raise HTTPException(status_code=400, detail="platform, handle, and platform_post_id are required")

    try:
        platform_enum = PlatformEnum(platform)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid platform")

    account = (
        db.query(Account)
        .filter(Account.platform == platform_enum)
        .filter(Account.handle == handle)
        .first()
    )

    if account is None:
        account = Account(
            platform=platform_enum,
            handle=handle,
            display_name=display_name,
        )
        db.add(account)
        db.flush()

    # Link to investigation Case if active
    # We search for a pending/in_progress investigate_user task for this handle
    task = db.query(Task).filter(
        Task.type == "investigate_user",
        Task.platform == platform,
        Task.target.ilike(f"%{handle}%"),
        Task.status.in_(["pending", "in_progress"])
    ).first()

    if task:
        # Owner mapping logic
        # If created_by is a digit, it's the analyst ID. 
        # Fallback to ID 1 for dev/unknown contexts.
        owner_id = 1
        if task.created_by and task.created_by.isdigit():
            owner_id = int(task.created_by)
        
        # Note: We don't have current_user auth context here easily without refactoring
        # but the task already stores who created it.
        try:
            get_or_create_case_for_actor(db, account.id, owner_id)
        except Exception as e:
            # Don't fail the post capture if case creation fails, but log it
            print(f"FAILED TO AUTO-CREATE CASE: {e}")

    post = (
        db.query(Post)
        .filter(Post.platform == platform_enum)
        .filter(Post.platform_post_id == platform_post_id)
        .first()
    )

    if post is not None:
        # If existing post has no published_at, but we have one now, update it
        if not post.published_at and published_at:
            try:
                post.published_at = datetime.fromisoformat(published_at)
                db.add(post)
                db.commit()
            except (TypeError, ValueError):
                pass

        return {
            "status": "duplicate",
            "post_id": post.id,
            "deduped": True,
            "account_id": account.id,
        }

    captured_dt = None
    if captured_at is not None:
        try:
            captured_dt = datetime.fromisoformat(captured_at)
        except (TypeError, ValueError):
            captured_dt = None

    published_dt = None
    if published_at is not None:
        try:
            published_dt = datetime.fromisoformat(published_at)
        except (TypeError, ValueError):
            published_dt = None

    post = Post(
        account_id=account.id,
        platform=platform_enum,
        platform_post_id=platform_post_id,
        url=url,
        raw_text=raw_text,
        raw_payload=raw_payload,
        captured_at=captured_dt,
        published_at=published_dt,
    )
    db.add(post)
    db.flush()
    db.commit()

    return {
        "status": "saved",
        "post_id": post.id,
        "deduped": False,
        "account_id": account.id,
    }
