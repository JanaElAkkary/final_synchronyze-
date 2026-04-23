from pathlib import Path
import pandas as pd

LEGACY_INPUT = Path("data/processed/legacy_clean.csv")
IRA_INPUT = Path("data/processed/ira_reviewed_final_v3.csv")

OUTPUT = Path("data/processed/training_combined_v2.csv")
SUMMARY = Path("data/processed/training_combined_v2_summary.txt")

ALLOWED_LABELS = {
    "Politics & Governance",
    "Technology & Cyber",
    "Society & Health",
    "Economy & Business",
}

legacy = pd.read_csv(LEGACY_INPUT, low_memory=False)
ira = pd.read_csv(IRA_INPUT, low_memory=False)

# --- normalize legacy ---
legacy = legacy.rename(columns={"label": "label"})
legacy["text"] = legacy["text"].fillna("").astype(str).str.strip()
legacy["clean_text"] = legacy["clean_text"].fillna("").astype(str).str.strip()
legacy["label"] = legacy["label"].fillna("").astype(str).str.strip()
legacy["source_dataset"] = legacy["source_dataset"].fillna("").astype(str).str.strip()

legacy = legacy[
    ["text", "clean_text", "label", "source_dataset"]
].copy()

legacy = legacy[
    (legacy["text"] != "") &
    (legacy["clean_text"] != "") &
    (legacy["label"].isin(ALLOWED_LABELS)) &
    (legacy["source_dataset"] != "")
].copy()

# --- normalize ira ---
# expected columns from your reviewed final IRA file:
# content_raw, content_clean, final_label, review_decision, ...

ira["content_raw"] = ira["content_raw"].fillna("").astype(str).str.strip()
ira["content_clean"] = ira["content_clean"].fillna("").astype(str).str.strip()
ira["final_label"] = ira["final_label"].fillna("").astype(str).str.strip()
ira["review_decision"] = ira["review_decision"].fillna("").astype(str).str.strip()

ira = ira[ira["review_decision"].isin(["keep", "relabel"])].copy()
ira = ira[ira["final_label"].isin(ALLOWED_LABELS)].copy()
ira = ira[
    (ira["content_raw"] != "") &
    (ira["content_clean"] != "")
].copy()

ira_final = pd.DataFrame({
    "text": ira["content_raw"],
    "clean_text": ira["content_clean"],
    "label": ira["final_label"],
    "source_dataset": "ira"
})

# --- combine ---
combined = pd.concat([legacy, ira_final], ignore_index=True)

before_dedup = len(combined)

# remove duplicates by clean text first
combined = combined.drop_duplicates(subset=["clean_text"]).copy()
after_cleantext_dedup = len(combined)

# remove any leftover duplicate raw text
combined = combined.drop_duplicates(subset=["text"]).copy()
after_text_dedup = len(combined)

combined = combined.sort_values(["label", "source_dataset"]).reset_index(drop=True)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
combined.to_csv(OUTPUT, index=False, encoding="utf-8-sig")

label_counts = combined["label"].value_counts()
source_counts = combined["source_dataset"].value_counts()

with open(SUMMARY, "w", encoding="utf-8") as f:
    f.write(f"Legacy rows used: {len(legacy)}\n")
    f.write(f"IRA rows used: {len(ira_final)}\n")
    f.write(f"Combined before dedup: {before_dedup}\n")
    f.write(f"After clean_text dedup: {after_cleantext_dedup}\n")
    f.write(f"After text dedup / final rows: {after_text_dedup}\n\n")

    f.write("Label counts:\n")
    f.write(label_counts.to_string())
    f.write("\n\n")

    f.write("Source counts:\n")
    f.write(source_counts.to_string())
    f.write("\n")

print(f"Saved merged file to: {OUTPUT}")
print(f"Saved summary to: {SUMMARY}")
print(f"Final rows: {len(combined)}")

print("\nLabel counts:")
print(label_counts)

print("\nSource counts:")
print(source_counts)