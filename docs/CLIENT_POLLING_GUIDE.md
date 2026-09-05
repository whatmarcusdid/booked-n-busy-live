# Client Polling Guide for Audit Status

## Overview

The audit status endpoint (`GET /api/v1/audit-status/[token]`) provides real-time progress updates for submitted website audits. This guide explains how client applications should poll this endpoint efficiently.

## Endpoint

```
GET /api/v1/audit-status/{publicStatusToken}
```

## Response Structure

```typescript
interface AuditStatusResponse {
  auditId: string;
  status: AuditState;
  progress: {
    percentage: number; // 0-100
    currentStep: string;
    estimatedTimeRemaining?: string;
  };
  websiteUrl: string;
  businessName: string;
  submittedAt: string;
  completedAt?: string;
  report?: {
    overallScore: number; // 0-1
    publicationStatus: "draft" | "review_required" | "approved" | "published";
    pillars?: Array<{
      key: string;
      name: string;
      score: number;
    }>;
    topRecommendations?: Array<{
      priority: string;
      title: string;
      description: string;
    }>;
  };
}
```

## Audit States

The audit progresses through these states:

1. `submitted` - Initial state
2. `validating` - Checking website accessibility
3. `discovering` - Finding pages and content
4. `rendering` - Capturing screenshots and metrics
5. `collecting_signals` - Analyzing UX signals
6. `scoring` - Calculating scores
7. `generating_report` - Creating the report
8. `validating_report` - Final validation
9. `complete` - **Terminal state** - Processing finished

## Polling Strategy

### Recommended Implementation

```typescript
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_DURATION = 600000; // 10 minutes
const TERMINAL_STATES = ["complete", "failed", "expired"];

async function pollAuditStatus(token: string) {
  const startTime = Date.now();
  let attempts = 0;

  while (true) {
    attempts++;

    // Check timeout
    if (Date.now() - startTime > MAX_POLL_DURATION) {
      throw new Error("Polling timeout exceeded");
    }

    try {
      const response = await fetch(`/api/v1/audit-status/${token}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Audit not found");
        }
        // For other errors, continue polling with backoff
        await sleep(POLL_INTERVAL * Math.min(attempts, 5));
        continue;
      }

      const data = await response.json();

      // Update UI with current status
      updateUI(data);

      // Check if terminal state reached
      if (TERMINAL_STATES.includes(data.status)) {
        return data; // Stop polling
      }

      // Wait before next poll
      await sleep(POLL_INTERVAL);
    } catch (error) {
      console.error("Polling error:", error);
      // Implement exponential backoff for network errors
      await sleep(POLL_INTERVAL * Math.min(attempts, 5));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### Key Points

1. **Poll Interval**: 2 seconds is recommended for a good balance between responsiveness and server load

2. **Terminal States**: Stop polling when `status` is `complete`, `failed`, or `expired`

3. **Error Handling**:
   - 404: Stop polling (audit not found)
   - 5xx: Continue polling with exponential backoff
   - Network errors: Retry with backoff

4. **Timeout**: Set a maximum polling duration (e.g., 10 minutes) to prevent infinite loops

5. **User Feedback**: Always update the UI with:
   - Current progress percentage
   - Current step description
   - Estimated time remaining (when available)

## UI Recommendations

### Progress Indicator

Display a progress bar using `progress.percentage`:

```tsx
<div className="progress-bar">
  <div
    className="progress-fill"
    style={{ width: `${data.progress.percentage}%` }}
  />
</div>
<p>{data.progress.currentStep}</p>
{data.progress.estimatedTimeRemaining && (
  <p className="eta">About {data.progress.estimatedTimeRemaining} remaining</p>
)}
```

### Status Messages

Map states to user-friendly messages:

- `submitted`: "We've received your request"
- `validating`: "Checking your website..."
- `discovering`: "Analyzing your pages..."
- `rendering`: "Capturing insights..."
- `collecting_signals`: "Measuring user experience..."
- `scoring`: "Calculating your scores..."
- `generating_report`: "Creating your report..."
- `validating_report`: "Final touches..."
- `complete`: "Your report is ready!"

### Complete State

When `status === "complete"`, display:

1. Overall score (as a grade or percentage)
2. Pillar scores (if available)
3. Top recommendations preview
4. Link to full report (if published)

## Example React Hook

```typescript
import { useState, useEffect } from "react";

function useAuditStatus(token: string) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(true);

  useEffect(() => {
    let mounted = true;
    let pollTimeout: NodeJS.Timeout;

    async function poll() {
      if (!mounted || !isPolling) return;

      try {
        const response = await fetch(`/api/v1/audit-status/${token}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError("Audit not found");
            setIsPolling(false);
            return;
          }
          throw new Error("Failed to fetch status");
        }

        const data = await response.json();
        setStatus(data);

        // Check if terminal
        const terminal = ["complete", "failed", "expired"].includes(
          data.status,
        );
        if (terminal) {
          setIsPolling(false);
          return;
        }

        // Schedule next poll
        pollTimeout = setTimeout(poll, 2000);
      } catch (err) {
        console.error("Polling error:", err);
        pollTimeout = setTimeout(poll, 5000); // Backoff on error
      }
    }

    poll();

    return () => {
      mounted = false;
      clearTimeout(pollTimeout);
    };
  }, [token, isPolling]);

  return { status, error, isPolling };
}
```

## Security Considerations

1. **No PII Exposure**: The status endpoint never returns email, phone, or other personally identifiable information

2. **Token Security**: The public status token should be:
   - Treated as a semi-sensitive credential
   - Not logged or included in analytics
   - Not shared publicly

3. **Rate Limiting**: Implement client-side rate limiting to avoid excessive requests

## Testing

Test these scenarios:

1. **Invalid token**: Should return 404
2. **In-progress audit**: Should show current state and progress
3. **Complete audit**: Should return report data
4. **Network failure**: Should retry gracefully
5. **Timeout**: Should stop polling after max duration
