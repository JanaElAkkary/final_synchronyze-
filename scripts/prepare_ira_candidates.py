import os
import re
import glob
import pandas as pd

INPUT_DIR = "data/new/ira"
OUTPUT_CSV = "data/processed/ira_clean_candidates_v3.csv"
OUTPUT_SUMMARY = "data/processed/ira_clean_summary_v3.txt"

os.makedirs("data/processed", exist_ok=True)

files = sorted(glob.glob(os.path.join(INPUT_DIR, "IRAhandle_tweets_*.csv")))
if not files:
    raise FileNotFoundError("No IRA files found in data/new/ira")

dfs = []
for path in files:
    df = pd.read_csv(path, low_memory=False)
    df["source_file"] = os.path.basename(path)
    dfs.append(df)

df = pd.concat(dfs, ignore_index=True)
raw_rows = len(df)

# -------------------------
# basic cleaning
# -------------------------
df = df[df["language"].astype(str).str.strip().str.lower() == "english"].copy()
english_rows = len(df)

def clean_text(text):
    if not isinstance(text, str):
        return ""
    text = re.sub(r"http\S+|www\S+", " ", text)
    text = re.sub(r"@\w+", " ", text)
    text = text.replace("&amp;", "and")
    text = re.sub(r"\s+", " ", text).strip()
    return text

df["content_raw"] = df["content"].fillna("")
df["content_clean"] = df["content_raw"].apply(clean_text)

df = df[df["content_clean"].str.len() >= 25].copy()
usable_rows = len(df)

df = df.drop_duplicates(subset=["content_clean"]).copy()
dedup_rows = len(df)

# -------------------------
# hard account filters
# -------------------------
bad_account_categories = {
    "Commercial",
    "NonEnglish",
    "Unknown",
}
bad_account_types = {
    "Commercial",
}

df = df[~df["account_category"].fillna("").isin(bad_account_categories)].copy()
df = df[~df["account_type"].fillna("").isin(bad_account_types)].copy()

# -------------------------
# generic spam / junk filters
# -------------------------
def has_too_many_hashtags(text):
    return len(re.findall(r"#\w+", text)) >= 5

def has_too_many_caps(text):
    return len(re.findall(r"\b[A-Z]{4,}\b", text)) >= 4

def matches_any(text, patterns):
    text = text.lower()
    for p in patterns:
        if re.search(p, text):
            return True
    return False

generic_bad_patterns = [
    r"\bdownload\b",
    r"\bgiveaway\b",
    r"\bcheat\b",
    r"\bpromo\b",
    r"\bbuy now\b",
    r"\bfor sale\b",
    r"\bprice target\b",
    r"\bpremarket\b",
    r"\bmarket snapshot\b",
    r"\bwebcast\b",
    r"\bportfolio\b",
    r"\bindeed\b",
    r"\bavailable now\b",
    r"\bsame day\b",
    r"\bfactory unlocked\b",
    r"\bhome screen\b",
]

df = df[~df["content_clean"].apply(has_too_many_hashtags)].copy()
df = df[~df["content_clean"].apply(has_too_many_caps)].copy()
df = df[~df["content_clean"].apply(lambda x: matches_any(x, generic_bad_patterns))].copy()

