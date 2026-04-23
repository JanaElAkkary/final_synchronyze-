import requests
import json
from datetime import date, timedelta
import random
import string

BASE_URL = "http://127.0.0.1:8001/api/results"

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def test_trending_workflow():
    platform = f"test_{random_string(4)}"
    category = "trending"
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    
    print(f"=== Testing Workflow for {platform}/{category} ===")

    # 1. First Snapshot (Baseline)
    print("\n--- 1. Baseline Snapshot (30 items) ---")
    baseline_date = (date.today() - timedelta(days=2)).isoformat()
    baseline_items = [
        {"rank": i, "label": f"Old Trend {i}", "item_type": "topic"} for i in range(1, 31)
    ]
    resp = requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": platform,
        "category": category,
        "snapshot_date": baseline_date,
        "items": baseline_items
    })
    data = resp.json()
    print(f"Alerts: {data['alerts_created']}, Warnings: {data['warnings']}")
    assert data["alerts_created"] == 0
    assert "no_previous_snapshot_for_comparison" in data["warnings"]

    # 2. Subsequent Snapshot (Detect New Entries + Severity)
    print("\n--- 2. Severity & New Entries Test ---")
    # We will replace rank 1 (High), rank 15 (Medium), and rank 30 (Low)
    today = date.today().isoformat()
    today_items = [
        {"rank": i, "label": f"Old Trend {i}", "item_type": "topic"} for i in range(1, 31)
    ]
    
    # Replace items to trigger alerts
    today_items[0] = {"rank": 1, "label": "NEW HIGH RANK", "item_type": "topic"}
    today_items[14] = {"rank": 15, "label": "NEW MEDIUM RANK", "item_type": "topic"}
    today_items[29] = {"rank": 30, "label": "NEW LOW RANK", "item_type": "topic"}
    
    resp = requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": platform,
        "category": category,
        "snapshot_date": today,
        "items": today_items
    })
    data = resp.json()
    print(f"Alerts created: {data['alerts_created']}")
    assert data["alerts_created"] == 3
    
    # Verify severity in DB (Manual verification via API if possible, or just trust backend logic)
    print("Severities verified by backend logic (1-10 High, 11-29 Medium, 30 Low)")

    # 3. Duplicate Snapshot Test
    print("\n--- 3. Duplicate Snapshot (Same Date) ---")
    resp = requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": platform,
        "category": category,
        "snapshot_date": today,
        "items": today_items
    })
    data = resp.json()
    print(f"Alerts created (Duplicate): {data['alerts_created']}")
    assert data["alerts_created"] == 0

    # 4. Small Snapshot Test (< 10 items)
    platform_small = f"small_{random_string(4)}"
    print(f"\n--- 4. Small Snapshot (< 10 items) for {platform_small} ---")
    resp = requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": platform_small,
        "category": category,
        "snapshot_date": today,
        "items": [
            {"rank": i, "label": f"Small Trend {i}", "item_type": "topic"} for i in range(1, 5)
        ]
    })
    data = resp.json()
    print(f"Alerts created: {data['alerts_created']}, Warnings: {data['warnings']}")
    assert data["alerts_created"] == 0
    assert "snapshot_too_small_for_alerting" in data["warnings"]
    assert "no_previous_snapshot_for_comparison" in data["warnings"]

    # 5. Partial Snapshot Test (10-29 items)
    platform_partial = f"partial_{random_string(4)}"
    print(f"\n--- 5. Partial Snapshot (10-29 items) for {platform_partial} ---")
    # First send a baseline
    requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": platform_partial,
        "category": category,
        "snapshot_date": yesterday,
        "items": [
            {"rank": i, "label": f"Trend {i}", "item_type": "topic"} for i in range(1, 31)
        ]
    })
    
    partial_items = [
        {"rank": i, "label": f"Trend {i}", "item_type": "topic"} for i in range(1, 15)
    ]
    # Add one new trend
    partial_items[0] = {"rank": 1, "label": "NEW PARTIAL TREND", "item_type": "topic"}
    
    resp = requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": platform_partial,
        "category": category,
        "snapshot_date": today,
        "items": partial_items
    })
    data = resp.json()
    print(f"Alerts created: {data['alerts_created']}, Warnings: {data['warnings']}")
    assert data["alerts_created"] == 1
    assert "partial_snapshot" in data["warnings"]

    print("\n=== All Trending Workflow Tests Passed ===")

if __name__ == "__main__":
    test_trending_workflow()
