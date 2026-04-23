import os
import random
from datetime import datetime, timedelta

import pandas as pd


def load_training_data(path):
    if not os.path.exists(path):
        print("Training data not found:", path)
        return None
    print("Loading training data from:", path)
    df = pd.read_csv(path)
    print("Loaded rows:", len(df))
    return df


def build_topic_buckets(df):
    buckets = {
        "Politics & Governance": [],
        "Economy & Business": [],
        "Technology & Cyber": [],
        "Society & Health": [],
    }

    has_clean = "clean_text" in df.columns
    has_text = "text" in df.columns

    for index, row in df.iterrows():
        topic = row.get("osint_topic")
        if topic not in buckets:
            continue

        text_value = None
        if has_clean and not pd.isna(row["clean_text"]):
            text_value = row["clean_text"]
        elif has_text and not pd.isna(row["text"]):
            text_value = row["text"]

        if text_value is None:
            continue

        if not isinstance(text_value, str):
            text_value = str(text_value)

        buckets[topic].append(text_value)

    for topic in buckets:
        print("Bucket", topic, "size:", len(buckets[topic]))

    return buckets


def get_actor_week_distribution(actor, week_index):
    politics = "Politics & Governance"
    economy = "Economy & Business"
    technology = "Technology & Cyber"
    society = "Society & Health"

    dist = {
        politics: 0.0,
        economy: 0.0,
        technology: 0.0,
        society: 0.0,
    }

    if actor == "actor_1" or actor == "actor_2" or actor == "actor_3":
        if week_index < 4:
            dist[politics] = 0.9
            dist[economy] = 0.1
        else:
            dist[economy] = 0.9
            dist[politics] = 0.1
    elif actor == "actor_4":
        if week_index % 2 == 0:
            dist[politics] = 0.3
            dist[economy] = 0.2
            dist[technology] = 0.3
            dist[society] = 0.2
        else:
            dist[politics] = 0.2
            dist[economy] = 0.3
            dist[technology] = 0.2
            dist[society] = 0.3
    elif actor == "actor_5":
        if week_index % 2 == 0:
            dist[politics] = 0.25
            dist[economy] = 0.25
            dist[technology] = 0.35
            dist[society] = 0.15
        else:
            dist[politics] = 0.35
            dist[economy] = 0.15
            dist[technology] = 0.25
            dist[society] = 0.25
    elif actor == "actor_6":
        dist[technology] = 0.7
        dist[politics] = 0.1
        dist[economy] = 0.1
        dist[society] = 0.1
    elif actor == "actor_7":
        dist[society] = 0.7
        dist[politics] = 0.1
        dist[economy] = 0.1
        dist[technology] = 0.1
    elif actor == "actor_8":
        dist[politics] = 0.25
        dist[economy] = 0.25
        dist[technology] = 0.25
        dist[society] = 0.25

    return dist


def choose_topic(dist):
    r = random.random()
    cumulative = 0.0
    for topic in dist:
        probability = dist[topic]
        cumulative = cumulative + probability
        if r <= cumulative:
            return topic
    last_topic = None
    for topic in dist:
        last_topic = topic
    return last_topic


def choose_text_from_bucket(buckets, topic):
    texts = buckets.get(topic)
    if texts is None or len(texts) == 0:
        for key in buckets:
            if len(buckets[key]) > 0:
                texts = buckets[key]
                topic = key
                break
    if texts is None or len(texts) == 0:
        return ""
    index = random.randint(0, len(texts) - 1)
    return texts[index]


def generate_synthetic_posts(buckets):
    actors = []
    for i in range(1, 9):
        actors.append("actor_" + str(i))

    start_date = datetime(2025, 1, 1)
    weeks = 8
    posts_per_actor_per_week = 20

    rows = []
    posts_per_actor = {}

    for actor in actors:
        posts_per_actor[actor] = 0

    for week_index in range(weeks):
        week_date = start_date + timedelta(days=7 * week_index)
        date_str = week_date.date().isoformat()

        for actor in actors:
            dist = get_actor_week_distribution(actor, week_index)
            for n in range(posts_per_actor_per_week):
                topic = choose_topic(dist)
                text = choose_text_from_bucket(buckets, topic)

                row = {
                    "platform": "synthetic",
                    "actor_handle": actor,
                    "created_at": date_str,
                    "text": text,
                }
                rows.append(row)

                posts_per_actor[actor] = posts_per_actor[actor] + 1

    return rows, posts_per_actor


def save_synthetic_posts(rows, output_path):
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    print("Saved synthetic posts to:", output_path)


def print_summary(rows, posts_per_actor):
    total_rows = len(rows)
    print("Total synthetic posts created:", total_rows)

    print("Posts per actor:")
    for actor in posts_per_actor:
        print(actor, ":", posts_per_actor[actor])

    print("Planned distributions (actor_1 to actor_5):")

    for actor in ["actor_1", "actor_2", "actor_3", "actor_4", "actor_5"]:
        for week_index in range(8):
            dist = get_actor_week_distribution(actor, week_index)
            week_number = week_index + 1
            print("Actor:", actor, "Week:", week_number, "Distribution:", dist)

    print("Example rows:")
    max_examples = 3
    count = 0
    for row in rows:
        print("platform:", row["platform"])
        print("actor_handle:", row["actor_handle"])
        print("created_at:", row["created_at"])
        text = row["text"]
        if not isinstance(text, str):
            text = str(text)
        snippet = text
        if len(snippet) > 120:
            snippet = snippet[:120]
        print("text:", snippet)
        print("---")
        count = count + 1
        if count >= max_examples:
            break


def main():
    random.seed(42)
    input_path = "data/processed/training_clean.csv"
    df = load_training_data(input_path)
    if df is None:
        return

    buckets = build_topic_buckets(df)
    rows, posts_per_actor = generate_synthetic_posts(buckets)
    output_path = "data/synthetic/synthetic_posts.csv"
    save_synthetic_posts(rows, output_path)
    print_summary(rows, posts_per_actor)


if __name__ == "__main__":
    main()
