import os
import sys


current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.ml.analysis_pipeline import AnalysisPipeline
from packages.shared_contracts.analysis_contract import (
    LABEL_ORDER,
    make_analysis_result,
    validate_analysis_result,
)


def test_pipeline_output_valid_contract():
    pipeline = AnalysisPipeline()
    text = "The central bank announced a new interest rate policy."
    result = pipeline.predict_text(text)
    assert validate_analysis_result(result)


def test_reject_bad_confidence_values():
    if len(LABEL_ORDER) == 0:
        assert False

    clean_text = "sample text"
    predicted_label = LABEL_ORDER[0]

    vector = []
    for i in range(len(LABEL_ORDER)):
        vector.append(0.0)

    bad_high = make_analysis_result(clean_text, predicted_label, 1.5, vector, "v1")
    assert not validate_analysis_result(bad_high)

    bad_low = make_analysis_result(clean_text, predicted_label, -0.1, vector, "v1")
    assert not validate_analysis_result(bad_low)


def test_reject_wrong_topic_vector_length():
    if len(LABEL_ORDER) == 0:
        assert False

    clean_text = "sample text"
    predicted_label = LABEL_ORDER[0]

    vector = []
    for i in range(len(LABEL_ORDER) + 1):
        vector.append(0.0)

    result = make_analysis_result(clean_text, predicted_label, 0.5, vector, "v1")
    assert not validate_analysis_result(result)


def test_reject_missing_keys():
    if len(LABEL_ORDER) == 0:
        assert False

    clean_text = "sample text"
    predicted_label = LABEL_ORDER[0]

    vector = []
    for i in range(len(LABEL_ORDER)):
        vector.append(0.1)

    result = make_analysis_result(clean_text, predicted_label, 0.5, vector, "v1")
    del result["confidence"]

    assert not validate_analysis_result(result)