# -------------------------
# label rules
# -------------------------
LABEL_KEYWORDS = {
    "Politics & Governance": {
        "strong": [
            r"\belection\b", r"\belections\b", r"\bvote\b", r"\bvoting\b", r"\bvoter\b", r"\bvoters\b",
            r"\bsenate\b", r"\bcongress\b", r"\bparliament\b", r"\bgovernment\b",
            r"\bpresident\b", r"\bprime minister\b", r"\bsupreme court\b",
            r"\bimmigration\b", r"\bborder\b", r"\bsanctions\b", r"\bbrexit\b", r"\bdemocracy\b"
        ],
        "medium": [
            r"\bobama\b", r"\btrump\b", r"\brussia\b", r"\biran\b", r"\bputin\b", r"\bpolicy\b"
        ],
        "reject": [
            r"\bstock market\b", r"\bstocks\b", r"\btrading\b", r"\biphone\b", r"\bandroid\b"
        ],
    },
    "Economy & Business": {
        "strong": [
            r"\beconomy\b", r"\beconomic\b", r"\bbusiness\b", r"\bbusinesses\b",
            r"\bmarket\b", r"\bmarkets\b", r"\bjobs\b", r"\bjob\b",
            r"\bprofit\b", r"\bprofits\b", r"\bsales\b", r"\bprice\b", r"\bprices\b",
            r"\binvestment\b", r"\brevenue\b", r"\breal estate\b", r"\bunemployment\b"
        ],
        "medium": [
            r"\bstock\b", r"\bstocks\b", r"\btrade\b", r"\btrading\b",
            r"\bbank\b", r"\bbanks\b", r"\bbillion\b", r"\bmillion\b"
        ],
        "reject": [
            r"\belection\b", r"\bvote\b", r"\bvoting\b", r"\bsenate\b",
            r"\bcongress\b", r"\bpresident\b", r"\bsupreme court\b"
        ],
    },
    "Technology & Cyber": {
        "strong": [
            r"\bcybersecurity\b", r"\bmalware\b", r"\bhacker\b", r"\bhackers\b",
            r"\bhack\b", r"\bhacked\b", r"\bhacking\b", r"\bserver\b",
            r"\bdatabase\b", r"\btrojan\b", r"\bransomware\b", r"\bbreach\b"
        ],
        "medium": [
            r"\bsoftware\b", r"\biphone\b", r"\biphones\b", r"\bandroid\b",
            r"\bios\b", r"\bapple\b", r"\bgoogle\b", r"\bcloud\b"
        ],
        "reject": [
            r"\bgame\b", r"\bgames\b", r"\bgamer\b", r"\bgiveaway\b", r"\bdownload\b",
            r"\bcheat\b", r"\bfactory unlocked\b", r"\bhome screen\b",
            r"\bapp\b", r"\bvideogame\b"
        ],
    },
    "Society & Health": {
        "strong": [
            r"\bhealth\b", r"\bhospital\b", r"\bflu\b", r"\bvirus\b", r"\bvaccine\b",
            r"\bschool\b", r"\bschools\b", r"\bstudent\b", r"\bstudents\b",
            r"\bteacher\b", r"\bteachers\b", r"\beducation\b", r"\bchildren\b",
            r"\bfamily\b", r"\bfamilies\b", r"\bcommunity\b"
        ],
        "medium": [
            r"\bcollege\b", r"\bmental health\b", r"\bclinic\b", r"\bcare\b"
        ],
        "reject": [
            r"\belection\b", r"\bvote\b", r"\bpresident\b", r"\bsenate\b",
            r"\bcongress\b", r"\bstock\b", r"\bstocks\b", r"\btrading\b"
        ],
    },
}

def get_hits(text, patterns):
    hits = []
    for pattern in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            hits.append(pattern)
    return hits

def label_row(text):
    best_label = None
    best_score = -999
    best_data = None

    for label, rules in LABEL_KEYWORDS.items():
        strong_hits = get_hits(text, rules["strong"])
        medium_hits = get_hits(text, rules["medium"])
        reject_hits = get_hits(text, rules["reject"])

        score = (len(strong_hits) * 10) + (len(medium_hits) * 2) - (len(reject_hits) * 8)

        if score > best_score:
            best_score = score
            best_label = label
            best_data = {
                "provisional_label": label,
                "keyword_hits": strong_hits + medium_hits,
                "strong_hits": strong_hits,
                "medium_hits": medium_hits,
                "reject_hits": reject_hits,
                "strong_hit_count": len(strong_hits),
                "medium_hit_count": len(medium_hits),
                "reject_hit_count": len(reject_hits),
                "match_score": score,
            }

    return pd.Series(best_data)

