import json
import os
from datetime import datetime

import pandas as pd

def load_predictions(path):
    if not os.path.exists(path):
        print("File not found:", path)
        return None
    print("Loading synthetic predictions from:", path)
    df = pd.read_csv(path)
    print("Loaded rows:", len(df))
    return df


def parse_topic_vector(value):
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


def get_week_key(date_str):
    if not isinstance(date_str, str):
        return None
    try:
        dt = datetime.fromisoformat(date_str)
    except Exception:
        return None
    iso = dt.isocalendar()
    year = iso[0]
    week = iso[1]
    if week < 10:
        week_str = "0" + str(week)
    else:
        week_str = str(week)
    week_key = str(year) + "-" + week_str
    return week_key


def build_profiles(df):
    profiles = {}

    for index, row in df.iterrows():
        actor = None
        if "actor_handle" in df.columns:
            actor = row["actor_handle"]
        if actor is None:
            continue
        week_key = None
        if "created_at" in df.columns:
            week_key = get_week_key(row["created_at"])
        if week_key is None:
            continue

        if "topic_vector" not in df.columns:
            continue

        vector_value = row["topic_vector"]
        vector = parse_topic_vector(vector_value)
        if vector is None:
            continue

        key = (actor, week_key)
        if key not in profiles:
            sum_vector = []
            for i in range(len(vector)):
                sum_vector.append(0.0)
            profiles[key] = {"sum_vector": sum_vector, "count": 0}

        entry = profiles[key]
        sum_vector = entry["sum_vector"]
        if len(sum_vector) != len(vector):
            continue

        for i in range(len(vector)):
            sum_vector[i] = sum_vector[i] + vector[i]

        entry["count"] = entry["count"] + 1

    rows = []
    for key in profiles:
        actor = key[0]
        week_key = key[1]
        entry = profiles[key]
        count = entry["count"]
        if count <= 0:
            continue

        sum_vector = entry["sum_vector"]
        mean_vector = []
        for i in range(len(sum_vector)):
            value = sum_vector[i] / float(count)
            mean_vector.append(value)

        row = {
            "actor_handle": actor,
            "week_key": week_key,
            "post_count": count,
            "mean_vector": json.dumps(mean_vector),
        }
        rows.append(row)

    return rows


def save_profiles(rows, output_path):
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    print("Saved weekly profiles to:", output_path)


def print_summary(rows):
    total = len(rows)
    print("Total weekly profiles created:", total)
    print("First 5 profiles:")
    max_rows = 5
    count = 0
    for row in rows:
        print(
            "actor_handle:",
            row["actor_handle"],
            "| week_key:",
            row["week_key"],
            "| post_count:",
            row["post_count"],
        )
        count = count + 1
        if count >= max_rows:
            break


def main():
    input_path = "data/synthetic/synthetic_predictions.csv"
    df = load_predictions(input_path)
    if df is None:
        return
    rows = build_profiles(df)
    output_path = "data/synthetic/weekly_profiles.csv"
    save_profiles(rows, output_path)
    print_summary(rows)


if __name__ == "__main__":
    main()

