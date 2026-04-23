from pathlib import Path
import pandas as pd

INPUT = Path("data/processed/ira_clean_candidates_v3.csv")
OUTPUT = Path("data/processed/ira_manual_review_v3.csv")

TARGETS = {
    "Politics & Governance": 60,
    "Society & Health": 60,
    "Economy & Business": 60,
    "Technology & Cyber": 60,
}

df = pd.read_csv(INPUT, low_memory=False)

parts = []

for label, n in TARGETS.items():
    temp = df[df["provisional_label"] == label].copy()

    # strongest rows first
    temp = temp.sort_values(
        by=["match_score", "strong_hit_count", "medium_hit_count"],
        ascending=[False, False, False]
    ).head(300).copy()

    # then sample from strong pool for variety
    take = min(n, len(temp))
    temp = temp.sample(n=take, random_state=42).copy()

    parts.append(temp)

review_df = pd.concat(parts, ignore_index=True)

review_df["final_label"] = ""
review_df["review_decision"] = ""
review_df["review_notes"] = ""

keep_cols = [
    "content_raw",
    "content_clean",
    "account_type",
    "account_category",
    "source_file",
    "provisional_label",
    "keyword_hits",
    "strong_hits",
    "medium_hits",
    "reject_hits",
    "match_score",
    "final_label",
    "review_decision",
    "review_notes",
]

review_df = review_df[keep_cols].copy()
review_df.to_csv(OUTPUT, index=False, encoding="utf-8-sig")

print(f"Saved: {OUTPUT}")
print(f"Rows: {len(review_df)}")
print(review_df['provisional_label'].value_counts())