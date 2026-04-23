# Baseline Evaluation Report

Rows evaluated: **240**
Average top probability: **0.7060**
Macro F1: **0.6499**
Total accuracy: **0.6750**
Wrong predictions: **78**

## Per-class metrics

| Label | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| Politics & Governance | 0.7470 | 0.8986 | 0.8158 | 69 |
| Technology & Cyber | 0.6452 | 0.3846 | 0.4819 | 52 |
| Society & Health | 0.5474 | 0.8254 | 0.6582 | 63 |
| Economy & Business | 0.9032 | 0.5000 | 0.6437 | 56 |

## Confusion matrix

Rows = true labels, columns = predicted labels.

| True \ Pred | Politics & Governance | Technology & Cyber | Society & Health | Economy & Business |
|---|---:|---:|---:|---:|
| Politics & Governance | 62 | 1 | 5 | 1 |
| Technology & Cyber | 4 | 20 | 26 | 2 |
| Society & Health | 9 | 2 | 52 | 0 |
| Economy & Business | 8 | 8 | 12 | 28 |

## Classification report

```text
                       precision    recall  f1-score   support

Politics & Governance     0.7470    0.8986    0.8158        69
   Technology & Cyber     0.6452    0.3846    0.4819        52
     Society & Health     0.5474    0.8254    0.6582        63
   Economy & Business     0.9032    0.5000    0.6437        56

             accuracy                         0.6750       240
            macro avg     0.7107    0.6521    0.6499       240
         weighted avg     0.7090    0.6750    0.6619       240
```

Top 50 wrong predictions saved to: `.\ml\evaluation\results\top_50_wrong_predictions.csv`