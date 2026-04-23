from pathlib import Path
import json
import pandas as pd
from joblib import dump
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score, f1_score
from sklearn.model_selection import train_test_split

INPUT = Path("data/processed/training_rebalanced_v2.csv")
ARTIFACT_DIR = Path("artifacts")
RESULT_DIR = Path("ml/evaluation/results")

MODEL_OUT = ARTIFACT_DIR / "model_v2.joblib"
VECTORIZER_OUT = ARTIFACT_DIR / "vectorizer_v2.joblib"
LABEL_ORDER_OUT = ARTIFACT_DIR / "label_order_v2.json"
TRAIN_SUMMARY_OUT = RESULT_DIR / "train_v2_summary.txt"

ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_LABEL_ORDER = [
    "Economy & Business",
    "Politics & Governance",
    "Society & Health",
    "Technology & Cyber",
]

V1_LABEL_ORDER = ARTIFACT_DIR / "label_order_v1.json"

if V1_LABEL_ORDER.exists():
    with open(V1_LABEL_ORDER, "r", encoding="utf-8") as f:
        label_order = json.load(f)
else:
    label_order = DEFAULT_LABEL_ORDER

df = pd.read_csv(INPUT, low_memory=False)

for col in ["text", "clean_text", "label", "source_dataset"]:
    df[col] = df[col].fillna("").astype(str).str.strip()

df = df[
    (df["clean_text"] != "") &
    (df["label"] != "")
].copy()

df = df[df["label"].isin(label_order)].copy()

X = df["clean_text"]
y = df["label"]

X_train, X_val, y_train, y_val = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
    stratify=y,
)

vectorizer = TfidfVectorizer(
    ngram_range=(1, 2),
    min_df=2,
    max_df=0.95,
    sublinear_tf=True,
)

X_train_vec = vectorizer.fit_transform(X_train)
X_val_vec = vectorizer.transform(X_val)

model = LogisticRegression(
    max_iter=2000,
    random_state=42,
)

model.fit(X_train_vec, y_train)

val_preds = model.predict(X_val_vec)

accuracy = accuracy_score(y_val, val_preds)
macro_f1 = f1_score(y_val, val_preds, average="macro")
report = classification_report(y_val, val_preds, labels=label_order, digits=4)

dump(model, MODEL_OUT)
dump(vectorizer, VECTORIZER_OUT)

with open(LABEL_ORDER_OUT, "w", encoding="utf-8") as f:
    json.dump(label_order, f, ensure_ascii=False, indent=2)

with open(TRAIN_SUMMARY_OUT, "w", encoding="utf-8") as f:
    f.write(f"Input rows: {len(df)}\n")
    f.write(f"Train rows: {len(X_train)}\n")
    f.write(f"Validation rows: {len(X_val)}\n")
    f.write(f"Accuracy: {accuracy:.4f}\n")
    f.write(f"Macro F1: {macro_f1:.4f}\n\n")
    f.write("Label counts:\n")
    f.write(df["label"].value_counts().to_string())
    f.write("\n\n")
    f.write("Validation classification report:\n")
    f.write(report)
    f.write("\n")

print(f"Saved model to: {MODEL_OUT}")
print(f"Saved vectorizer to: {VECTORIZER_OUT}")
print(f"Saved label order to: {LABEL_ORDER_OUT}")
print(f"Saved summary to: {TRAIN_SUMMARY_OUT}")
print(f"Accuracy: {accuracy:.4f}")
print(f"Macro F1: {macro_f1:.4f}")
print("\nValidation report:")
print(report)