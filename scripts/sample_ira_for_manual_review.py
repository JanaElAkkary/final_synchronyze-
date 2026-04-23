from pathlib import Path
import pandas as pd
import re

INPUT = Path("data/processed/ira_clean_candidates.csv")
OUTPUT = Path("data/processed/ira_manual_review_candidates_v2.csv")

TARGET_PER_LABEL = 120
CANDIDATE_POOL_PER_LABEL = 2000
MIN_TEXT_LEN = 20

# stronger, clearer keywords only
LABEL_RULES = {
    "Politics & Governance": {
        "strong": [
            r"\bgovernment\b",
            r"\belection\b",
            r"\belections\b",
            r"\bvoter\b",
            r"\bvoters\b",
            r"\bvote\b",
            r"\bvotes\b",
            r"\bvoting\b",
            r"\bparliament\b",
            r"\bpresident\b",
            r"\bprime minister\b",
            r"\bsenate\b",
            r"\bcongress\b",
            r"\bsupreme court\b",
            r"\bimmigration\b",
            r"\bborder\b",
            r"\bsanctions\b",
            r"\bdemocracy\b",
            r"\bbrexit\b",
        ],
        "medium": [
            r"\bminister\b",
            r"\bpolicy\b",
            r"\bpolicies\b",
            r"\bcourt\b",
            r"\biran\b",
            r"\brussia\b",
            r"\bisrael\b",
            r"\bgaza\b",
            r"\bhezbollah\b",
            r"\bnetanyahu\b",
            r"\bputin\b",
            r"\btrump\b",
            r"\bobama\b",
        ],
        "reject": [
            r"\bapp store\b",
            r"\biphone\b",
            r"\bandroid\b",
            r"\bcybersecurity\b",
            r"\bmalware\b",
            r"\bransomware\b",
            r"\bsoftware\b",
        ],
    },

    "Technology & Cyber": {
        "strong": [
            r"\biphone\b",
            r"\biphones\b",
            r"\bandroid\b",
            r"\bios\b",
            r"\bapp store\b",
            r"\bcybersecurity\b",
            r"\bmalware\b",
            r"\bransomware\b",
            r"\bencryption\b",
            r"\bdatabase\b",
            r"\bdatabases\b",
            r"\bserver\b",
            r"\bservers\b",
            r"\bsoftware\b",
            r"\bcloud\b",
            r"\bhacker\b",
            r"\bhackers\b",
            r"\bhacking\b",
            r"\bhacked\b",
            r"\bcyberattack\b",
            r"\bcyberattacks\b",
        ],
        "medium": [
            r"\bapple\b",
            r"\bgoogle\b",
            r"\bdevice\b",
            r"\bdevices\b",
            r"\bphone\b",
            r"\bphones\b",
            r"\bapi\b",
            r"\bapis\b",
            r"\bbitcoin\b",
            r"\blinux\b",
            r"\bsecurity\b",
            r"\bhack\b",
        ],
        "reject": [
            r"\bparliament\b",
            r"\bsenate\b",
            r"\bcongress\b",
            r"\belection\b",
            r"\belections\b",
            r"\bvoting\b",
            r"\bvote\b",
            r"\bvotes\b",
            r"\bpresident\b",
        ],
    },

    "Society & Health": {
        "strong": [
            r"\bhealth\b",
            r"\bhospital\b",
            r"\bhospitals\b",
            r"\bcovid\b",
            r"\bvirus\b",
            r"\bflu\b",
            r"\bschool\b",
            r"\bschools\b",
            r"\bstudent\b",
            r"\bstudents\b",
            r"\beducation\b",
            r"\bteacher\b",
            r"\bteachers\b",
            r"\bchildren\b",
            r"\bfamily\b",
            r"\bfamilies\b",
            r"\bcommunity\b",
        ],
        "medium": [
            r"\bculture\b",
            r"\bfestival\b",
            r"\bfestivals\b",
            r"\bliterature\b",
            r"\breading\b",
            r"\bbook\b",
            r"\bbooks\b",
            r"\byoga\b",
            r"\bfood\b",
            r"\bagriculture\b",
        ],
        "reject": [
            r"#hillarychildrensbooks",
            r"\biphone\b",
            r"\bandroid\b",
            r"\bcybersecurity\b",
            r"\bstock\b",
            r"\bstocks\b",
            r"\bmarket\b",
            r"\bmarkets\b",
            r"\bbank\b",
            r"\bbanks\b",
        ],
    },

    "Economy & Business": {
        "strong": [
            r"\beconomy\b",
            r"\beconomic\b",
            r"\bbusiness\b",
            r"\bbusinesses\b",
            r"\bmarket\b",
            r"\bmarkets\b",
            r"\bstock\b",
            r"\bstocks\b",
            r"\btrade\b",
            r"\btrading\b",
            r"\bsales\b",
            r"\bsale\b",
            r"\bprice\b",
            r"\bprices\b",
            r"\bjobs\b",
            r"\bjob\b",
            r"\binvestment\b",
            r"\binvestments\b",
            r"\bprofit\b",
            r"\bprofits\b",
            r"\breal estate\b",
        ],
        "medium": [
            r"\bbank\b",
            r"\bbanks\b",
            r"\bworld bank\b",
            r"\brate\b",
            r"\brates\b",
            r"\bbillion\b",
            r"\bmillion\b",
            r"\bcompany\b",
            r"\bcompanies\b",
            r"\bipo\b",
            r"\brevenue\b",
        ],
        "reject": [
            r"\biphone\b",
            r"\bandroid\b",
            r"\bcybersecurity\b",
            r"\bparliament\b",
            r"\bsenate\b",
            r"\bcongress\b",
            r"\belection\b",
            r"\belections\b",
            r"\bpresident\b",
        ],
    },
}

