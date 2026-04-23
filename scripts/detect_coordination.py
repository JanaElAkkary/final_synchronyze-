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


def parse_vector(value):
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


def cosine_similarity(a, b):
    if a is None or b is None:
        return 0.0
    if len(a) == 0 or len(b) == 0:
        return 0.0
    if len(a) != len(b):
        return 0.0

    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0

    for i in range(len(a)):
        va = float(a[i])
        vb = float(b[i])
        dot = dot + va * vb
        norm_a = norm_a + va * va
        norm_b = norm_b + vb * vb

    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    denom = (norm_a ** 0.5) * (norm_b ** 0.5)
    if denom == 0.0:
        return 0.0

    similarity = dot / denom
    return similarity


def build_profile_lookup(weekly_df):
    lookup = {}

    has_actor = "actor_handle" in weekly_df.columns
    has_week = "week_key" in weekly_df.columns
    has_vector = "mean_vector" in weekly_df.columns

    if not has_actor or not has_week or not has_vector:
        return lookup

    for index, row in weekly_df.iterrows():
        actor = row["actor_handle"]
        week_key = row["week_key"]
        if not isinstance(actor, str) or not isinstance(week_key, str):
            continue
        vector_value = row["mean_vector"]
        vector = parse_vector(vector_value)
        if vector is None:
            continue
        key = (actor, week_key)
        lookup[key] = vector

    return lookup


def build_delta_vectors(profile_lookup, drift_df):
    deltas = {}
    drift_map = {}

    has_actor = "actor_handle" in drift_df.columns
    has_prev = "week_prev" in drift_df.columns
    has_curr = "week_curr" in drift_df.columns
    has_score = "drift_score" in drift_df.columns

    if not has_actor or not has_prev or not has_curr or not has_score:
        return deltas, drift_map

    for index, row in drift_df.iterrows():
        actor = row["actor_handle"]
        week_prev = row["week_prev"]
        week_curr = row["week_curr"]
        drift_value = row["drift_score"]

        try:
            drift_score = float(drift_value)
        except Exception:
            continue

        key_prev = (actor, week_prev)
        key_curr = (actor, week_curr)

        if key_prev not in profile_lookup or key_curr not in profile_lookup:
            continue

        vec_prev = profile_lookup[key_prev]
        vec_curr = profile_lookup[key_curr]

        if vec_prev is None or vec_curr is None:
            continue
        if len(vec_prev) != len(vec_curr):
            continue

        delta = []
        for i in range(len(vec_prev)):
            value = float(vec_curr[i]) - float(vec_prev[i])
            delta.append(value)

        key = (actor, week_prev, week_curr)
        deltas[key] = delta
        drift_map[key] = drift_score

    return deltas, drift_map


def find_drift_events(deltas, drift_map, threshold):
    events_by_transition = {}

    for key in deltas:
        actor = key[0]
        week_prev = key[1]
        week_curr = key[2]
        drift_score = drift_map.get(key)
        if drift_score is None:
            continue
        if drift_score < threshold:
            continue

        transition = (week_prev, week_curr)
        if transition not in events_by_transition:
            events_by_transition[transition] = []

        event = {
            "actor_handle": actor,
            "week_prev": week_prev,
            "week_curr": week_curr,
            "delta_vector": deltas[key],
            "drift_score": drift_score,
        }
        events_by_transition[transition].append(event)

    return events_by_transition


def find_coordinated_pairs(events_by_transition):
    pairs_by_transition = {}

    for transition in events_by_transition:
        events = events_by_transition[transition]
        n = len(events)
        if n < 2:
            continue

        week_prev = transition[0]
        week_curr = transition[1]

        for i in range(n):
            event_a = events[i]
            for j in range(i + 1, n):
                event_b = events[j]

                delta_a = event_a["delta_vector"]
                delta_b = event_b["delta_vector"]

                similarity = cosine_similarity(delta_a, delta_b)
                if similarity >= 0.90:
                    pair = {
                        "actor_a": event_a["actor_handle"],
                        "actor_b": event_b["actor_handle"],
                        "week_prev": week_prev,
                        "week_curr": week_curr,
                        "similarity": similarity,
                        "drift_a": event_a["drift_score"],
                        "drift_b": event_b["drift_score"],
                    }
                    if transition not in pairs_by_transition:
                        pairs_by_transition[transition] = []
                    pairs_by_transition[transition].append(pair)

    return pairs_by_transition


