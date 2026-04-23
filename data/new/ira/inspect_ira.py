from pathlib import Path
import pandas as pd

file_path = Path("data/new/ira/IRAhandle_tweets_1.csv")
df = pd.read_csv(file_path, low_memory=False)

print("COLUMNS:")
print(list(df.columns))

print("\nFIRST 3 ROWS:")
print(df.head(3).to_string())