import os
import sys

import joblib
import pandas as pd


project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


from packages.intelligence_core.preprocessing import preprocess_text, download_nltk
from packages.shared_contracts.analysis_contract import LABEL_ORDER, make_analysis_result


class AnalysisPipeline:
    def __init__(self, artifacts_dir="artifacts"):
        self.artifacts_dir = artifacts_dir

        vectorizer_path = os.path.join(self.artifacts_dir, "vectorizer.joblib")
        model_path = os.path.join(self.artifacts_dir, "model.joblib")

        self.vectorizer = joblib.load(vectorizer_path)
        self.model = joblib.load(model_path)

        self.labels = []
        if LABEL_ORDER is not None and len(LABEL_ORDER) > 0:
            for label in LABEL_ORDER:
                self.labels.append(label)
        else:
            for cls in self.model.classes_:
                self.labels.append(str(cls))

        self.model_version = "tfidf_lr_v1"

    def ensure_nltk(self):
        download_nltk()

    def preprocess(self, text):
        return preprocess_text(text)

    def predict_text(self, text):
        clean = preprocess_text(text)

        documents = [clean]
        X = self.vectorizer.transform(documents)

        prob_matrix = self.model.predict_proba(X)
        proba = prob_matrix[0]

        labels_pred = self.model.predict(X)
        label = labels_pred[0]

        confidence = None
        for i in range(len(proba)):
            value = float(proba[i])
            if confidence is None:
                confidence = value
            else:
                if value > confidence:
                    confidence = value

        topic_vector = []
        for label_name in self.labels:
            index = None
            for i in range(len(self.model.classes_)):
                class_name = self.model.classes_[i]
                if class_name == label_name:
                    index = i
                    break
            if index is None:
                value = 0.0
            else:
                value = float(proba[index])
            topic_vector.append(value)

        result = make_analysis_result(
            clean,
            label,
            confidence,
            topic_vector,
            self.model_version,
        )
        return result

    def predict_csv(self, input_csv, output_csv, text_col="text", platform_name="unknown"):
        print("Loading data from:", input_csv)
        df = pd.read_csv(input_csv)
        print("Loaded rows:", len(df))

        if text_col not in df.columns:
            print("Column not found:", text_col)
            return

        rows = []

        for index, row in df.iterrows():
            text = row[text_col]
            if not isinstance(text, str):
                if pd.isna(text):
                    text = ""
                else:
                    text = str(text)

            prediction = self.predict_text(text)

            topic_vector_str = json.dumps(prediction["topic_vector"])

            out_row = {
                "platform": platform_name,
                "text": text,
                "clean_text": prediction["clean_text"],
                "predicted_label": prediction["predicted_label"],
                "confidence": prediction["confidence"],
                "topic_vector": topic_vector_str,
            }
            rows.append(out_row)

        if len(rows) == 0:
            print("No rows to save.")
            return

        output_dir = os.path.dirname(output_csv)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)

        out_df = pd.DataFrame(rows)
        out_df.to_csv(output_csv, index=False)
        print("Saved predictions to:", output_csv)


if __name__ == "__main__":
    pipeline = AnalysisPipeline()
    pipeline.ensure_nltk()

    examples = [
        "The government announced a new tax reform affecting small businesses.",
        "A major data breach exposed millions of users' personal information online.",
    ]

    for text in examples:
        prediction = pipeline.predict_text(text)
        print("Text:", text)
        print("Prediction:", prediction)
        print("---")
