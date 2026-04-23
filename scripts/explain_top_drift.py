import json
import os

import pandas as pd


def load_weekly_profiles(path):
    if not os.path.exists(path):
        print("Weekly profiles file not found:", path)
        return None
    print("Loading weekly profiles from:", path)
    df = pd.read_csv(path)
    print("Loaded weekly profiles rows:", len(df))
    return df


def load_drift_scores(path):
    if not os.path.exists(path):
        print("Drift scores file not found:", path)
        return None
    print("Loading drift scores from:", path)
    df = pd.read_csv(path)
    print("Loaded drift score rows:", len(df))
    return df


def load_label_order(path):
    if not os.path.exists(path):
        print("Label order file not found:", path)
        return None
    print("Loading label order from:", path)
    with open(path, "r", encoding="utf-8") as f:
        labels = json.load(f)
    print("Loaded labels:", labels)
    return labels


def parse_mean_vector(value):
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return None
        try:
            vector = json.loads(text)
        except Exception:
            return None
        if not isinstance(vector, list):
            return None
        cleaned = []
        for item in vector:
            try:
                number = float(item)
            except Exception:
                return None
            cleaned.append(number)
        return cleaned
    elif isinstance(value, list):
        cleaned = []
        for item in value:
            try:
                number = float(item)
            except Exception:
                return None
            cleaned.append(number)
        return cleaned
    else:
        return None


def build_profile_lookup(df):
    lookup = {}
    has_actor = "actor_handle" in df.columns
    has_week = "week_key" in df.columns
    has_vector = "mean_vector" in df.columns

    if not has_actor or not has_week or not has_vector:
        return lookup

    for index, row in df.iterrows():
        actor = row["actor_handle"]
        week_key = row["week_key"]
        if not isinstance(actor, str) or not isinstance(week_key, str):
            continue
        vector_value = row["mean_vector"]
        vector = parse_mean_vector(vector_value)
        if vector is None:
            continue
        key = (actor, week_key)
        lookup[key] = vector

    return lookup


def get_top_label(vector, label_order):
    if vector is None or label_order is None:
        return None, 0.0
    if len(vector) == 0 or len(label_order) == 0:
        return None, 0.0

    max_index = 0
    max_value = float(vector[0])

    for i in range(len(vector)):
        value = float(vector[i])
        if i == 0:
            max_value = value
            max_index = 0
        else:
            if value > max_value:
                max_value = value
                max_index = i

    label = None
    if max_index < len(label_order):
        label = label_order[max_index]

    return label, max_value


def get_top_drift_rows(df, top_n):
    rows = []

    has_actor = "actor_handle" in df.columns
    has_prev = "week_prev" in df.columns
    has_curr = "week_curr" in df.columns
    has_score = "drift_score" in df.columns

    if not has_actor or not has_prev or not has_curr or not has_score:
        return rows

    for index, row in df.iterrows():
        actor = row["actor_handle"]
        week_prev = row["week_prev"]
        week_curr = row["week_curr"]
        score_value = row["drift_score"]

        try:
            score = float(score_value)
        except Exception:
            continue

        item = {
            "actor_handle": actor,
            "week_prev": week_prev,
            "week_curr": week_curr,
            "drift_score": score,
        }
        rows.append(item)

    if len(rows) == 0:
        return rows

    sorted_rows = sorted(rows, key=lambda x: x["drift_score"], reverse=True)

    top_rows = []
    count = 0
    for item in sorted_rows:
        top_rows.append(item)
        count = count + 1
        if count >= top_n:
            break

    return top_rows


def explain_top_drift():
    weekly_path = "data/synthetic/weekly_profiles.csv"
    drift_path = "data/synthetic/drift_scores.csv"
    label_order_path = "artifacts/label_order.json"

    weekly_df = load_weekly_profiles(weekly_path)
    if weekly_df is None:
        return

    drift_df = load_drift_scores(drift_path)
    if drift_df is None:
        return

    label_order = load_label_order(label_order_path)
    if label_order is None:
        return

    profile_lookup = build_profile_lookup(weekly_df)
    top_drift_rows = get_top_drift_rows(drift_df, top_n=3)

    if len(top_drift_rows) == 0:
        print("No drift rows to explain.")
        return

    print("Top drift explanations:")
    for item in top_drift_rows:
        actor = item["actor_handle"]
        week_prev = item["week_prev"]
        week_curr = item["week_curr"]
        drift_score = item["drift_score"]

        key_prev = (actor, week_prev)
        key_curr = (actor, week_curr)

        vec_prev = None
        vec_curr = None

        if key_prev in profile_lookup:
            vec_prev = profile_lookup[key_prev]
        if key_curr in profile_lookup:
            vec_curr = profile_lookup[key_curr]

        label_prev, score_prev = get_top_label(vec_prev, label_order)
        label_curr, score_curr = get_top_label(vec_curr, label_order)

        print("Actor:", actor)
        print(
            " Week",
            week_prev,
            "top:",
            label_prev,
            "(",
            score_prev,
            ")",
        )
        print(
            " Week",
            week_curr,
            "top:",
            label_curr,
            "(",
            score_curr,
            ")",
        )
        print(" Drift score:", drift_score)
        print("---")


def main():
    explain_top_drift()


if __name__ == "__main__":
    main()

