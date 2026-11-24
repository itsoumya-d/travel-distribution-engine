# Travel Distribution & Flight Aggregation Engine

A robust, high-throughput travel distribution and normalization engine built in TypeScript and Node.js.

## Overview
Connects disparate airline inventory and GDS/NDC providers into a unified, normalized travel distribution API. Provides cursor-based pagination, deterministic offer deduplication, and transactional booking lifecycle management.

## Key Features
- **Provider Offer Normalization:** Unifies multi-carrier flight offer schemas into structured canonical models with cabin class mapping and passenger pricing.
- **Cursor-Based Pagination:** Encodes deterministic pagination tokens with SHA-256 state hashing for large-scale offer search catalogs.
- **Booking Intent State Machine:** Enforces strict idempotency, hold-duration expirations, and status transitions across reservation requests.
- **Validation & Test Coverage:** Exhaustive automated unit and integration tests across Node.js 20 and 22 runtimes.

## Quick Start
```bash
npm install
npm run build
npm test
```
