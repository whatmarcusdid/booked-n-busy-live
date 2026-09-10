/**
 * Integration test script for the complete audit flow
 * Run with: npx tsx scripts/test-audit-flow.ts
 */

import { createAudit } from "../lib/services/audit-service";
import { processMockAudit } from "../lib/services/mock-audit-processor";
import { getAuditStatus } from "../lib/services/audit-status-service";
import type { AuditSubmission } from "../lib/schemas/audit-submission";

// Set environment to development without assigning the read-only NODE_ENV type.
const env = process.env as { NODE_ENV?: string };
env.NODE_ENV = "development";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testAuditFlow() {
  console.log("🧪 Testing Complete Audit Flow\n");

  // Step 1: Create audit submission
  console.log("1️⃣  Creating audit submission...");
  const submission: AuditSubmission = {
    websiteUrl: "example.com",
    businessName: "Test Business Inc",
    firstName: "John",
    email: "john@testbusiness.com",
    trade: "Plumbing",
    serviceArea: "New York, NY",
    phone: "555-1234",
    primaryConcern: "Not getting enough leads",
    consent: {
      reportDelivery: true,
      followUp: true,
    },
    attribution: {
      utmSource: "test",
      utmCampaign: "integration-test",
    },
  };

  const result = await createAudit(submission, "https://example.com");

  if ("error" in result) {
    console.error("❌ Failed to create audit:", result.error);
    return;
  }

  console.log(`✅ Audit created: ${result.auditId}`);
  console.log(`   Status URL: ${result.statusUrl}`);
  console.log(`   Duplicate: ${result.duplicate}\n`);

  // Extract token from status URL
  const token = result.statusUrl.split("/").pop()!;

  // Step 2: Check initial status
  console.log("2️⃣  Checking initial status...");
  const initialStatus = await getAuditStatus(token);

  if ("error" in initialStatus) {
    console.error("❌ Failed to get status:", initialStatus.error);
    return;
  }

  console.log(`✅ Status: ${initialStatus.status}`);
  console.log(
    `   Progress: ${initialStatus.progress.percentage}% - ${initialStatus.progress.currentStep}\n`,
  );

  // Step 3: Trigger mock processing
  console.log("3️⃣  Starting mock processing...");
  const processingPromise = processMockAudit(result.auditId);

  // Step 4: Poll for status updates
  console.log("4️⃣  Polling for updates...\n");

  let attempts = 0;
  const maxAttempts = 30;
  let finalStatus: any;

  while (attempts < maxAttempts) {
    await sleep(1000);
    attempts++;

    const status = await getAuditStatus(token);

    if ("error" in status) {
      console.error("❌ Error during polling:", status.error);
      break;
    }

    console.log(
      `   [${attempts}] ${status.status.padEnd(20)} ${status.progress.percentage}% - ${status.progress.currentStep}`,
    );

    if (status.status === "complete") {
      finalStatus = status;
      break;
    }
  }

  // Wait for processing to complete
  await processingPromise;

  // Step 5: Verify final status
  console.log("\n5️⃣  Verifying completion...");

  if (!finalStatus) {
    console.error("❌ Processing did not complete in time");
    return;
  }

  console.log(`✅ Status: ${finalStatus.status}`);
  console.log(`   Completed at: ${finalStatus.completedAt}`);

  if (finalStatus.report) {
    console.log(`   Overall Score: ${Math.round(finalStatus.report.overallScore * 100)}%`);
    console.log(
      `   Publication Status: ${finalStatus.report.publicationStatus}`,
    );

    if (finalStatus.report.pillars) {
      console.log("\n   📊 Pillar Scores:");
      for (const pillar of finalStatus.report.pillars) {
        const score = Math.round(pillar.score * 100);
        console.log(`      ${pillar.name}: ${score}%`);
      }
    }

    if (finalStatus.report.topRecommendations) {
      console.log("\n   💡 Top Recommendations:");
      for (const rec of finalStatus.report.topRecommendations) {
        console.log(
          `      [${rec.priority.toUpperCase()}] ${rec.title}`,
        );
      }
    }
  }

  console.log("\n✨ Integration test completed successfully!");
}

// Run the test
testAuditFlow().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});
