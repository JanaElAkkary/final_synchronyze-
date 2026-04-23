from src.ml.analysis_pipeline import AnalysisPipeline


pipeline_instance = None


def get_pipeline():
    global pipeline_instance
    if pipeline_instance is None:
        pipeline_instance = AnalysisPipeline()
        pipeline_instance.ensure_nltk()
    return pipeline_instance


def analyze_text(text):
    pipeline = get_pipeline()
    result = pipeline.predict_text(text)
    return result
