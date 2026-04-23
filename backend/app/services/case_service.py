from sqlalchemy.orm import Session
from backend.app.models import Case, Account, PlatformEnum

def get_or_create_case_for_actor(db: Session, actor_id: int, owner_id: int, title: str = None):
    """
    Find or create a case for a specific actor and owner.
    1. Reuse an existing open case if found.
    2. Reopen the latest closed case if no open cases exist.
    3. Create a new case if no case exists at all.
    """
    # 1. Reuse open case
    existing_open = db.query(Case).filter(
        Case.actor_id == actor_id,
        Case.owner_id == owner_id,
        Case.status != "closed"
    ).order_by(Case.created_at.desc()).first()
    
    if existing_open:
        return existing_open
        
    # 2. Reopen latest closed case
    latest_closed = db.query(Case).filter(
        Case.actor_id == actor_id,
        Case.owner_id == owner_id,
        Case.status == "closed"
    ).order_by(Case.created_at.desc()).first()
    
    if latest_closed:
        latest_closed.status = "open"
        db.add(latest_closed)
        db.commit()
        db.refresh(latest_closed)
        return latest_closed
        
    # 3. Create new case
    if not title:
        actor = db.query(Account).filter(Account.id == actor_id).first()
        if actor:
            plat = actor.platform.value if actor.platform else "Unknown"
            # Human readable platform naming
            plat_name = plat.capitalize()
            if plat.lower() == 'twitter': plat_name = 'X/Twitter'
            
            if actor.handle:
                title = f"{plat_name}: @{actor.handle}"
            else:
                title = f"{plat_name}: Actor #{actor.id}"
        else:
            title = f"Case for Actor #{actor_id}"
            
    case = Case(
        title=title,
        actor_id=actor_id,
        owner_id=owner_id,
        status="open"
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case
