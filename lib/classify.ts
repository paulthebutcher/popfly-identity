// Channel classifier — runs server-side, ordered, first match wins.
// STUB — no implementation until Build Plan Phase 1. Exports RULES_VERSION,
// stamped on every touches row so taxonomy changes reclassify precisely.
// Contract: spec §4, card "Channel classification". Raw params + referrer are
// always stored unmodified alongside derived values — nothing is lossy.
//
// Rule order (DO NOT REORDER — rule 1 before rule 6 is the paid/direct fix):
//    1. gclid | gad_source | gad_campaignid → paid_search / google
//    2. msclkid                             → paid_search / bing
//    3. li_fat_id                           → paid_social / linkedin
//    4. grsf                                → referral_program / growsurf
//    5. utm_medium in {cpc,ppc,paid,paidsocial,display} → paid_* / utm_source
//    6. utm_source or utm_medium present    → map from taxonomy
//    7. referrer host in SEARCH_ENGINES     → organic_search
//    8. referrer host in SOCIAL             → organic_social
//    9. referrer host in AI_SURFACES        → ai_referral
//   10. referrer host in OWNED_DOMAINS      → internal (suppress touch)
//   11. referrer present, no match          → referral
//   12. no referrer, no params              → direct
//   13. else                                → unknown   (kept SEPARATE from direct:
//                                             direct = behavior, unknown = data gap)
//
// Host lists:
//   OWNED_DOMAINS: popfly.com, www.popfly.com, app.popfly.com, guide.popfly.com
//   AI_SURFACES: chatgpt.com, perplexity.ai, claude.ai, gemini.google.com,
//                copilot.microsoft.com
//   android-app:// scheme — new URL().hostname returns the package name; map:
//     com.google.android.gm                    → email
//     com.linkedin.android                     → organic_social
//     com.google.android.googlequicksearchbox  → organic_search
//   (a regex expecting https:// silently drops all of these into unknown)
