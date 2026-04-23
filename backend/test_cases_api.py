import requests
import json
import random
import string

BASE_URL = "http://127.0.0.1:8001/api/results"
AUTH_BASE = "http://127.0.0.1:8001/api"

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def test_cases_api():
    # 1. Register/Login a test analyst
    username = f"analyst_{random_string(4)}"
    password = "password123"
    print(f"=== Testing Cases API for user: {username} ===")
    
    reg_resp = requests.post(f"{AUTH_BASE}/auth/register", json={
        "full_name": "Test Analyst",
        "username": username,
        "password": password
    })
    assert reg_resp.status_code == 200
    
    login_resp = requests.post(f"{AUTH_BASE}/auth/login", json={
        "username": username,
        "password": password
    })
    token = login_resp.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Check Empty Cases
    print("\n--- 1. Empty State ---")
    resp = requests.get(f"{BASE_URL}/cases/me", headers=headers)
    data = resp.json()
    assert data["count"] == 0
    print("Empty state OK")

    # 3. Use an existing actor or create one (simulated via trending/snapshot if needed)
    # Actually, let's just use actor_id 1 if it exists, or create a trending snapshot to spawn one.
    print("\n--- 2. Create Case ---")
    # For test simplicity, we assume actor ID 1 or similar exists in a fresh DB. 
    # If not, let's create a minimal trending snapshot to ensure we have an actor.
    requests.post(f"{BASE_URL}/trending/snapshot", json={
        "platform": "twitter",
        "category": "trending",
        "snapshot_date": "2026-04-19",
        "items": [{"rank": 1, "label": "TestActor", "item_type": "topic"}]
    })
    # Get that actor id
    actors_resp = requests.get(f"{BASE_URL}/actors", headers=headers)
    actors = actors_resp.json()["items"]
    if not actors:
        print("Error: No actors found to create case.")
        return
    actor_id = actors[0]["id"]
    print(f"Using actor_id: {actor_id}")

    # Open Case
    open_resp = requests.post(f"{BASE_URL}/cases/open", headers=headers, json={"actor_id": actor_id})
    case = open_resp.json()
    assert case["actor_id"] == actor_id
    case_id = case["id"]
    print(f"Case created/opened with ID: {case_id}")

    # 4. Test Single Case Detail (THE NEW ENDPOINT)
    print("\n--- 3. Single Case Detail ---")
    detail_resp = requests.get(f"{BASE_URL}/cases/{case_id}", headers=headers)
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["id"] == case_id
    assert detail["actor"]["id"] == actor_id
    print("Single case detail OK")

    # 5. Test Delete Case
    print("\n--- 4. Delete Case ---")
    del_resp = requests.delete(f"{BASE_URL}/cases/{case_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "ok"
    # Verify it's gone
    check_resp = requests.get(f"{BASE_URL}/cases/{case_id}", headers=headers)
    assert check_resp.status_code == 404
    print("Delete case OK")

    # 6. Test Unauthorized Access
    print("\n--- 5. Unauthorized Access ---")
    # Actually, create a NEW case first to try and delete it from another account
    open_resp_2 = requests.post(f"{BASE_URL}/cases/open", headers=headers, json={"actor_id": actor_id})
    case2_id = open_resp_2.json()["id"]

    # Create another user
    u2 = f"analyst_{random_string(4)}"
    requests.post(f"{AUTH_BASE}/auth/register", json={"full_name": "Other", "username": u2, "password": password})
    l2 = requests.post(f"{AUTH_BASE}/auth/login", json={"username": u2, "password": password})
    t2 = l2.json()["token"]
    h2 = {"Authorization": f"Bearer {t2}"}
    
    # Try to access case2 (owned by user 1) with user 2 token
    bad_resp = requests.get(f"{BASE_URL}/cases/{case2_id}", headers=h2)
    assert bad_resp.status_code == 404
    
    # Try to delete case2 (owned by user 1) with user 2 token
    bad_del = requests.delete(f"{BASE_URL}/cases/{case2_id}", headers=h2)
    assert bad_del.status_code == 404
    print("Unauthorized access/delete rejected (404) OK")

    print("\n=== All Cases API Tests Passed ===")

if __name__ == "__main__":
    test_cases_api()
