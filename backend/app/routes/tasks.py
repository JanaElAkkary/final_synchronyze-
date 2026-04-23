from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, Literal, List, Dict
from backend.app.database import get_db
from backend.app.models.task import Task

router = APIRouter()

class TaskCreate(BaseModel):
    type: Literal["investigate_user", "search_hashtag", "scrape_trending", "explore_trending", "explore_news"]
    target: str
    platform: Literal["twitter", "instagram", "facebook"]
    created_by: Optional[str] = None

@router.post("/create")
def create_task(task: TaskCreate, db: Session = Depends(get_db)):
    try:
        # Normalize target
        target_clean = task.target.strip()
        
        # Check for existing task
        existing_task = db.query(Task).filter(
            Task.type == task.type,
            Task.target == target_clean,
            Task.platform == task.platform,
            Task.status.in_(["pending", "in_progress"])
        ).first()
        
        if existing_task:
            return {
                "id": existing_task.id,
                "type": existing_task.type,
                "target": existing_task.target,
                "platform": existing_task.platform,
                "status": existing_task.status,
                "created_by": existing_task.created_by,
                "created_at": existing_task.created_at,
                "is_duplicate": True
            }
        
        # Create new task
        new_task = Task(
            type=task.type,
            target=target_clean,
            platform=task.platform,
            status="pending",
            created_by=task.created_by
        )
        
        db.add(new_task)
        db.commit()
        db.refresh(new_task)
        
        return {
            "id": new_task.id,
            "type": new_task.type,
            "target": new_task.target,
            "platform": new_task.platform,
            "status": new_task.status,
            "created_by": new_task.created_by,
            "created_at": new_task.created_at,
            "is_duplicate": False
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pending")
def get_pending_tasks(
    limit: int = Query(5, ge=1, le=20),
    platform: Optional[str] = None,
    db: Session = Depends(get_db)
):
    try:
        query = db.query(Task).filter(Task.status == "pending")
        
        if platform:
            query = query.filter(Task.platform == platform)
            
        tasks = query.order_by(Task.created_at.asc()).limit(limit).all()
        
        if not tasks:
            return []
            
        result = []
        for task in tasks:
            task.status = "in_progress"
            result.append({
                "id": task.id,
                "type": task.type,
                "target": task.target,
                "platform": task.platform,
                "status": "in_progress",
                "created_by": task.created_by,
                "created_at": task.created_at
            })
            
        db.commit()
        return result
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("")
def list_tasks(
    status: Optional[str] = "all",
    type: Optional[str] = None,
    platform: Optional[str] = None,
    created_by: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    try:
        query = db.query(Task)
        
        # Apply filters
        if status and status != "all":
            if status not in ["pending", "in_progress", "completed", "failed"]:
                raise HTTPException(status_code=400, detail="Invalid status")
            query = query.filter(Task.status == status)
            
        if type:
            query = query.filter(Task.type == type)
            
        if platform:
            query = query.filter(Task.platform == platform)
            
        if created_by:
            query = query.filter(Task.created_by == created_by)
            
        # Get total count
        total = query.count()
        
        # Apply ordering and pagination
        tasks = query.order_by(Task.created_at.desc())\
                     .offset((page - 1) * limit)\
                     .limit(limit)\
                     .all()
        
        items = []
        for task in tasks:
            items.append({
                "id": task.id,
                "type": task.type,
                "target": task.target,
                "platform": task.platform,
                "status": task.status,
                "created_by": task.created_by,
                "result_summary": task.result_summary,
                "created_at": task.created_at,
                "completed_at": task.completed_at
            })
            
        return {
            "items": items,
            "page": page,
            "limit": limit,
            "total": total
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class TaskUpdate(BaseModel):
    status: Literal["pending", "in_progress", "completed", "failed"]
    result_summary: Optional[Dict] = None

@router.patch("/{task_id}/status")
def update_task_status(
    task_id: int,
    task_update: TaskUpdate,
    db: Session = Depends(get_db)
):
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        task.status = task_update.status
        
        if task_update.result_summary is not None:
            task.result_summary = task_update.result_summary
            
        if task_update.status in ["completed", "failed"]:
            task.completed_at = func.now()
            
        db.commit()
        db.refresh(task)
        
        return {
            "id": task.id,
            "type": task.type,
            "target": task.target,
            "platform": task.platform,
            "status": task.status,
            "created_by": task.created_by,
            "result_summary": task.result_summary,
            "created_at": task.created_at,
            "completed_at": task.completed_at
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
