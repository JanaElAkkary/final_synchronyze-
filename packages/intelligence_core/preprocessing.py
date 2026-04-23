import re

import nltk
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer


def download_nltk():
    resources = ["punkt", "stopwords", "wordnet", "omw-1.4"]
    for resource in resources:
        nltk.download(resource)


def clean_text(text):
    if text is None:
        return ""
    text = str(text)
    text = text.lower()
    text = re.sub(r"http[s]?://\S+", " ", text)
    text = re.sub(r"www\.\S+", " ", text)
    text = re.sub(r"[^a-z\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.strip()
    return text


def tokenize(text):
    if text is None:
        return []
    tokens = nltk.word_tokenize(text)
    return tokens


def remove_stopwords(tokens):
    stop_words = set(stopwords.words("english"))
    keep_words = ["not", "no", "nor"]
    for word in keep_words:
        if word in stop_words:
            stop_words.remove(word)
    filtered_tokens = []
    for token in tokens:
        if token.lower() not in stop_words:
            filtered_tokens.append(token)
    return filtered_tokens


def lemmatize(tokens):
    lemmatizer = WordNetLemmatizer()
    lemmatized_tokens = []
    for token in tokens:
        lemma = lemmatizer.lemmatize(token)
        lemmatized_tokens.append(lemma)
    return lemmatized_tokens


def preprocess_text(text):
    cleaned = clean_text(text)
    tokens = tokenize(cleaned)
    tokens = remove_stopwords(tokens)
    tokens = lemmatize(tokens)
    result = " ".join(tokens)
    return result


def preprocess_dataset(df, text_col):
    if df is None:
        return None
    cleaned_texts = []
    for index, row in df.iterrows():
        value = None
        if text_col in row:
            value = row[text_col]
        cleaned_value = preprocess_text(value)
        cleaned_texts.append(cleaned_value)
    df_copy = df.copy()
    df_copy["clean_text"] = cleaned_texts
    return df_copy


if __name__ == "__main__":
    download_nltk()
    samples = [
        "This is a simple TEST sentence with a URL: https://example.com.",
        "I do NOT think this is a bad idea, nor is it wrong.",
        "Visit www.example.org now! It's not, no, nor ever going to be boring!!!",
    ]
    for sentence in samples:
        processed = preprocess_text(sentence)
        print("Original:", sentence)
        print("Processed:", processed)
        print("---")
