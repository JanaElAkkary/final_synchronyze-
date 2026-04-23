import os
import sys
import time

import pandas as pd


current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


from packages.intelligence_core.preprocessing import download_nltk, preprocess_dataset


def _select_output_columns(df):
    columns_to_keep = []
    desired_columns = ["text", "clean_text", "osint_topic", "source_dataset"]
    for column in desired_columns:
        if column in df.columns:
            columns_to_keep.append(column)
    if len(columns_to_keep) > 0:
        df = df[columns_to_keep]
    return df


def preprocess_training_sample():
    print("Loading training data from data/legacy/training_data.csv...")
    df = pd.read_csv("data/legacy/training_data.csv")
    print("Loaded rows:", len(df))

    print("Downloading NLTK resources...")
    download_nltk()

    print("Filtering BBC rows...")
    source_series = df["source_dataset"].astype(str)
    lower_series = source_series.str.lower()
    mask_eq = source_series == "BBC"
    mask_contains = lower_series.str.contains("bbc")
    mask = mask_eq | mask_contains
    df_bbc = df[mask]
    print("BBC rows after filter:", len(df_bbc))

    df_sample = df_bbc.head(500)
    rows_to_process = len(df_sample)
    print("Processing sample rows:", rows_to_process)

    start_time = time.time()
    df_clean = preprocess_dataset(df_sample, "text")
    end_time = time.time()
    elapsed = end_time - start_time

    if elapsed > 0:
        rows_per_second = rows_to_process / elapsed
    else:
        rows_per_second = 0.0

    df_clean = _select_output_columns(df_clean)

    print("Preprocessing finished.")
    print("Rows processed:", rows_to_process)
    print("Seconds elapsed:", elapsed)
    print("Rows per second:", rows_per_second)

    output_dir = "data/processed"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    output_path = os.path.join(output_dir, "training_clean_sample.csv")
    print("Saving cleaned sample to:", output_path)
    df_clean.to_csv(output_path, index=False)
    print("Done saving sample.")


def preprocess_training_full():
    print("Loading training data from data/legacy/training_data.csv...")
    df = pd.read_csv("data/legacy/training_data.csv")
    print("Loaded rows:", len(df))

    print("Downloading NLTK resources...")
    download_nltk()

    total_rows = len(df)
    print("Processing full dataset (no BBC filter). Total rows:", total_rows)

    start_time = time.time()

    chunk_size = 5000
    chunks = []
    for start_index in range(0, total_rows, chunk_size):
        end_index = start_index + chunk_size
        if end_index > total_rows:
            end_index = total_rows

        df_chunk = df.iloc[start_index:end_index]
        df_chunk_clean = preprocess_dataset(df_chunk, "text")
        chunks.append(df_chunk_clean)

        processed_rows = end_index
        print("Processed", processed_rows, "/", total_rows)

    if len(chunks) > 0:
        df_clean = pd.concat(chunks, ignore_index=True)
    else:
        df_clean = df.copy()

    df_clean = _select_output_columns(df_clean)

    end_time = time.time()
    elapsed = end_time - start_time
    rows_to_process = total_rows

    if elapsed > 0:
        rows_per_second = rows_to_process / elapsed
    else:
        rows_per_second = 0.0

    print("Full preprocessing finished.")
    print("Rows processed:", rows_to_process)
    print("Seconds elapsed:", elapsed)
    print("Rows per second:", rows_per_second)

    output_dir = "data/processed"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    output_path = os.path.join(output_dir, "training_clean.csv")
    print("Saving full cleaned data to:", output_path)
    df_clean.to_csv(output_path, index=False)
    print("Done saving full data.")


def main():
    if "--full" in sys.argv:
        preprocess_training_full()
    else:
        preprocess_training_sample()


if __name__ == "__main__":
    main()
