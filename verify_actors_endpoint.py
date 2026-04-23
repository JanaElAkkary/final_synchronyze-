import requests
import sys
import time

URL = "http://localhost:8001/api/results/actors"

print(f"Fetching {URL}...")
start_time = time.time()
try:
    response = requests.get(URL, timeout=10)
    elapsed = time.time() - start_time
    print(f"Status Code: {response.status_code}")
    print(f"Elapsed: {elapsed:.2f}s")
    
    if response.status_code == 200:
        data = response.json()
        print(f"Status: {data.get('status')}")
        print(f"Count: {data.get('count')}")
        items = data.get('items', [])
        print(f"Items length: {len(items)}")
        if len(items) > 0:
            print("First item sample:", items[0])
    else:
        print("Error response:", response.text)

except Exception as e:
    print(f"Exception: {e}")
    sys.exit(1)
