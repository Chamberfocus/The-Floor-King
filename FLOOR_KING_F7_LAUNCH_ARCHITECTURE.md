# F7 launch architecture

F7 launch readiness is a **checklist and evidence contract**, not a production go-live of accounting.

## Posting

Posting flags OFF. `posting_enabled` remains false. Do not enable accounting from this file.

## Status of live books

Live general-ledger posting, production cutover, and books-of-record go-live are **NOT CONFIRMED**.

F7 documents what must be true before a later, explicit launch decision. It does not flip posting flags, mutate customer/job/invoice rows, or apply migrations automatically.
