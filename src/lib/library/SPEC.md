---
id: langlo-library
type: module-design
status: draft
title: Library Reader Modules
parent: langlo-lib
tags: [library, reader]
---

## Responsibility

Render stored reading material in the browser and provide shared text operations for pagination, sentence context, selection and saved-term highlighting. Reader adapters support extracted text and original PDF, DOCX and EPUB files.

## Boundary

- These modules own display, navigation and selection behavior; document ownership, upload parsing, progress persistence and optional AI requests belong to the server-side feature described in [`langlo-library-services`](../../../docs/library-services.md).
- Browser readers receive extracted text or an owner-authorized original file from routes. They do not open the database or hold provider credentials.
- Selection/context helpers pass bounded reading context to the route; they do not decide whether a remote request is authorized or available.
