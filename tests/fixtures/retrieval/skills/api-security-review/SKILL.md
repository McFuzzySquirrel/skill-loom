---
name: api-security-review
description: Review an API for security issues.
---

# API security review

Review the service boundary and report concrete findings with file references.

## Authentication

Check how callers prove identity, how sessions or tokens expire, and whether credentials can leak into logs.

## Authorization

Check that every operation enforces the caller's role and project scope, including indirect object references.

## Input validation

Check request size limits, type coercion, injection surfaces, and error messages that reveal internal state.
