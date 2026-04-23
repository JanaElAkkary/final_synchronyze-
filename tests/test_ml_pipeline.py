import json
import os
import subprocess
import sys

from packages.intelligence_core.preprocessing import preprocess_text
from src.ml.analysis_pipeline import AnalysisPipeline


def test_preprocess_removes_url():
    text = "Visit https://example.com for more information."
    cleaned = preprocess_text(text)
    assert "http" not in cleaned


def test_pipeline_predict_text_shape():
    pipeline = AnalysisPipeline()
    text = "The stock market reacted to the new policy announcement."
    result = pipeline.predict_text(text)

    assert "predicted_label" in result
    assert "confidence" in result
    assert "topic_vector" in result

    topic_vector = result["topic_vector"]
    assert isinstance(topic_vector, list)
    assert len(topic_vector) == 4

    confidence = result["confidence"]
    assert confidence >= 0.0
    assert confidence <= 1.0


def cosine_distance(a, b):
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
    distance = 1.0 - similarity
    return distance


def test_cosine_distance_range():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    d1 = cosine_distance(a, b)
    assert d1 >= 0.0
    assert d1 <= 2.0

    a2 = [1.0, 1.0]
    b2 = [1.0, 1.0]
    d2 = cosine_distance(a2, b2)
    assert d2 >= 0.0
    assert d2 <= 2.0

    a3 = [1.0, -1.0]
    b3 = [-1.0, 1.0]
    d3 = cosine_distance(a3, b3)
    assert d3 >= 0.0
    assert d3 <= 2.0


def test_coordination_output_file_exists():
    command = [sys.executable, "scripts/detect_coordination.py"]
    subprocess.run(command, check=True)

    output_path = os.path.join("data", "synthetic", "coordinated_groups.csv")
    assert os.path.exists(output_path)

