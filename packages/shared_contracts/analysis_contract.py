import json
import os


current_dir = os.path.dirname(os.path.abspath(__file__))
packages_dir = os.path.dirname(current_dir)
project_root = os.path.dirname(packages_dir)
label_order_path = os.path.join(project_root, "artifacts", "label_order.json")

LABEL_ORDER = []

if os.path.exists(label_order_path):
    with open(label_order_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        cleaned = []
        for item in data:
            if isinstance(item, str):
                cleaned.append(item)
            else:
                cleaned.append(str(item))
        LABEL_ORDER = cleaned
else:
    print("Label order file not found:", label_order_path)


def make_analysis_result(clean_text, predicted_label, confidence, topic_vector, model_version):
    result = {}
    if isinstance(clean_text, str):
        result["clean_text"] = clean_text
    else:
        result["clean_text"] = str(clean_text)

    if isinstance(predicted_label, str):
        result["predicted_label"] = predicted_label
    else:
        result["predicted_label"] = str(predicted_label)

    try:
        confidence_value = float(confidence)
    except Exception:
        confidence_value = 0.0
    result["confidence"] = confidence_value

    vector_list = []
    if isinstance(topic_vector, list):
        for value in topic_vector:
            try:
                number = float(value)
            except Exception:
                number = 0.0
            vector_list.append(number)
    result["topic_vector"] = vector_list

    if isinstance(model_version, str):
        result["model_version"] = model_version
    else:
        result["model_version"] = str(model_version)

    return result


def validate_analysis_result(result_dict):
    if not isinstance(result_dict, dict):
        return False

    required_keys = [
        "predicted_label",
        "confidence",
        "topic_vector",
        "model_version",
        "clean_text",
    ]

    for key in required_keys:
        if key not in result_dict:
            return False

    predicted_label = result_dict["predicted_label"]
    confidence = result_dict["confidence"]
    topic_vector = result_dict["topic_vector"]
    model_version = result_dict["model_version"]
    clean_text = result_dict["clean_text"]

    if not isinstance(predicted_label, str):
        return False
    if not isinstance(model_version, str):
        return False
    if not isinstance(clean_text, str):
        return False

    try:
        confidence_value = float(confidence)
    except Exception:
        return False

    if confidence_value < 0.0 or confidence_value > 1.0:
        return False

    if not isinstance(topic_vector, list):
        return False

    if len(LABEL_ORDER) == 0:
        return False

    if len(topic_vector) != len(LABEL_ORDER):
        return False

    found_label = False
    for label in LABEL_ORDER:
        if predicted_label == label:
            found_label = True
            break
    if not found_label:
        return False

    for value in topic_vector:
        try:
            float(value)
        except Exception:
            return False

    return True

