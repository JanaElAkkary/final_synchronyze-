import os

import pandas as pd


def load_predictions(path):
    if not os.path.exists(path):
        print("File not found, skipping:", path)
        return None
    print("Loading predictions from:", path)
    df = pd.read_csv(path)
    print("Loaded rows:", len(df))
    return df


def analyze_predictions(name, path):
    df = load_predictions(path)
    if df is None:
        return

    label_column = None
    if "predicted_label" in df.columns:
        label_column = "predicted_label"
    elif "predicted_topic" in df.columns:
        label_column = "predicted_topic"

    if label_column is None:
        print("No predicted label column found in:", path)
        return

    if "confidence" not in df.columns:
        print("No confidence column found in:", path)
        return

    label_counts = {}
    label_conf_sums = {}

    for index, row in df.iterrows():
        label = row[label_column]
        confidence = row["confidence"]

        if label not in label_counts:
            label_counts[label] = 0
            label_conf_sums[label] = 0.0

        label_counts[label] = label_counts[label] + 1

        if not isinstance(confidence, float):
            try:
                confidence = float(confidence)
            except Exception:
                confidence = 0.0

        label_conf_sums[label] = label_conf_sums[label] + confidence

    items = []
    for label in label_counts:
        count = label_counts[label]
        items.append((label, count))

    items.sort(key=lambda x: x[1], reverse=True)

    print("Distribution for", name, ":")
    for label, count in items:
        total_conf = label_conf_sums[label]
        if count > 0:
            avg_conf = total_conf / count
        else:
            avg_conf = 0.0
        print("Label:", label, "| Count:", count, "| Avg confidence:", avg_conf)


def main():
    twitter_path = "data/processed/twitter_predictions.csv"
    reddit_path = "data/processed/reddit_predictions.csv"

    analyze_predictions("twitter", twitter_path)
    analyze_predictions("reddit", reddit_path)


if __name__ == "__main__":
    main()

