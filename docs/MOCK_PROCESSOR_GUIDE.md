# Mock Audit Processor Guide

## Overview

The Mock Audit Processor is a development-only utility that simulates the complete audit processing workflow. It allows you to test the entire audit lifecycle without implementing real crawling, browser automation, AI scoring, or third-party APIs.

⚠️ **FOR DEVELOPMENT USE ONLY** - This utility is automatically disabled in production.

## Features

- Simulates all audit states from `submitted` to `complete`
- Creates realistic mock data for:
  - Audit pages (home, about, services, contact)
  - Evidence (screenshots, lighthouse reports)
  - Criterion results (16 criteria across 4 pillars)
  - Pillar results (visibility, engagement, conversion, trust)
  - Report revision with executive summary
  - Recommendations (up to 3 actionable items)
- Inserts proper state transitions and events
- Sets publication status to `review_required` by default
- Takes ~5 seconds to complete (simulated processing time)

## Usage

### Option 1: Manual Trigger (Recommended for Testing)

Use the development API endpoint:

```bash
# After creating an audit via POST /api/v1/audits
curl -X POST http://localhost:3000/api/dev/process-audit \
  -H "Content-Type: application/json" \
  -d '{"auditId": "your-audit-id-here"}'
```

### Option 2: Programmatic Usage

```typescript
import { processMockAudit } from "@/lib/services/mock-audit-processor";

// In development code only
if (process.env.NODE_ENV === "development") {
  await processMockAudit(auditId);
}
```

### Option 3: Automatic Processing (Future)

Uncomment the TODO in `lib/services/audit-service.ts`:

```typescript
// After audit creation
if (process.env.NODE_ENV === "development") {
  // Trigger mock processing in background
  processMockAudit(auditRecord.audit_id).catch(console.error);
}
```

## Complete Example Workflow

### 1. Submit an Audit

```bash
curl -X POST http://localhost:3000/api/v1/audits \
  -H "Content-Type: application/json" \
  -d '{
    "websiteUrl": "example.com",
    "businessName": "Test Business",
    "firstName": "John",
    "email": "john@example.com",
    "trade": "Plumbing",
    "serviceArea": "New York, NY",
    "consent": {
      "reportDelivery": true
    }
  }'
```

Response:
```json
{
  "auditId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "submitted",
  "statusUrl": "/audit/status/abc123...",
  "duplicate": false
}
```

### 2. Trigger Mock Processing

```bash
curl -X POST http://localhost:3000/api/dev/process-audit \
  -H "Content-Type: application/json" \
  -d '{
    "auditId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

Response:
```json
{
  "message": "Processing started",
  "auditId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 3. Poll for Status

```bash
# Extract token from statusUrl and poll
curl http://localhost:3000/api/v1/audit-status/abc123...
```

The audit will progress through states:
1. `submitted` (initial)
2. `validating` (500ms delay)
3. `discovering` (creates 4 mock pages)
4. `rendering` (creates 2 mock evidence items)
5. `collecting_signals`
6. `scoring` (creates 16 criteria + 4 pillar results)
7. `generating_report` (creates report + 3 recommendations)
8. `validating_report`
9. `complete` (final state)

Total processing time: ~5 seconds

### 4. Check Final Result

Once status is `complete`, the response includes:

```json
{
  "auditId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "complete",
  "progress": {
    "percentage": 100,
    "currentStep": "Report ready!"
  },
  "websiteUrl": "https://example.com",
  "businessName": "Test Business",
  "submittedAt": "2026-09-05T20:00:00Z",
  "completedAt": "2026-09-05T20:00:05Z",
  "report": {
    "overallScore": 0.78,
    "publicationStatus": "review_required",
    "pillars": [
      {
        "key": "visibility",
        "name": "Online Visibility",
        "score": 0.75
      },
      ...
    ],
    "topRecommendations": [
      {
        "priority": "high",
        "title": "Improve Mobile Responsiveness",
        "description": "Your website needs optimization..."
      },
      ...
    ]
  }
}
```

## Mock Data Details

### Pages Created

| URL | Type | Title |
|-----|------|-------|
| {websiteUrl} | home | Home |
| {websiteUrl}/about | about | About Us |
| {websiteUrl}/services | services | Services |
| {websiteUrl}/contact | contact | Contact |

### Evidence Created

1. **Screenshot**: Homepage screenshot (mock)
2. **Lighthouse Report**: Performance metrics with random scores (0.6-0.9)

### Criteria & Scoring

**4 Pillars × 4 Criteria = 16 total criteria**

Each criterion receives:
- Random score: 0.5 - 0.95
- Weight based on importance
- Findings object with passed/failed status
- Mock recommendations

**Pillar Aggregation:**
- Visibility: SEO, Mobile, Speed, Local SEO
- Engagement: Content, Design, Navigation, Media
- Conversion: CTAs, Forms, Paths, Social Proof
- Trust: Professionalism, Credentials, Reviews, Security

### Recommendations

3 recommendations created with:
- Priority: high, high, medium
- Titles and descriptions
- Impact and difficulty estimates
- Linked to specific pillars
- Sort order for display

### Publication Status

All reports default to `review_required`, simulating a human review step before customer delivery.

## Database Schema Reference

The mock processor creates records in these tables:

```
audits (updated)
  └── audit_state_transitions (9 rows)
  └── audit_events (10+ rows)
  └── audit_pages (4 rows)
  └── evidence (2 rows)
  └── criterion_results (16 rows)
  └── pillar_results (4 rows)
  └── report_revisions (1 row)
      └── recommendations (3 rows)
```

## Customization

To modify mock data generation, edit:

- **States & Timing**: `AUDIT_STATES` array and `delay()` calls
- **Pillars & Criteria**: `PILLARS` and `CRITERIA_BY_PILLAR` objects
- **Score Ranges**: `randomScore(min, max)` function
- **Recommendations**: `createMockRecommendations()` function
- **Page Discovery**: `createMockPages()` function

## Production Deployment

The mock processor includes multiple safeguards:

1. **Environment Check**: Throws error if `NODE_ENV === "production"`
2. **Dev Endpoint Block**: `/api/dev/process-audit` returns 403 in production
3. **Manual Trigger**: Requires explicit API call (not automatic)

To replace with real processing:
1. Implement actual workflow (Vercel Workflow, queue, etc.)
2. Remove calls to `processMockAudit()`
3. Connect real crawling, AI, and analysis services
4. Update state transitions based on actual progress

## Troubleshooting

**Processing doesn't start:**
- Check audit exists: Query `audits` table
- Verify current state is not already `complete`
- Check server logs for errors

**Status stuck at one state:**
- Check `audit_state_transitions` table
- Look for errors in server logs
- Verify database connection

**No report data:**
- Ensure processing reached `complete` state
- Check `report_revisions` table
- Verify foreign key relationships

**Missing recommendations:**
- Check `recommendations` table
- Verify `report_revision_id` is set correctly
- Review `sort_order` for display order
