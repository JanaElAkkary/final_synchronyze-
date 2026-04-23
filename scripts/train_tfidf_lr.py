import json
import os

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split


def load_data(path):
    print("Loading data from:", path)
    df = pd.read_csv(path)
    print("Loaded rows:", len(df))

    if "osint_topic" in df.columns:
        before_rows = len(df)
        df = df.dropna(subset=["osint_topic"])
        after_rows = len(df)
        if after_rows != before_rows:
            print("Dropped rows with missing osint_topic:", before_rows - after_rows)

    if "clean_text" in df.columns:
        missing_before = df["clean_text"].isna().sum()
        if missing_before > 0:
            print("Filling missing clean_text values:", missing_before)
        df["clean_text"] = df["clean_text"].fillna("").astype(str)

    return df


def split_data(df):
    print("Preparing features and labels...")
    X = df["clean_text"]
    y = df["osint_topic"]

    print("Splitting into train and validation sets...")
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print("Train size:", len(X_train))
    print("Validation size:", len(X_val))
    return X_train, X_val, y_train, y_val


def train_vectorizer(X_train, X_val):
    print("Training TF-IDF vectorizer...")
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), max_features=50000)
    X_train_vec = vectorizer.fit_transform(X_train)
    X_val_vec = vectorizer.transform(X_val)
    print("Vectorizer fitted. Train shape:", X_train_vec.shape)
    print("Validation shape:", X_val_vec.shape)
    return vectorizer, X_train_vec, X_val_vec


def train_model(X_train_vec, y_train):
    print("Training Logistic Regression model...")
    model = LogisticRegression(max_iter=2000)
    model.fit(X_train_vec, y_train)
    print("Model training complete.")
    return model


def evaluate_model(model, X_val_vec, y_val):
    print("Evaluating model...")
    y_pred = model.predict(X_val_vec)
    acc = accuracy_score(y_val, y_pred)
    print("Accuracy:", acc)

    labels = model.classes_
    cm = confusion_matrix(y_val, y_pred, labels=labels)

    print("Confusion matrix labels:")
    for label in labels:
        print(label)

    print("Confusion matrix values:")
    for i in range(len(cm)):
        row = cm[i]
        row_values = []
        for j in range(len(row)):
            value = row[j]
            row_values.append(str(value))
        print(" ".join(row_values))

    return acc, cm, labels


def save_artifacts(vectorizer, model, labels):
    artifacts_dir = "artifacts"
    if not os.path.exists(artifacts_dir):
        os.makedirs(artifacts_dir)

    vectorizer_path = os.path.join(artifacts_dir, "vectorizer.joblib")
    model_path = os.path.join(artifacts_dir, "model.joblib")
    label_order_path = os.path.join(artifacts_dir, "label_order.json")

    print("Saving vectorizer to:", vectorizer_path)
    joblib.dump(vectorizer, vectorizer_path)

    print("Saving model to:", model_path)
    joblib.dump(model, model_path)

    labels_list = labels.tolist()
    print("Saving label order to:", label_order_path)
    with open(label_order_path, "w", encoding="utf-8") as f:
        json.dump(labels_list, f)

    print("DONE")
    print("Saved files:")
    print(" -", vectorizer_path)
    print(" -", model_path)
    print(" -", label_order_path)


def main():
    data_path = "data/processed/training_clean.csv"
    df = load_data(data_path)
    X_train, X_val, y_train, y_val = split_data(df)
    vectorizer, X_train_vec, X_val_vec = train_vectorizer(X_train, X_val)
    model = train_model(X_train_vec, y_train)
    evaluate_model(model, X_val_vec, y_val)
    save_artifacts(vectorizer, model, model.classes_)


if __name__ == "__main__":
    main()

