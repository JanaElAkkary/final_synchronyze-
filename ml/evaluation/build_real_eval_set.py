"""Build a real-post baseline evaluation CSV from the local scraped posts DB.

This script is intentionally conservative: it only keeps real scraped text,
filters obvious junk/empty/off-topic rows, then assigns a draft label with
keyword rules so the CSV can be manually reviewed before metrics are trusted.
"""

from __future__ import annotations

import csv
import html
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "app" / "db.sqlite3"
OUT_PATH = ROOT / "ml" / "evaluation" / "data" / "baseline_eval_set.csv"
REAL_SOURCE_FILES = (
    ROOT / "data" / "new" / "twitter_test.csv",
)

LABELS = (
    "Politics & Governance",
    "Technology & Cyber",
    "Society & Health",
    "Economy & Business",
)

TARGET_PER_LABEL = 60


KEYWORDS = {
    "Politics & Governance": (
        "parliament", "government", "governance", "election", "elections",
        "policy", "regulatory", "regulation", "congress", "senate",
        "president", "minister", "supreme court", "ofcom", "referendum",
        "redistricting", "protest", "protests", "democracy", "anti-democracy",
        "net neutrality", "fcc", "labor", "labour", "union", "unions",
        "hezbollah", "israel", "lebanon", "gaza", "ukraine", "russia",
        "china", "iran", "border", "military", "national security",
        "law", "laws", "legal", "public administration", "citizens",
        "crime", "racism", "injury racial", "prison", "mps", "campaign",
        "vote", "voters", "mayor", "council", "court", "resign",
    ),
    "Technology & Cyber": (
        "cybersecurity", "phishing", "mfa", "fake it reset", "password",
        "reset links", "ai", "artificial intelligence", "machine learning",
        "claude", "grok", "copilot",
        "github", "open source", "framework", "html to mp4", "hyperframes",
        "perplexity", "computer", "mac app", "android", "app store",
        "software", "developer", "developers", "api", "mcp", "server",
        "gpu", "data center", "data centre", "database", "cloud computing",
        "5g", "telecom", "blockchain", "crypto", "bitcoin",
        "ethereum", "web3", "website", "page speed", "wp rocket",
        "dream machine", "tripo ai", "heygen", "robotics",
        "image recognition", "ad fraud", "automation",
    ),
    "Society & Health": (
        "health", "cancer", "covid", "nanoplastics", "body", "organ",
        "treatment", "patient", "patients", "pharma", "medicine",
        "hospital", "mental", "wellbeing", "well-being", "school",
        "students", "university", "education", "undergraduate", "visit day",
        "culture", "cultural", "festival", "artists", "women artists",
        "workshop", "photography", "photo marathon", "volunteers",
        "visitor centre", "community", "family", "families", "children",
        "public", "forest", "environment", "sustainability", "co2",
        "emissions", "garden", "gardens", "book", "books", "literature",
        "museum", "exhibition", "heritage", "climate", "nature",
        "conference", "grant", "grants", "sports", "festival",
    ),
    "Economy & Business": (
        "economy", "economic", "business", "businesses", "markets",
        "market", "investment", "investors", "revenue", "profit",
        "profits", "growth", "inflation", "interest rates", "federal reserve",
        "fed", "fomc", "rates", "jobs", "employment", "wage", "wages",
        "supply chain", "trade", "tariff", "tariffs", "bank", "banks",
        "credit", "lending", "loan", "paytm", "jio", "amazon",
        "alibaba", "lazada", "apple", "app publishers", "ad spending",
        "advertising", "media spend", "warehouse", "warehouses",
        "company", "companies", "startup", "startups", "sale", "sales",
        "price", "prices", "subscription", "subscribe", "commission",
        "commissions", "real estate", "development", "property",
        "hotel", "restaurants", "workspace", "office", "funded",
        "grant", "grants", "us $", "$", "million", "billion",
    ),
}

JUNK_PATTERNS = (
    r"^no_text\b",
    r"^\s*(interesting|yes|seriously|thank you|try|up|wc|ncb|automatic)\s*[!.]*\s*$",
    r"^\s*[:;()<>/\\|.,#@!?\-–—_]+\s*$",
    r"^\s*(💗|💖|💞|🫶|🤍|🪐|♥️|🌸|✨)+\s*$",
    r"^\s*rt @[^:]+:\s*$",
)

OFF_TOPIC_HINTS = (
    "my happy place", "what do you think", "good afternoon", "eid photo dump",
    "matcha and gossip", "slow mornings", "ordinary day", "morning routine",
    "la vie en rose", "b&w", "anyone seen john", "scattered clouds",
    "mild and sunny winter days", "clouds over the red sea", "rain or shine",
    "full moon", "pedestrian", "station", "blooming days", "spring is here",
)


@dataclass(frozen=True)
class Candidate:
    post_id: int
    platform: str
    platform_post_id: str
    url: str
    text: str
    label: str
    score: int
    notes: str