GLOBAL_REJECT_PATTERNS = [
    r"^\W*$",
    r"^\.+$",
    r"^rt\s",
    r"\bsee my profile\b",
    r"\bforex\b",
    r"\bnyse\b",
    r"\bnasdaq\b",
    r"\bdaytrading\b",
    r"\bpromo\b",
]

def normalize_text(text: str) -> str:
    text = str(text)
    text = text.replace("&amp;", "and")
    text = re.sub(r"\s+", " ", text).strip()
    return text

def find_hits(text: str, patterns: list[str]) -> list[str]:
    hits = []
    for p in patterns:
        if re.search(p, text, flags=re.IGNORECASE):
            hits.append(p)
    return hits

def row_is_globally_bad(text: str) -> bool:
    if len(text) < MIN_TEXT_LEN:
        return True
    for p in GLOBAL_REJECT_PATTERNS:
        if re.search(p, text, flags=re.IGNORECASE):
            return True
    return False

def score_text(text: str, rules: dict) -> tuple[int, list[str], list[str], list[str]]:
    strong_hits = find_hits(text, rules["strong"])
    medium_hits = find_hits(text, rules["medium"])
    reject_hits = find_hits(text, rules["reject"])

    score = len(strong_hits) * 10 + len(medium_hits) * 4 - len(reject_hits) * 8

    # reward clearer rows
    if len(text) >= 40:
        score += 2
    if len(text) >= 80:
        score += 2
    if "#news" in text.lower():
        score += 1

    return score, strong_hits, medium_hits, reject_hits

def main():
    df = pd.read_csv(INPUT, low_memory=False)

    if "content_clean" not in df.columns:
        raise ValueError("content_clean column not found")

    df["content_clean"] = df["content_clean"].fillna("").astype(str).map(normalize_text)
    df["content_raw"] = df.get("content_raw", df["content_clean"]).fillna("").astype(str)

    df = df[~df["content_clean"].apply(row_is_globally_bad)].copy()

    all_parts = []

    for label, rules in LABEL_RULES.items():
        temp = df.copy()

        scores = temp["content_clean"].apply(lambda x: score_text(x, rules))
        temp["match_score"] = scores.apply(lambda x: x[0])
        temp["strong_hits"] = scores.apply(lambda x: x[1])
        temp["medium_hits"] = scores.apply(lambda x: x[2])
        temp["reject_hits"] = scores.apply(lambda x: x[3])

        temp["strong_hit_count"] = temp["strong_hits"].apply(len)
        temp["medium_hit_count"] = temp["medium_hits"].apply(len)
        temp["reject_hit_count"] = temp["reject_hits"].apply(len)
        temp["hit_count"] = temp["strong_hit_count"] + temp["medium_hit_count"]

        # require at least one strong hit
        temp = temp[temp["strong_hit_count"] > 0].copy()

        # reject rows with too much cross-topic noise
        temp = temp[temp["reject_hit_count"] <= 1].copy()

        # stronger ranking first
        temp = temp.sort_values(
            ["match_score", "strong_hit_count", "medium_hit_count"],
            ascending=[False, False, False]
        ).head(CANDIDATE_POOL_PER_LABEL).copy()

        # keep some variety
        sample_n = min(TARGET_PER_LABEL, len(temp))
        temp = temp.sample(n=sample_n, random_state=42).copy()

        temp["provisional_label"] = label
        temp["keyword_hits"] = temp.apply(
            lambda row: row["strong_hits"] + row["medium_hits"],
            axis=1
        )

        all_parts.append(temp)

    review_df = pd.concat(all_parts, ignore_index=True)

    # keep best version if the same text appears under multiple labels
    review_df = review_df.sort_values(
        ["match_score", "strong_hit_count", "medium_hit_count"],
        ascending=[False, False, False]
    ).drop_duplicates(subset=["content_clean"]).copy()

    review_df["final_label"] = ""
    review_df["review_decision"] = ""
    review_df["review_notes"] = ""

    wanted = [
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

    final_cols = [c for c in wanted if c in review_df.columns]
    review_df = review_df[final_cols].copy()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    review_df.to_csv(OUTPUT, index=False, encoding="utf-8-sig")

    print(f"Saved: {OUTPUT}")
    print(f"Rows: {len(review_df)}")
    print("\nCounts by provisional_label:")
    print(review_df["provisional_label"].value_counts())

if __name__ == "__main__":
    main()