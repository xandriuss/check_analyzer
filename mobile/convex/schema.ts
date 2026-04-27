import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    mode: v.union(v.literal("person"), v.literal("family")),
    role: v.union(v.literal("user"), v.literal("admin")),
    isSubscriber: v.boolean(),
    darkMode: v.boolean(),
    junkExclusions: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_user", ["clerkUserId"]),

  receipts: defineTable({
    clerkUserId: v.string(),
    total: v.number(),
    junkTotal: v.number(),
    wastePercent: v.number(),
    photoUrl: v.optional(v.string()),
    scanUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user_created", ["clerkUserId", "createdAt"]),

  receiptItems: defineTable({
    receiptId: v.id("receipts"),
    name: v.string(),
    price: v.number(),
    isJunk: v.boolean(),
  }).index("by_receipt", ["receiptId"]),

  bugReports: defineTable({
    clerkUserId: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),
});
