#!/usr/bin/env python3
import argparse
import pandas as pd

REQUIRED = ["text", "true_label", "predicted_label", "top_confidence", "notes"]

def main():
    parser = argparse.ArgumentParser(description="Prepare top wrong predictions for manual error review.")
    parser.add_argument("--predictions-csv", required=True, help="Path to baseline_predictions.csv")
    parser.add_argument("--output-csv", required=True, help="Path to top_50_wrong_predictions.csv")
    parser.add_argument("--top-n", type=int, default=50, help="How many wrong rows to keep")
    args = parser.parse_args()

    df = pd.read_csv(args.predictions_csv)

    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise SystemExit(f"Missing required columns: {missing}")

    wrong = df[df["correct"] == False].copy()

    # Highest-confidence wrong predictions first
    wrong = wrong.sort_values(["top_confidence"], ascending=[False])

    cols = ["text", "true_label", "predicted_label", "top_confidence", "notes"]
    if "id" in wrong.columns:
        cols = ["id"] + cols

    out = wrong.loc[:, cols].head(args.top_n).copy()
    out["error_type"] = ""
    out["review_notes"] = ""

    out.to_csv(args.output_csv, index=False)
    print(f"Saved: {args.output_csv}")
    print(f"Rows: {len(out)}")
    print("Columns:", ", ".join(out.columns))

if __name__ == "__main__":
    main()
