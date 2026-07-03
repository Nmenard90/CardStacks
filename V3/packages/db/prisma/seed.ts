/**
 * File: seed.ts
 * Purpose:
 *   Adds default billing plans required by the app.
 *
 * Why this file exists:
 *   The billing schema exists from day one, even before Stripe is live. Seeded
 *   plans make access checks predictable in local development.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Inserts or updates default billing plans.
 *
 * Safety:
 *   This uses upsert so running the seed multiple times is safe.
 */
async function seedPlans() {
  await prisma.plan.upsert({
    where: { code: "FREE" },
    update: { name: "Free", isActive: true },
    create: {
      code: "FREE",
      name: "Free",
      description: "Basic collection tracking.",
      monthlyPriceCents: 0,
      yearlyPriceCents: 0,
      isActive: true
    }
  });

  await prisma.plan.upsert({
    where: { code: "COLLECTOR_PRO" },
    update: { name: "Collector Pro", isActive: true },
    create: {
      code: "COLLECTOR_PRO",
      name: "Collector Pro",
      description: "Advanced collection, binder, price history, and master set tools.",
      monthlyPriceCents: 699,
      yearlyPriceCents: 6999,
      isActive: true
    }
  });

  await prisma.plan.upsert({
    where: { code: "VENDOR_PRO" },
    update: { name: "Vendor Pro", isActive: true },
    create: {
      code: "VENDOR_PRO",
      name: "Vendor Pro",
      description: "Bulk inventory and vendor-oriented tools.",
      monthlyPriceCents: 1499,
      yearlyPriceCents: 14999,
      isActive: true
    }
  });
}

/**
 * Runs every seed task in order.
 */
async function main() {
  await seedPlans();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
