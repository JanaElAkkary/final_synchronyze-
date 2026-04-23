# scripts/compute_drift_scores.py

import os
import json
import math
import pandas as pd

INPUT_PATH = "data/synthetic/weekly_profiles.csv"
OUTPUT_PATH = "data/synthetic/drift_scores.csv"


def cosine_distance(a, b):
    # a and b are lists of floats with same length
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0

    i = 0
    while i < len(a):
        dot = dot + (a[i] * b[i])
        norm_a = norm_a + (a[i] * a[i])
        norm_b = norm_b + (b[i] * b[i])
        i = i + 1

    if norm_a == 0.0:
        return 0.0
    if norm_b == 0.0:
        return 0.0

    denom = math.sqrt(norm_a) * math.sqrt(norm_b)
    if denom == 0.0:
        return 0.0

    sim = dot / denom
    return 1.0 - sim


def safe_json_loads(value):
    # value is expected to be a JSON string like "[0.1, 0.2, ...]"
    if value is None:
        return None
    try:
        vec = json.loads(value)
        if vec is None:
            return None
        if type(vec) is not list:
            return None
        return vec
    except Exception:
        return None


def main():
    if not os.path.exists(INPUT_PATH):
        print("❌ Missing input file:", INPUT_PATH)
        print("Run build_weekly_profiles.py first to create weekly_profiles.csv")
        return

    print("Loading weekly profiles from:", INPUT_PATH)
    df = pd.read_csv(INPUT_PATH)
    print("Loaded rows:", len(df))

    # Collect rows per actor
    actors = {}  # actor_handle -> list of items {week_key, mean_vector}
    i = 0
    while i < len(df):
        actor = df.loc[i, "actor_handle"]
        week_key = df.loc[i, "week_key"]
        mean_vec_raw = df.loc[i, "mean_vector"]

        vec = safe_json_loads(mean_vec_raw)
        if vec is None:
            i = i + 1
            continue

        # Ensure floats
        j = 0
        while j < len(vec):
            try:
                vec[j] = float(vec[j])
            except Exception:
                vec[j] = 0.0
            j = j + 1

        item = {"week_key": str(week_key), "mean_vector": vec}

        if actor not in actors:
            actors[actor] = []
        actors[actor].append(item)

        i = i + 1

    print("Actors found:", len(actors))

    # Compute drift rows
    drift_rows = []
    for actor in actors:
        items = actors[actor]

        # Sort items by week_key (format YYYY-WW -> string sort works)
        items.sort(key=lambda x: x["week_key"])

        k = 1
        while k < len(items):
            prev_week = items[k - 1]["week_key"]
            curr_week = items[k]["week_key"]

            prev_vec = items[k - 1]["mean_vector"]
            curr_vec = items[k]["mean_vector"]

            drift = cosine_distance(prev_vec, curr_vec)

            drift_rows.append({
                "actor_handle": actor,
                "week_prev": prev_week,
                "week_curr": curr_week,
                "drift_score": drift
            })

            k = k + 1

    # Save output
    out_df = pd.DataFrame(drift_rows)
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    out_df.to_csv(OUTPUT_PATH, index=False)

    print("Saved drift scores to:", OUTPUT_PATH)
    print("Total drift rows:", len(out_df))

    # Print top 10 drift scores
    if len(drift_rows) == 0:
        print("No drift rows computed.")
        return

    drift_rows.sort(key=lambda x: x["drift_score"], reverse=True)

    print("\nTop 10 drift scores:")
    n = 10
    if len(drift_rows) < 10:
        n = len(drift_rows)

    t = 0
    while t < n:
        r = drift_rows[t]
        print(
            str(t + 1) + ")",
            r["actor_handle"],
            r["week_prev"], "->", r["week_curr"],
            "| drift =", round(r["drift_score"], 4)
        )
        t = t + 1


if __name__ == "__main__":
    main()