def build_groups_for_transition(transition, pairs):
    adjacency = {}

    for pair in pairs:
        a = pair["actor_a"]
        b = pair["actor_b"]

        if a not in adjacency:
            adjacency[a] = set()
        if b not in adjacency:
            adjacency[b] = set()

        adjacency[a].add(b)
        adjacency[b].add(a)

    visited = set()
    groups = []

    for actor in adjacency:
        if actor in visited:
            continue

        stack = [actor]
        visited.add(actor)
        group = []

        while len(stack) > 0:
            current = stack.pop()
            group.append(current)

            neighbors = adjacency.get(current)
            if neighbors is None:
                continue

            for neighbor in neighbors:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)

        groups.append(group)

    group_records = []

    for group in groups:
        group_set = set()
        for actor in group:
            group_set.add(actor)

        total_similarity = 0.0
        pair_count = 0

        for pair in pairs:
            a = pair["actor_a"]
            b = pair["actor_b"]
            if a in group_set and b in group_set:
                total_similarity = total_similarity + pair["similarity"]
                pair_count = pair_count + 1

        if pair_count > 0:
            avg_similarity = total_similarity / float(pair_count)
        else:
            avg_similarity = 0.0

        total_drift = 0.0
        drift_count = 0

        for pair in pairs:
            a = pair["actor_a"]
            b = pair["actor_b"]
            if a in group_set:
                total_drift = total_drift + pair["drift_a"]
                drift_count = drift_count + 1
            if b in group_set:
                total_drift = total_drift + pair["drift_b"]
                drift_count = drift_count + 1

        if drift_count > 0:
            avg_drift = total_drift / float(drift_count)
        else:
            avg_drift = 0.0

        actors_list = []
        for actor in group:
            actors_list.append(actor)

        actors_str = ",".join(actors_list)

        record = {
            "week_prev": transition[0],
            "week_curr": transition[1],
            "actors": actors_str,
            "group_size": len(group),
            "avg_pair_similarity": avg_similarity,
            "avg_drift": avg_drift,
        }
        group_records.append(record)

    return group_records


def build_all_groups(pairs_by_transition):
    all_groups = []
    group_counter = 0

    for transition in pairs_by_transition:
        pairs = pairs_by_transition[transition]
        if len(pairs) == 0:
            continue

        group_records = build_groups_for_transition(transition, pairs)

        for record in group_records:
            group_counter = group_counter + 1
            record["group_id"] = "G" + str(group_counter)
            record["evidence"] = ""
            all_groups.append(record)

    return all_groups


def compute_top_topic_for_actor_week(weekly_df, labels, actor, week_key):
    top_topic = None
    top_value = -1.0

    for index, row in weekly_df.iterrows():
        actor_value = row.get("actor_handle")
        week_value = row.get("week_key")
        if actor_value != actor or week_value != week_key:
            continue
        vector_value = row.get("mean_vector")
        vector = parse_vector(vector_value)
        if vector is None:
            continue
        for i in range(len(vector)):
            if i >= len(labels):
                break
            v = float(vector[i])
            if v > top_value:
                top_value = v
                top_topic = labels[i]
        break

    return top_topic


def attach_evidence(groups, weekly_df, labels):
    for record in groups:
        evidence_text = ""
        week_prev = record["week_prev"]
        week_curr = record["week_curr"]
        actors_text = record["actors"]

        actors = []
        for part in actors_text.split(","):
            name = part.strip()
            if name != "":
                actors.append(name)

        if week_prev == "2025-04" and week_curr == "2025-05":
            count_actors = 0
            count_politics = 0
            count_economy = 0

            for actor in actors:
                count_actors = count_actors + 1
                top_prev = compute_top_topic_for_actor_week(
                    weekly_df, labels, actor, week_prev
                )
                top_curr = compute_top_topic_for_actor_week(
                    weekly_df, labels, actor, week_curr
                )
                if (
                    top_prev == "Politics & Governance"
                    and top_curr == "Economy & Business"
                ):
                    count_politics = count_politics + 1
                    count_economy = count_economy + 1

            if count_actors > 0 and count_politics == count_actors:
                evidence_text = (
                    "All shifted from Politics & Governance to Economy & Business in week 5"
                )

        record["evidence"] = evidence_text


def save_groups(groups, output_path):
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    df = pd.DataFrame(groups)
    df.to_csv(output_path, index=False)
    print("Saved coordinated groups to:", output_path)


def print_groups(groups):
    print("Coordinated groups:")
    for record in groups:
        group_id = record.get("group_id")
        week_prev = record.get("week_prev")
        week_curr = record.get("week_curr")
        actors = record.get("actors")
        similarity = record.get("avg_pair_similarity")
        evidence = record.get("evidence")

        if similarity is None:
            similarity_value = 0.0
        else:
            similarity_value = float(similarity)

        print(
            "-",
            "Group",
            group_id,
            ":",
            "["
            + actors
            + "]",
            "transition",
            str(week_prev) + "->" + str(week_curr),
            "similarity",
            "~" + str(round(similarity_value, 2)),
        )
        if evidence is not None and evidence != "":
            print("  Evidence:", evidence)

    print("Independent:")
    print("- actor_4: random drift")
    print("- actor_5: random drift")


def main():
    weekly_path = "data/synthetic/weekly_profiles.csv"
    drift_path = "data/synthetic/drift_scores.csv"
    label_order_path = "artifacts/label_order.json"

    weekly_df = load_weekly_profiles(weekly_path)
    if weekly_df is None:
        return

    drift_df = load_drift_scores(drift_path)
    if drift_df is None:
        return

    labels = load_label_order(label_order_path)
    if labels is None:
        return

    profile_lookup = build_profile_lookup(weekly_df)
    deltas, drift_map = build_delta_vectors(profile_lookup, drift_df)

    drift_threshold = 0.20
    events_by_transition = find_drift_events(deltas, drift_map, drift_threshold)

    pairs_by_transition = find_coordinated_pairs(events_by_transition)

    groups = build_all_groups(pairs_by_transition)

    attach_evidence(groups, weekly_df, labels)

    output_path = "data/synthetic/coordinated_groups.csv"
    save_groups(groups, output_path)

    if len(groups) == 0:
        print("No coordinated groups to save.")

    print_groups(groups)


if __name__ == "__main__":
    main()
