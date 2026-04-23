from pathlib import Path
import pandas as pd

INPUT = Path("data/processed/training_combined_v2.csv")
OUTPUT = Path("data/processed/training_rebalanced_v2.csv")
SUMMARY = Path("data/processed/training_rebalanced_v2_summary.txt")

TARGET_COUNTS = {
    "Politics & Governance": 10000,
    "Society & Health": 10000,
    "Economy & Business": 8000,
    "Technology & Cyber": 4608,  # keep all current tech rows
}

RANDOM_STATE = 42

df = pd.read_csv(INPUT, low_memory=False)

# normalize
for col in ["text", "clean_text", "label", "source_dataset"]:
    df[col] = df[col].fillna("").astype(str).str.strip()

df = df[
    (df["text"] != "") &
    (df["clean_text"] != "") &
    (df["label"] != "") &
    (df["source_dataset"] != "")
].copy()

parts = []

for label, target in TARGET_COUNTS.items():
    temp = df[df["label"] == label].copy()

    if len(temp) <= target:
        sampled = temp.copy()
    else:
        sampled = temp.sample(n=target, random_state=RANDOM_STATE)

    parts.append(sampled)

balanced = pd.concat(parts, ignore_index=True)

# shuffle final file
balanced = balanced.sample(frac=1, random_state=RANDOM_STATE).reset_index(drop=True)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
balanced.to_csv(OUTPUT, index=False, encoding="utf-8-sig")

label_counts = balanced["label"].value_counts()
source_counts = balanced["source_dataset"].value_counts()

with open(SUMMARY, "w", encoding="utf-8") as f:
    f.write(f"Input rows: {len(df)}\n")
    f.write(f"Output rows: {len(balanced)}\n\n")

    f.write("Target counts:\n")
    for label, target in TARGET_COUNTS.items():
        f.write(f"{label}: {target}\n")

    f.write("\nActual label counts:\n")
    f.write(label_counts.to_string())
    f.write("\n\n")

    f.write("Source counts:\n")
    f.write(source_counts.to_string())
    f.write("\n")

print(f"Saved rebalanced file to: {OUTPUT}")
print(f"Saved summary to: {SUMMARY}")
print(f"Final rows: {len(balanced)}")

print("\nLabel counts:")
print(label_counts)

print("\nSource counts:")
print(source_counts)