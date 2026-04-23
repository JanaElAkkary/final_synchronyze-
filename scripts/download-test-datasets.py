from datasets import load_dataset
import pandas as pd
from pathlib import Path

BASE = Path("data/new")
BASE.mkdir(parents=True, exist_ok=True)

def save_twitter():
    print("[1/2] Downloading Twitter dataset (tweet_eval/sentiment)...")
    out = BASE / "twitter_test.csv"
    ds = load_dataset("tweet_eval", "sentiment")
    df = ds["train"].to_pandas()
    df["platform"] = "twitter"
    df.to_csv(out, index=False)
    print("Saved:", out)

def save_reddit():
    print("[2/2] Downloading Reddit dataset (reddit_tifu/long)...")
    out = BASE / "reddit_test.csv"

    # IMPORTANT: this dataset requires remote code execution
    ds = load_dataset("reddit_tifu", "long", trust_remote_code=True)

    df = ds["train"].to_pandas()

    # Build one text field safely (handles different schemas)
    if "title" in df.columns and "selftext" in df.columns:
        df["text"] = (df["title"].fillna("") + "\n" + df["selftext"].fillna("")).str.strip()
    elif "documents" in df.columns:
        df["text"] = df["documents"].astype(str)
    elif "text" not in df.columns:
        # fallback: join all columns as text
        df["text"] = df.astype(str).agg(" | ".join, axis=1)

    df["platform"] = "reddit"
    df[["platform", "text"]].to_csv(out, index=False)
    print("Saved:", out)

if __name__ == "__main__":
    try:
        save_twitter()
        save_reddit()
        print("✅ Done: twitter_test.csv + reddit_test.csv created in data/new/")
    except Exception as e:
        print("❌ Error:", repr(e))
        raise