scored = df["content_clean"].apply(label_row)
df = pd.concat([df, scored], axis=1)

# -------------------------
# stronger keep logic
# -------------------------
df = df[
    (df["strong_hit_count"] >= 2) |
    ((df["strong_hit_count"] >= 1) & (df["medium_hit_count"] >= 2))
].copy()

df = df[df["reject_hit_count"] == 0].copy()

# -------------------------
# class-specific cleanup
# -------------------------
tech_bad_patterns = [
    r"\bgame\b", r"\bgames\b", r"\bgamer\b", r"\bgiveaway\b", r"\bdownload\b",
    r"\bcheat\b", r"\bfactory unlocked\b", r"\bhome screen\b", r"\bvideogame\b"
]

economy_bad_patterns = [
    r"\bprice target\b", r"\bpremarket\b", r"\bmarket snapshot\b", r"\bportfolio\b",
    r"\bwebcast\b", r"\btrading stocks\b", r"\bstocks options trading\b",
    r"\bdip buying\b", r"\bcasino\b", r"\btruly rich club\b", r"\bavailable now\b",
    r"\bcheck out my sale\b", r"\brestock\b"
]

# tech rows must have at least one cyber-style signal, not just iphone/android/device words
tech_must_have = [
    r"\bhack\b", r"\bhacked\b", r"\bhacking\b", r"\bhacker\b", r"\bhackers\b",
    r"\bmalware\b", r"\bcybersecurity\b", r"\bserver\b", r"\bdatabase\b",
    r"\btrojan\b", r"\bbreach\b"
]

df = df[
    ~(
        (df["provisional_label"] == "Technology & Cyber") &
        (
            df["content_clean"].apply(lambda x: matches_any(x, tech_bad_patterns)) |
            ~df["content_clean"].apply(lambda x: matches_any(x, tech_must_have))
        )
    )
].copy()

df = df[
    ~(
        (df["provisional_label"] == "Economy & Business") &
        df["content_clean"].apply(lambda x: matches_any(x, economy_bad_patterns))
    )
].copy()

# optional: remove very weak economy rows that only say stock/market without real news context
df = df[
    ~(
        (df["provisional_label"] == "Economy & Business") &
        (df["strong_hit_count"] < 2) &
        df["content_clean"].str.lower().str.contains(r"\bstock\b|\bstocks\b|\bmarket\b|\bmarkets\b", regex=True)
    )
].copy()

df = df.sort_values(
    by=["match_score", "strong_hit_count", "medium_hit_count"],
    ascending=[False, False, False]
).copy()

df["final_label"] = ""
df["review_decision"] = ""
df["review_notes"] = ""

keep_cols = [
    "content_raw",
    "content_clean",
    "language",
    "account_type",
    "account_category",
    "post_type",
    "retweet",
    "source_file",
    "provisional_label",
    "keyword_hits",
    "strong_hits",
    "medium_hits",
    "reject_hits",
    "strong_hit_count",
    "medium_hit_count",
    "reject_hit_count",
    "match_score",
    "final_label",
    "review_decision",
    "review_notes",
]

df[keep_cols].to_csv(OUTPUT_CSV, index=False)

summary_lines = [
    f"Total raw rows: {raw_rows}",
    f"English rows: {english_rows}",
    f"After unusable-text removal: {usable_rows}",
    f"After deduplication: {dedup_rows}",
    f"Final candidate rows: {len(df)}",
    "",
    "Label counts:",
    df["provisional_label"].value_counts().to_string(),
]

with open(OUTPUT_SUMMARY, "w", encoding="utf-8") as f:
    f.write("\n".join(summary_lines))

print(f"Saved cleaned IRA candidates to: {OUTPUT_CSV}")
print(f"Saved summary to: {OUTPUT_SUMMARY}")
print(f"Final candidate rows: {len(df)}")
print(df["provisional_label"].value_counts())