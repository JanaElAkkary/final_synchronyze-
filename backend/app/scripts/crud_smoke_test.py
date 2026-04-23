from backend.app.database import SessionLocal
from backend.app.models import Account, Post, PostAnalysis, PlatformEnum


def get_or_create_account(session):
    account = (
        session.query(Account)
        .filter(Account.platform == PlatformEnum.twitter)
        .filter(Account.handle == "actor_1")
        .first()
    )

    if account is None:
        account = Account(
            platform=PlatformEnum.twitter,
            handle="actor_1",
            display_name="Actor 1",
        )
        session.add(account)
        session.flush()

    return account


def get_or_create_post(session, account):
    post = (
        session.query(Post)
        .filter(Post.platform == PlatformEnum.twitter)
        .filter(Post.platform_post_id == "tweet_001")
        .first()
    )

    if post is None:
        post = Post(
            account_id=account.id,
            platform=PlatformEnum.twitter,
            platform_post_id="tweet_001",
            url="https://x.com/actor_1/status/001",
            raw_text="The economy is improving",
            raw_payload={"likes": 10, "shares": 2},
        )
        session.add(post)
        session.flush()

    return post


def get_or_create_post_analysis(session, post):
    analysis = (
        session.query(PostAnalysis)
        .filter(PostAnalysis.post_id == post.id)
        .filter(PostAnalysis.model_version == "tfidf_lr_v1")
        .first()
    )

    if analysis is None:
        topic_vector = []
        topic_vector.append(0.91)
        topic_vector.append(0.05)
        topic_vector.append(0.02)
        topic_vector.append(0.02)

        analysis = PostAnalysis(
            post_id=post.id,
            model_version="tfidf_lr_v1",
            clean_text="economy improving",
            predicted_label="Economy & Business",
            confidence=0.91,
            topic_vector=topic_vector,
        )
        session.add(analysis)
        session.flush()

    return analysis


def run_smoke_test():
    session = SessionLocal()

    try:
        account = get_or_create_account(session)
        post = get_or_create_post(session, account)
        analysis = get_or_create_post_analysis(session, post)

        session.commit()

        accounts_count = session.query(Account).count()
        posts_count = session.query(Post).count()
        analysis_count = session.query(PostAnalysis).count()

        print("Account ID:", account.id)
        print("Post ID:", post.id)
        print("PostAnalysis ID:", analysis.id)
        print("Counts -> accounts:", accounts_count)
        print("Counts -> posts:", posts_count)
        print("Counts -> post_analysis:", analysis_count)
    finally:
        session.close()


if __name__ == "__main__":
    run_smoke_test()