def clean_text(text: str | None) -> str:
    if not text:
        return ""
    text = text.replace("\x00", " ")
    if "\\u" in text:
        text = re.sub(
            r"\\u([0-9a-fA-F]{4})",
            lambda match: chr(int(match.group(1), 16)),
            text,
        )
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_junk(text: str) -> bool:
    if len(text) < 25:
        return True
    if len(text) > 500:
        return True
    lower = text.lower()
    if any(re.search(pattern, lower, flags=re.I) for pattern in JUNK_PATTERNS):
        return True
    if any(hint in lower for hint in OFF_TOPIC_HINTS):
        return True
    if lower.startswith("no_text |"):
        return True
    alnum = sum(ch.isalnum() for ch in text)
    return alnum < max(12, len(text) * 0.25)


def keyword_score(text: str, label: str) -> int:
    lower = text.lower()
    score = 0
    for kw in KEYWORDS[label]:
        if len(kw) <= 4 and kw.replace("+", "").replace("#", "").isalnum():
            matched = re.search(rf"(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])", lower)
        else:
            matched = kw in lower
        if matched:
            score += 2 if " " in kw else 1
    return score


def choose_label(text: str) -> tuple[str | None, int]:
    scores = {label: keyword_score(text, label) for label in LABELS}
    label, score = max(scores.items(), key=lambda item: item[1])
    if score <= 0:
        return None, 0

    sorted_scores = sorted(scores.values(), reverse=True)
    if len(sorted_scores) > 1 and sorted_scores[0] == sorted_scores[1]:
        # Ambiguous rows are excluded from the baseline eval set.
        return None, 0
    return label, score


def source_type_for(platform: str) -> str:
    if platform in {"twitter", "reddit", "instagram"}:
        return "social_media"
    return "scraped_web"


def load_candidates() -> list[Candidate]:
    candidates: list[Candidate] = []
    seen_texts: set[str] = set()

    def add_candidate(
        *,
        source_id: int,
        platform: str,
        platform_post_id: str,
        url: str,
        text: str,
        source_note: str,
    ) -> None:
        text = clean_text(text)
        if is_junk(text):
            return
        text_key = re.sub(r"\W+", "", text.lower())[:300]
        if text_key in seen_texts:
            return
        seen_texts.add(text_key)

        label, score = choose_label(text)
        if not label:
            return

        notes = f"real row; platform={platform}; source={source_note}; draft_keyword_label"
        candidates.append(
            Candidate(
                post_id=source_id,
                platform=platform,
                platform_post_id=platform_post_id,
                url=url,
                text=text,
                label=label,
                score=score,
                notes=notes,
            )
        )

    if DB_PATH.exists():
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            select id, platform, platform_post_id, url, raw_text
            from posts
            where raw_text is not null
            order by id
            """
        ).fetchall()
        for row in rows:
            add_candidate(
                source_id=row["id"],
                platform=row["platform"],
                platform_post_id=row["platform_post_id"] or f"post_{row['id']}",
                url=row["url"] or "",
                text=row["raw_text"],
                source_note=f"db.posts:{row['id']}",
            )

    next_source_id = 1_000_000
    for source_file in REAL_SOURCE_FILES:
        if not source_file.exists():
            continue
        platform_guess = "reddit" if "reddit" in source_file.name.lower() else "twitter"
        with source_file.open("r", newline="", encoding="utf-8-sig", errors="replace") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                text = row.get("text") or row.get("raw_text") or row.get("body") or ""
                platform = (row.get("platform") or platform_guess).strip().lower()
                add_candidate(
                    source_id=next_source_id,
                    platform=platform,
                    platform_post_id=row.get("id") or row.get("platform_post_id") or f"{platform}_{next_source_id}",
                    url=row.get("url") or "",
                    text=text,
                    source_note=f"{source_file.relative_to(ROOT)}:{next_source_id}",
                )
                next_source_id += 1

    return candidates


def build_eval_rows(candidates: list[Candidate]) -> list[dict[str, str]]:
    buckets: dict[str, list[Candidate]] = {label: [] for label in LABELS}
    for candidate in candidates:
        buckets[candidate.label].append(candidate)

    rows: list[dict[str, str]] = []
    for label in LABELS:
        ranked = sorted(
            buckets[label],
            key=lambda c: (-c.score, len(c.text), c.post_id),
        )
        for candidate in ranked[:TARGET_PER_LABEL]:
            rows.append(
                {
                    "id": f"eval_{len(rows) + 1:03d}",
                    "text": candidate.text,
                    "true_label": candidate.label,
                    "source_type": source_type_for(candidate.platform),
                    "notes": candidate.notes,
                }
            )
    return rows


def main() -> None:
    candidates = load_candidates()
    rows = build_eval_rows(candidates)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["id", "text", "true_label", "source_type", "notes"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"wrote={len(rows)} path={OUT_PATH}")
    for label in LABELS:
        print(f"{label}: {sum(1 for row in rows if row['true_label'] == label)}")
    if len(rows) < TARGET_PER_LABEL * len(LABELS):
        print("warning=not enough high-confidence real scraped rows for all labels")


if __name__ == "__main__":
    main()
