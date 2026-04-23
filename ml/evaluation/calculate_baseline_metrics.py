from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List, Dict, Any

import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calculate baseline evaluation metrics from baseline_predictions.csv")
    parser.add_argument("--predictions-csv", required=True, help="Path to baseline_predictions.csv")
    parser.add_argument("--results-json", required=True, help="Path to save baseline_results.json")
    parser.add_argument("--report-md", required=True, help="Path to save baseline_report.md")
    parser.add_argument(
        "--top-wrong-csv",
        required=False,
        default=None,
        help="Optional path to save top_50_wrong_predictions.csv",
    )
    return parser.parse_args()


def ensure_parent(path_str: str) -> Path:
    path = Path(path_str)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def safe_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def build_probability_column_map(df: pd.DataFrame) -> Dict[str, str]:
    mapping = {
        "Politics & Governance": "pred_politics",
        "Technology & Cyber": "pred_tech",
        "Society & Health": "pred_society",
        "Economy & Business": "pred_economy",
    }
    return {label: col for label, col in mapping.items() if col in df.columns}


def main() -> None:
    args = parse_args()

    predictions_path = Path(args.predictions_csv)
    if not predictions_path.exists():
        raise FileNotFoundError(f"Predictions CSV not found: {predictions_path}")

    df = pd.read_csv(predictions_path)

    required_cols = {"id", "text", "true_label", "predicted_label", "top_confidence", "correct"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns in predictions CSV: {sorted(missing)}")

    # Normalize correct column to boolean
    df["correct"] = df["correct"].astype(str).str.strip().str.lower().map({
        "true": True,
        "1": True,
        "yes": True,
        "false": False,
        "0": False,
        "no": False,
    })

    labels: List[str] = [
        "Politics & Governance",
        "Technology & Cyber",
        "Society & Health",
        "Economy & Business",
    ]

    y_true = df["true_label"].astype(str)
    y_pred = df["predicted_label"].astype(str)

    avg_top_probability = float(pd.to_numeric(df["top_confidence"], errors="coerce").fillna(0.0).mean())
    total_accuracy = float(accuracy_score(y_true, y_pred))
    macro_f1 = float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0))

    precisions, recalls, f1s, supports = precision_recall_fscore_support(
        y_true,
        y_pred,
        labels=labels,
        zero_division=0,
    )

    per_class: Dict[str, Dict[str, Any]] = {}
    for i, label in enumerate(labels):
        per_class[label] = {
            "precision": float(precisions[i]),
            "recall": float(recalls[i]),
            "f1": float(f1s[i]),
            "support": int(supports[i]),
        }

    cm = confusion_matrix(y_true, y_pred, labels=labels)
    cm_list = cm.tolist()

    prob_cols = build_probability_column_map(df)
    wrong_df = df[df["correct"] == False].copy()  # noqa: E712

    if prob_cols:
        def get_true_label_probability(row: pd.Series) -> float:
            true_label = row["true_label"]
            col = prob_cols.get(true_label)
            if not col or col not in row.index:
                return 0.0
            return safe_float(row[col])

        wrong_df["true_label_probability"] = wrong_df.apply(get_true_label_probability, axis=1)
    else:
        wrong_df["true_label_probability"] = 0.0

    # Most useful wrong predictions: highest confidence but wrong
    wrong_df["top_confidence"] = pd.to_numeric(wrong_df["top_confidence"], errors="coerce").fillna(0.0)
    wrong_df = wrong_df.sort_values(
        by=["top_confidence", "true_label_probability"],
        ascending=[False, True],
    )

    top_50_wrong = wrong_df.head(50).copy()

    results = {
        "rows": int(len(df)),
        "average_top_probability": avg_top_probability,
        "macro_f1": macro_f1,
        "total_accuracy": total_accuracy,
        "labels": labels,
        "per_class": per_class,
        "confusion_matrix": {
            "labels": labels,
            "matrix": cm_list,
        },
        "wrong_predictions_count": int((df["correct"] == False).sum()),  # noqa: E712
        "top_50_wrong_predictions_file": str(args.top_wrong_csv) if args.top_wrong_csv else None,
    }

    results_json_path = ensure_parent(args.results_json)
    with results_json_path.open("w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    if args.top_wrong_csv:
        top_wrong_path = ensure_parent(args.top_wrong_csv)
        preferred_cols = [
            "id",
            "text",
            "true_label",
            "predicted_label",
            "top_confidence",
            "true_label_probability",
            "source_type",
            "notes",
        ]
        cols = [c for c in preferred_cols if c in top_50_wrong.columns]
        top_50_wrong.to_csv(top_wrong_path, index=False, columns=cols)

    class_report = classification_report(
        y_true,
        y_pred,
        labels=labels,
        target_names=labels,
        zero_division=0,
        digits=4,
    )

    report_lines: List[str] = []
    report_lines.append("# Baseline Evaluation Report")
    report_lines.append("")
    report_lines.append(f"Rows evaluated: **{len(df)}**")
    report_lines.append(f"Average top probability: **{avg_top_probability:.4f}**")
    report_lines.append(f"Macro F1: **{macro_f1:.4f}**")
    report_lines.append(f"Total accuracy: **{total_accuracy:.4f}**")
    report_lines.append(f"Wrong predictions: **{int((df['correct'] == False).sum())}**")  # noqa: E712
    report_lines.append("")
    report_lines.append("## Per-class metrics")
    report_lines.append("")
    report_lines.append("| Label | Precision | Recall | F1 | Support |")
    report_lines.append("|---|---:|---:|---:|---:|")
    for label in labels:
        m = per_class[label]
        report_lines.append(
            f"| {label} | {m['precision']:.4f} | {m['recall']:.4f} | {m['f1']:.4f} | {m['support']} |"
        )
    report_lines.append("")
    report_lines.append("## Confusion matrix")
    report_lines.append("")
    report_lines.append("Rows = true labels, columns = predicted labels.")
    report_lines.append("")
    header = "| True \\ Pred | " + " | ".join(labels) + " |"
    divider = "|---|" + "---:|" * len(labels)
    report_lines.append(header)
    report_lines.append(divider)
    for i, true_label in enumerate(labels):
        row_vals = " | ".join(str(v) for v in cm_list[i])
        report_lines.append(f"| {true_label} | {row_vals} |")
    report_lines.append("")
    report_lines.append("## Classification report")
    report_lines.append("")
    report_lines.append("```text")
    report_lines.append(class_report.rstrip())
    report_lines.append("```")

    if args.top_wrong_csv:
        report_lines.append("")
        report_lines.append(f"Top 50 wrong predictions saved to: `{args.top_wrong_csv}`")

    report_md_path = ensure_parent(args.report_md)
    report_md_path.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Saved JSON: {results_json_path}")
    print(f"Saved report: {report_md_path}")
    if args.top_wrong_csv:
        print(f"Saved top wrong CSV: {args.top_wrong_csv}")
    print(f"Rows: {len(df)}")
    print("Done: average top probability, macro F1, per-class precision/recall/F1, confusion matrix, total accuracy")


if __name__ == "__main__":
    main()
