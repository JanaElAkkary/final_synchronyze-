from pathlib import Path
import pandas as pd

INPUT = Path(r"C:\Users\HP\Documents\collage\graduation project\final\data\processed\training_clean.csv")
df = pd.read_csv(INPUT, low_memory=False)
print("ROWS:", len(df))
print("\nCOLUMNS:")
print(list(df.columns))

print("\nFIRST 5 ROWS:")
print(df.head(5).to_string())

print("\nNULL COUNTS:")
print(df.isna().sum())

# try common label column names
possible_label_cols = ["label", "true_label", "category", "topic", "class"]
for col in possible_label_cols:
    if col in df.columns:
        print(f"\nVALUE COUNTS FOR {col}:")
        print(df[col].value_counts(dropna=False))