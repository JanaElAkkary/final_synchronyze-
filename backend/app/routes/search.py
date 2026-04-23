from datetime import datetime, timedelta
import math
import re

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, func, null

from backend.app.database import get_db
from backend.app.models import Account, Post, PostAnalysis
from backend.app.models.enums import PlatformEnum

router = APIRouter()

@router.get("/posts")
def search_posts(
    q: str = Query(..., min_length=1),
    platform: str | None = None,
    topic: str | None = None,
    min_confidence: float | None = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    # Base query joining posts, accounts, and analysis
    query = (
        db.query(Post, Account, PostAnalysis)
        .join(Account, Post.account_id == Account.id)
        .outerjoin(PostAnalysis, Post.id == PostAnalysis.post_id)
        .filter(Post.raw_text.ilike(f"%{q}%"))
    )

    if platform and platform.lower() != "all":
        try:
            # Handle platform case insensitive
            plat_enum = None
            for p in PlatformEnum:
                if p.value.lower() == platform.lower():
                    plat_enum = p
                    break
            if plat_enum:
                query = query.filter(Account.platform == plat_enum)
        except Exception:
            pass
            
    if topic and topic.lower() != "all":
        query = query.filter(PostAnalysis.predicted_label == topic)
        
    if min_confidence is not None:
        query = query.filter(PostAnalysis.confidence >= min_confidence)
        
    query = query.order_by(desc(Post.created_at)).limit(limit)
    results = query.all()
    
    items = []
    for post, account, analysis in results:
        items.append({
            "post_id": post.id,
            "account_id": account.id,
            "handle": account.handle,
            "platform": account.platform.value if account.platform else None,
            "captured_at": post.captured_at or post.created_at,
            "text": post.raw_text,
            "predicted_label": analysis.predicted_label if analysis else None,
            "confidence": analysis.confidence if analysis else None
        })
        
    return {"status": "ok", "count": len(items), "items": items}

@router.get("/actors")
def search_actors(
    q: str = Query(..., min_length=1),
    platform: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    query = db.query(Account).filter(Account.handle.ilike(f"%{q}%"))
    
    if platform and platform.lower() != "all":
        try:
            plat_enum = None
            for p in PlatformEnum:
                if p.value.lower() == platform.lower():
                    plat_enum = p
                    break
            if plat_enum:
                query = query.filter(Account.platform == plat_enum)
        except Exception:
            pass
            
    query = query.order_by(desc(Account.created_at)).limit(limit)
    accounts = query.all()
    
    items = []
    for account in accounts:
        # Simple counts just for UI
        post_count = db.query(Post).filter(Post.account_id == account.id).count()
        analyzed_count = (
            db.query(PostAnalysis)
            .join(Post, Post.id == PostAnalysis.post_id)
            .filter(Post.account_id == account.id)
            .count()
        )
        
        last_post = (
            db.query(Post)
            .filter(Post.account_id == account.id)
            .order_by(desc(Post.captured_at))
            .first()
        )
        last_seen = last_post.captured_at if last_post else None
        
        items.append({
            "id": account.id,
            "platform": account.platform.value if account.platform else None,
            "handle": account.handle,
            "display_name": account.display_name,
            "created_at": account.created_at,
            "post_count": post_count,
            "analyzed_count": analyzed_count,
            "last_seen": last_seen
        })
        
    return {"status": "ok", "count": len(items), "items": items}

@router.get("/trends")
def search_trends(
    period: str = "7d",
    platform: str | None = None,
    db: Session = Depends(get_db)
):
    try:
        days = int(period.replace("d", ""))
    except ValueError:
        days = 7
        
    start_date = datetime.utcnow() - timedelta(days=days)
    
    query = (
        db.query(Post, Account, PostAnalysis)
        .join(Account, Post.account_id == Account.id)
        .outerjoin(PostAnalysis, Post.id == PostAnalysis.post_id)
        .filter(or_(Post.created_at >= start_date, Post.captured_at >= start_date))
    )
    
    if platform and platform.lower() != "all":
        try:
            plat_enum = None
            for p in PlatformEnum:
                if p.value.lower() == platform.lower():
                    plat_enum = p
                    break
            if plat_enum:
                query = query.filter(Account.platform == plat_enum)
        except Exception:
            pass
            
    results = query.all()
    
    # Aggregate data
    topic_map = {}
    platform_map = {}
    word_map = {}
    
    stopwords = {"the", "and", "with", "this", "that", "from", "have", "they", "were", "what", "their", "will"}
    
    for post, account, analysis in results:
        # Platform
        p_val = account.platform.value if account.platform else "unknown"
        platform_map[p_val] = platform_map.get(p_val, 0) + 1
        
        # Topic
        if analysis and analysis.predicted_label:
            lbl = analysis.predicted_label
            topic_map[lbl] = topic_map.get(lbl, 0) + 1
            
        # Keywords
        if post.raw_text:
            text = post.raw_text.lower()
            words = re.findall(r'[a-z]+', text)
            for w in words:
                if len(w) >= 4 and w not in stopwords:
                    word_map[w] = word_map.get(w, 0) + 1
                    
    # Format topic counts
    total_analyzed = sum(topic_map.values())
    topic_counts = []
    for topic, count in sorted(topic_map.items(), key=lambda x: x[1], reverse=True):
        topic_counts.append({
            "topic": topic,
            "count": count,
            "pct": (count / total_analyzed) if total_analyzed > 0 else 0
        })
        
    # Format keywords
    top_keywords = []
    for word, count in sorted(word_map.items(), key=lambda x: x[1], reverse=True)[:10]:
        top_keywords.append({
            "keyword": word,
            "count": count
        })
        
    # Format platform counts
    platform_counts = []
    for plat, count in sorted(platform_map.items(), key=lambda x: x[1], reverse=True):
        platform_counts.append({
            "platform": plat,
            "count": count
        })
        
    return {
        "status": "ok",
        "topic_counts": topic_counts,
        "top_keywords": top_keywords,
        "platform_counts": platform_counts,
        "total_posts": len(results)
    }
