from datasets import load_dataset
from pathlib import Path

base = Path("data/new/tweeteval")
base.mkdir(parents=True, exist_ok=True)

tasks = [
    "emoji",
    "emotion",
    "hate",
    "irony",
    "offensive",
    "sentiment",
    "stance_abortion",
    "stance_atheism",
    "stance_climate",
    "stance_feminist",
    "stance_hillary",
]

for task in tasks:
    ds = load_dataset("cardiffnlp/tweet_eval", task)
    task_dir = base / task
    task_dir.mkdir(parents=True, exist_ok=True)

    for split, split_ds in ds.items():
        split_ds.to_csv(str(task_dir / f"{split}.csv"), index=False)

print("TweetEval downloaded.")