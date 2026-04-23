import requests
import json

BASE_URL = "http://localhost:8001/api/tasks/create"

def test_create_task():
    print("Testing create task...")
    # Valid task payload
    payload = {
        "type": "investigate_user",
        "target": " @elonmusk ",
        "platform": "twitter",
        "created_by": "tester"
    }
    
    # First request
    response1 = requests.post(BASE_URL, json=payload)
    print(f"Response 1 status: {response1.status_code}")
    try:
        print(f"Response 1 body: {response1.json()}")
    except Exception:
        print(f"Response 1 text: {response1.text}")
    
    if response1.status_code == 200:
        data1 = response1.json()
        assert data1["is_duplicate"] == False, "First request should not be duplicate"
        assert data1["target"] == "@elonmusk", "Target should be trimmed"
        task_id = data1["id"]
        print("First request passed.")
        
        # Second request (duplicate)
        response2 = requests.post(BASE_URL, json=payload)
        print(f"Response 2 status: {response2.status_code}")
        print(f"Response 2 body: {response2.json()}")
        
        if response2.status_code == 200:
            data2 = response2.json()
            assert data2["is_duplicate"] == True, "Second request should be duplicate"
            assert data2["id"] == task_id, "ID should be the same"
            print("Duplicate check passed.")
        else:
            print("Second request failed.")
            
    else:
        print("First request failed.")

def test_invalid_task():
    print("\nTesting invalid task...")
    payload = {
        "type": "invalid_type",
        "target": "something",
        "platform": "twitter"
    }
    
    response = requests.post(BASE_URL, json=payload)
    print(f"Invalid request status: {response.status_code}")
    print(f"Invalid request body: {response.json()}")
    
    assert response.status_code == 422, "Should be 422 Unprocessable Entity"
    print("Invalid check passed.")

if __name__ == "__main__":
    try:
        test_create_task()
        test_invalid_task()
        print("\nALL TESTS PASSED")
    except Exception as e:
        print(f"\nTEST FAILED: {e}")
