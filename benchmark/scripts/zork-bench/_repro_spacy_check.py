try:
    import spacy
    print("spacy version:", spacy.__version__)
except Exception as e:
    print("spacy import failed:", e)
    import sys; sys.exit(0)

try:
    nlp = spacy.load("en_core_web_sm")
    doc = nlp("One particularly large tree with some low branches stands at the edge of the path.")
    print("nouns:", [(t.text, t.pos_) for t in doc if t.pos_ == "NOUN"])
except Exception as e:
    print("load/parse failed:", repr(e))
