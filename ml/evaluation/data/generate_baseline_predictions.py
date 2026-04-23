from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable, Iterable

import joblib
import numpy as np
import pandas as pd


REQUIRED_COLUMNS = {"id", "text", "true_label", "source_type", "notes"}
LABEL_TO_PROB_COL = {
    "Politics & Governance": "pred_politics",
    "Technology & Cyber": "pred_tech",
    "Society & Health": "pred_society",
    "Economy & Business": "pred_economy",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate baseline predictions CSV from frozen model artifacts.")
    parser.add_argument("--eval-csv", required=True, help="Path to baseline evaluation CSV")
    parser.add_argument("--model", required=True, help="Path to model_v1.joblib")
    parser.add_argument("--vectorizer", required=True, help="Path to vectorizer_v1.joblib")
    parser.add_argument("--label-order", required=True, help="Path to label_order_v1.json")
    parser.add_argument("--output", required=True, help="Path to output baseline_predictions.csv")
    parser.add_argument(
        "--cleaner-module",
        default=None,
        help="Optional python module path to import a text cleaner from, e.g. backend.app.services.text_utils",
    )
    parser.add_argument(
        "--cleaner-func",
        default="clean_text",
        help="Cleaner function name inside --cleaner-module (default: clean_text)",
    )
    return parser.parse_args()


def load_cleaner(module_name: str | None, func_name: str) -> Callable[[str], str]:
    if not module_name:
        return lambda s: str(s).strip()
    try:
        module = __import__(module_name, fromlist=[func_name])
        cleaner = getattr(module, func_name)
        if not callable(cleaner):
            raise TypeError(f"{module_name}.{func_name} is not callable")
        return cleaner
    except Exception as exc:
        print(f"[warn] Could not load cleaner {module_name}.{func_name}: {exc}")
        print("[warn] Falling back to simple strip() cleaning.")
        return lambda s: str(s).strip()


def normalize_proba(raw: np.ndarray) -> np.ndarray:
    arr = np.asarray(raw, dtype=float)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    row_sums = arr.sum(axis=1, keepdims=True)
    valid = np.isfinite(row_sums) & (row_sums > 0)
    out = np.zeros_like(arr, dtype=float)
    out[valid[:, 0]] = arr[valid[:, 0]] / row_sums[valid[:, 0]]
    return out


def decision_to_softmax(scores: np.ndarray) -> np.ndarray:
    arr = np.asarray(scores, dtype=float)
    if arr.ndim == 1:
        arr = np.vstack([-arr, arr]).T
    shifted = arr - np.max(arr, axis=1, keepdims=True)
    exps = np.exp(shifted)
    return exps / np.sum(exps, axis=1, keepdims=True)



def ensure_required_columns(df: pd.DataFrame) -> None:
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Evaluation CSV is missing required columns: {sorted(missing)}")



def main() -> None:
    args = parse_args()
    eval_csv = Path(args.eval_csv)
    model_path = Path(args.model)
    vectorizer_path = Path(args.vectorizer)
    label_order_path = Path(args.label_order)
    output_path = Path(args.output)

    df = pd.read_csv(eval_csv)
    ensure_required_columns(df)

    cleaner = load_cleaner(args.cleaner_module, args.cleaner_func)
    texts = df["text"].fillna("").astype(str).map(cleaner)

    model = joblib.load(model_path)
    vectorizer = joblib.load(vectorizer_path)
    with open(label_order_path, "r", encoding="utf-8") as f:
        label_order = json.load(f)

    X = vectorizer.transform(texts)

    if hasattr(model, "predict_proba"):
        probabilities = normalize_proba(model.predict_proba(X))
    elif hasattr(model, "decision_function"):
        probabilities = decision_to_softmax(model.decision_function(X))
    else:
        raise TypeError("Model supports neither predict_proba nor decision_function")

    if hasattr(model, "classes_"):
        model_classes = list(model.classes_)
    else:
        model_classes = list(label_order)

    proba_by_label = {label: np.zeros(len(df), dtype=float) for label in label_order}
    for idx, label in enumerate(model_classes):
        if label in proba_by_label and idx < probabilities.shape[1]:
            proba_by_label[label] = probabilities[:, idx]

    # make sure all expected probability columns exist even if label order differs
    for label in LABEL_TO_PROB_COL:
        proba_by_label.setdefault(label, np.zeros(len(df), dtype=float))

    pred_indices = np.argmax(
        np.column_stack([proba_by_label[label] for label in label_order]), axis=1
    )
    predicted_labels = [label_order[i] for i in pred_indices]
    top_confidence = [float(max(proba_by_label[label][row] for label in label_order)) for row in range(len(df))]

    out = df.copy()
    out["predicted_label"] = predicted_labels
    out["top_confidence"] = np.round(top_confidence, 6)
    out["correct"] = out["predicted_label"] == out["true_label"]

    for label, col_name in LABEL_TO_PROB_COL.items():
        out[col_name] = np.round(proba_by_label[label], 6)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_path, index=False, encoding="utf-8-sig")

    print(f"Saved: {output_path}")
    print(f"Rows: {len(out)}")
    print("Added columns: predicted_label, top_confidence, correct, pred_politics, pred_tech, pred_society, pred_economy")


if __name__ == "__main__":
    main()

