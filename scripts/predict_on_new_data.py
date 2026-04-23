import json
import os
import sys

import joblib
import pandas as pd


current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


from packages.intelligence_core.preprocessing import preprocess_text, download_nltk


def load_artifacts():
    artifacts_dir = "artifacts"
    vectorizer_path = os.path.join(artifacts_dir, "vectorizer.joblib")
    model_path = os.path.join(artifacts_dir, "model.joblib")
    label_order_path = os.path.join(artifacts_dir, "label_order.json")

    print("Loading artifacts...")
    print("Vectorizer:", vectorizer_path)
    print("Model:", model_path)
    print("Label order:", label_order_path)

    vectorizer = joblib.load(vectorizer_path)
    model = joblib.load(model_path)

    with open(label_order_path, "r", encoding="utf-8") as f:
        label_order = json.load(f)

    print("Artifacts loaded.")
    return vectorizer, model, label_order


def ensure_output_dir():
    output_dir = "data/processed"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    return output_dir


def load_dataset(path):
    if not os.path.exists(path):
        print("File not found, skipping:", path)
        return None
    print("Loading dataset from:", path)
    df = pd.read_csv(path)
    print("Loaded rows:", len(df))
    return df


def predict_for_dataset(name, input_path, output_path, vectorizer, model, label_order):
    df = load_dataset(input_path)
    if df is None:
        return

    if "text" not in df.columns:
        print("Column 'text' not found in", input_path, "- skipping.")
        return

    print("Running predictions for:", name)

    rows = []
    examples = []

    for index, row in df.iterrows():
        text = row["text"]
        if not isinstance(text, str):
            if pd.isna(text):
                text = ""
            else:
                text = str(text)

        clean_text = preprocess_text(text)

        documents = [clean_text]
        X_vec = vectorizer.transform(documents)

        prob_matrix = model.predict_proba(X_vec)
        probs = prob_matrix[0]

        predicted_labels = model.predict(X_vec)
        predicted_label = predicted_labels[0]

        confidence = None
        for i in range(len(probs)):
            value = float(probs[i])
            if confidence is None:
                confidence = value
            else:
                if value > confidence:
                    confidence = value

        topic_vector = []
        for i in range(len(probs)):
            topic_vector.append(float(probs[i]))

        output_row = {
            "text": text,
            "clean_text": clean_text,
            "predicted_topic": predicted_label,
            "confidence": confidence,
            "topic_vector": json.dumps(topic_vector),
        }
        rows.append(output_row)

        if len(examples) < 5:
            examples.append(output_row)

    if len(rows) == 0:
        print("No rows to save for:", name)
        return

    predictions_df = pd.DataFrame(rows)
    predictions_df.to_csv(output_path, index=False)
    print("Saved predictions to:", output_path)

    print("Example predictions for", name, ":")
    for example in examples:
        text_snippet = example["text"]
        if not isinstance(text_snippet, str):
            text_snippet = str(text_snippet)
        max_length = 120
        if len(text_snippet) > max_length:
            text_snippet = text_snippet[:max_length]
        print("Text:", text_snippet)
        print("Predicted topic:", example["predicted_topic"])
        print("Confidence:", example["confidence"])
        print("---")


def main():
    download_nltk()
    vectorizer, model, label_order = load_artifacts()
    output_dir = ensure_output_dir()

    twitter_input = "data/new/twitter_test.csv"
    reddit_input = "data/new/reddit_test.csv"

    twitter_output = os.path.join(output_dir, "twitter_predictions.csv")
    reddit_output = os.path.join(output_dir, "reddit_predictions.csv")

    predict_for_dataset(
        "twitter", twitter_input, twitter_output, vectorizer, model, label_order
    )
    predict_for_dataset(
        "reddit", reddit_input, reddit_output, vectorizer, model, label_order
    )


if __name__ == "__main__":
    main()

