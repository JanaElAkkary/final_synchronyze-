from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend.app.models import Post

# Database URL
DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/graduation_project"

engine = create_engine(DATABASE_URL)

def check_posts():
    with Session(engine) as session:
        posts = session.query(Post).order_by(Post.id.desc()).limit(15).all()
        print("Latest 15 posts:")
        for p in posts:
            l = len(p.raw_text) if p.raw_text else 0
            print(f"ID: {p.id}, Platform: {p.platform}, TextLength: {l}, TextPreview: '{p.raw_text[:20] if p.raw_text else 'NONE'}'")

if __name__ == "__main__":
    check_posts()
