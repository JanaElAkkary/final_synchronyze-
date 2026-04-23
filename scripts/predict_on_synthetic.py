import json
import os
import sys

import joblib
import pandas as pd


current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


from packages.intelligence_core.preprocessing import preprocess_text


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


def load_synthetic_posts(path):
    if not os.path.exists(path):
        print("Synthetic posts file not found:", path)
        return None
    print("Loading synthetic posts from:", path)
    df = pd.read_csv(path)
    print("Loaded rows:", len(df))
    return df


def build_label_index_map(model, label_order):
    model_labels = model.classes_
    label_to_index = {}
    for i in range(len(model_labels)):
        label_name = model_labels[i]
        label_to_index[label_name] = i

    index_sequence = []
    for i in range(len(label_order)):
        label_name = label_order[i]
        if label_name in label_to_index:
            index_sequence.append(label_to_index[label_name])
        else:
            index_sequence.append(-1)

    return index_sequence


def predict_on_synthetic(df, vectorizer, model, label_order):
    index_sequence = build_label_index_map(model, label_order)

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
        for i in range(len(index_sequence)):
            model_index = index_sequence[i]
            if model_index >= 0 and model_index < len(probs):
                topic_value = float(probs[model_index])
            else:
                topic_value = 0.0
            topic_vector.append(topic_value)

        platform = ""
        if "platform" in df.columns:
            platform = row["platform"]
        actor_handle = ""
        if "actor_handle" in df.columns:
            actor_handle = row["actor_handle"]
        created_at = ""
        if "created_at" in df.columns:
            created_at = row["created_at"]

        output_row = {
            "platform": platform,
            "actor_handle": actor_handle,
            "created_at": created_at,
            "text": text,
            "clean_text": clean_text,
            "predicted_label": predicted_label,
            "confidence": confidence,
            "topic_vector": json.dumps(topic_vector),
        }
        rows.append(output_row)

        if len(examples) < 5:
            examples.append(output_row)

    return rows, examples


def save_predictions(rows, output_path):
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    print("Saved predictions to:", output_path)


def print_examples(examples):
    print("Example predictions:")
    for row in examples:
        text = row["text"]
        if not isinstance(text, str):
            text = str(text)
        snippet = text
        if len(snippet) > 120:
            snippet = snippet[:120]
        print("platform:", row["platform"])
        print("actor_handle:", row["actor_handle"])
        print("created_at:", row["created_at"])
        print("predicted_label:", row["predicted_label"])
        print("confidence:", row["confidence"])
        print("text:", snippet)
        print("---")


def main():
    vectorizer, model, label_order = load_artifacts()
    input_path = "data/synthetic/synthetic_posts.csv"
    df = load_synthetic_posts(input_path)
    if df is None:
        return

    rows, examples = predict_on_synthetic(df, vectorizer, model, label_order)
    output_path = "data/synthetic/synthetic_predictions.csv"
    save_predictions(rows, output_path)
    print_examples(examples)


if __name__ == "__main__":
    main()

