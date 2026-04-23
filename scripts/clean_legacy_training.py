from pathlib import Path
import pandas as pd

INPUT = Path("data/processed/training_clean.csv")
OUTPUT = Path("data/processed/legacy_clean.csv")
SUMMARY = Path("data/processed/legacy_clean_summary.txt")

ALLOWED_LABELS = {
    "Politics & Governance",
    "Technology & Cyber",
    "Society & Health",
    "Economy & Business",
}

MIN_WORDS = 5

df = pd.read_csv(INPUT, low_memory=False)

raw_rows = len(df)

# keep only needed columns
df = df[["text", "clean_text", "osint_topic", "source_dataset"]].copy()

# normalize strings
for col in ["text", "clean_text", "osint_topic", "source_dataset"]:
    df[col] = df[col].fillna("").astype(str).str.strip()

# remove null/empty-like rows
df = df[
    (df["text"] != "") &
    (df["clean_text"] != "") &
    (df["osint_topic"] != "") &
    (df["source_dataset"] != "")
].copy()
after_empty_removal = len(df)

# keep only valid labels
df = df[df["osint_topic"].isin(ALLOWED_LABELS)].copy()
after_label_filter = len(df)

# remove ultra-short junk rows
df["clean_word_count"] = df["clean_text"].str.split().str.len()
df = df[df["clean_word_count"] >= MIN_WORDS].copy()
after_short_filter = len(df)

# remove duplicates
df = df.drop_duplicates(subset=["clean_text"]).copy()
after_cleantext_dedup = len(df)

df = df.drop_duplicates(subset=["text"]).copy()
after_text_dedup = len(df)

# rename to final merge-friendly names
df = df.rename(columns={"osint_topic": "label"})

# keep final columns
df = df[["text", "clean_text", "label", "source_dataset"]].copy()

# save
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
df.to_csv(OUTPUT, index=False, encoding="utf-8-sig")

label_counts = df["label"].value_counts()
source_counts = df["source_dataset"].value_counts()

with open(SUMMARY, "w", encoding="utf-8") as f:
    f.write(f"Raw rows: {raw_rows}\n")
    f.write(f"After empty removal: {after_empty_removal}\n")
    f.write(f"After label filter: {after_label_filter}\n")
    f.write(f"After short-text filter: {after_short_filter}\n")
    f.write(f"After clean_text dedup: {after_cleantext_dedup}\n")
    f.write(f"After text dedup / final rows: {after_text_dedup}\n\n")

    f.write("Label counts:\n")
    f.write(label_counts.to_string())
    f.write("\n\n")

    f.write("Source counts:\n")
    f.write(source_counts.to_string())
    f.write("\n")

print(f"Saved clean legacy file to: {OUTPUT}")
print(f"Saved summary to: {SUMMARY}")
print(f"Final rows: {len(df)}")
print("\nLabel counts:")
print(label_counts)
print("\nSource counts:")
print(source_counts)