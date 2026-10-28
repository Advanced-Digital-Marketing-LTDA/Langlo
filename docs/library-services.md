---
id: langlo-library-services
type: submodule-design
status: draft
title: Learner Library Services
parent: langlo-server
tags: [library, services]
references: [langlo-library]
---

## Responsibility

Provide owner-scoped document ingestion, storage, reading progress and vocabulary actions for the private learner Library. Routes use server services for document access and optional contextual translation or lookup.

## Boundary

- Upload accepts TXT, text-based PDF, DOCX, and EPUB up to 10,000,000 bytes. Extracted text is stored; original bytes are retained only for PDF/DOCX/EPUB, owner-scoped, and deleted with the document/account. TXT source bytes are not retained. `GET /app/api/library/{id}/file` returns the owner’s original as `application/octet-stream` with `nosniff` and sandbox CSP. OCR and remote assets are disabled; unreadable and image-only PDFs are rejected. There is no application-level extracted-character ceiling.
- Parsing is resource-bounded: at most two parser workers run concurrently per Node.js process; each has 128 MiB old-generation and a 4 MiB stack limit. The parser worker aborts after 15 seconds, and the parent terminates it after 20 seconds. For archive-based formats, fixed parser limits are 20 MiB of decompressed data, 5,000 ZIP entries, and 200,000 XML elements. `officeparser` treats table-cell and repeated-content settings as size-scaled base allowances: 250,000 cells plus one per input byte, and 2,000,000 repeated characters plus 16 per input byte. At the 10,000,000-byte upload limit, these allowances can reach 10.25 million cells and 162 million characters. PDF parsing requests a separate Node process; its configured 128 MiB is a V8 old-space limit, not a total-process memory cap. If the runtime cannot start a subprocess, `officeparser` warns and falls back to in-process parsing, where its `maxTimeMs` CPU-time budget does not apply. The PDF settings are bases: 20,000 text items plus one per file byte, 100,000 operators plus four per file byte, and 5,000 ms plus 20 ms per KiB. The application's worker abort and parent termination are separate bounds; these package allowances do not imply an extracted-character ceiling.
- Every document read, original-file read, progress update, and deletion is scoped to the authenticated learner. Progress locations are at most 512 characters and NUL-free: EPUB locations must start with `epubcfi(`; TXT/PDF/DOCX positions must match `page:[1-9]\d{0,8}`. A finite fraction in `[0,1]` is required. The location and `CAST(fraction * sentence_count AS INTEGER)` progress index are stored; the fraction is not.
- Library AI requests include only the selected sentence, its adjacent sentences, and the selected term for lookup—not the saved document. The serialized context is capped at 16,000 JavaScript string code units; each supplied sentence is capped at 2,000 characters and lookup terms at 256. Both `OPENAI_API_KEY` and `TYPESAFE_API_KEY` are required. A local injection-pattern check runs first, then TypeSafe Jev preflight; probability `>= 0.5` blocks the OpenAI call, and a failed preflight fails closed. There is no skipped guard or provider fallback. Passing requests use `gpt-6-luna`, low reasoning, and `store: false`.
- Quotas are 100 calls per learner and 1,000 globally per UTC day. A reservation is made before provider calls; local pattern blocks and Jev outages release it, while Jev flags and OpenAI attempts—including failed attempts—consume it. Old usage rows are cleaned after 30 days. Saving vocabulary creates an owner-scoped native flashcard draft in a same-language deck; it does not approve or schedule the card. Local fixture tests and mocked-provider checks do not establish production database, deployment, live-provider, or provider-quality acceptance. Real-device touch behavior and large-book acceptance remain open.
