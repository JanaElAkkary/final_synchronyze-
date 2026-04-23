import json
import os
import sys


current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.ml.analysis_pipeline import AnalysisPipeline
from packages.shared_contracts.analysis_contract import validate_analysis_result


def run_smoke_test():
    pipeline = AnalysisPipeline()
    pipeline.ensure_nltk()

    texts = [
        "The government passed a new economic stimulus package.",
        "A major cyber attack affected several international banks.",
        "Hospitals are reporting increased pressure on emergency services.",
    ]

    for text in texts:
        print("Input:", text)
        result = pipeline.predict_text(text)
        print("Result JSON:")
        print(json.dumps(result, indent=2))
        valid = validate_analysis_result(result)
        if valid:
            print("Validation: PASS")
        else:
            print("Validation: FAIL")
        print("---")


if __name__ == "__main__":
    run_smoke_test()

