import type { CloudFeature } from "../cloud-features";

const AUTH_PATTERNS =
  /\b(?:sign[\s-]?in|sign[\s-]?up|log[\s-]?in|log[\s-]?out|sign[\s-]?out|authentication|better[\s-]?auth|oauth|passkeys?|magic[\s-]?link|password[\s-]?reset|forgot[\s-]?password|user\s+accounts?|create\s+an?\s+account|register\s+an?\s+account|member\s+portal|client\s+portal|private\s+workspace|multi[\s-]?tenant|role[\s-]?based|user\s+profiles?)\b/i;

const STORAGE_PATTERNS =
  /\b(?:file\s+uploads?|image\s+uploads?|media\s+uploads?|avatar\s+uploads?|attachment\s+uploads?|upload(?:ing|s)?\s+(?:(?:a|an|the|your|their|user|client|project|design|profile|cover|inline|custom|multiple)\s+){0,3}(?:files?|images?|photos?|pictures?|avatars?|media|documents?|pdfs?|videos?|audio|assets?|previews?|deliverables?|attachments?|logos?|invoices?|receipts?|banners?|covers?|thumbnails?)|drag[\s-]?(?:and|&)[\s-]?drop\s+uploads?|dropzone|object\s+storage|s3\s+bucket|media\s+library|storage\s+usage)\b/i;

const EMAIL_POSITIVE_PATTERNS =
  /\b(?:send(?:ing)?\s+(?:transactional\s+|verification\s+|welcome\s+|invite\s+|notification\s+|reset\s+)?emails?|transactional\s+emails?|email\s+notifications?|email\s+invites?|email\s+digests?|email\s+alerts?|verify\s+email|email\s+verification|newsletter\s+broadcasts?|resend\s+api)\b/i;

const EMAIL_NEGATED_PATTERNS =
  /\b(?:no\s+email(?:\s+verification|\s+sending|\s+integration|\s+delivery)?|without\s+(?:using\s+|sending\s+)?emails?(?:\s+or\s+email\s+verification)?|skip\s+email|do\s+not\s+(?:use|send)\s+emails?|don't\s+(?:use|send)\s+emails?)\b/i;

const DATABASE_PATTERNS =
  /\b(?:postgres(?:ql)?|neon\s+db|drizzle|sql\s+database|persistent\s+(?:data|storage|database)|crud\b|create,\s*edit,\s*(?:search,\s*)?(?:filter,\s*)?(?:and\s+)?delete|save\s+(?:to|in)\s+(?:a\s+|the\s+)?database|share\s+links?|sharetoken|public\s+(?:read[\s-]?only\s+)?(?:review|share)\s+links?|crm\b|kanban|issue\s+tracker|project\s+tracker|inventory\s+management|booking\s+system|reservation\s+system|e[\s-]?commerce|job\s+board|applicant\s+tracking|invoice\s+(?:builder|manager|portal)|expense\s+tracker|habit\s+tracker|client\s+portal|deliverable\s+portal|saas\s+(?:app|dashboard|platform))\b/i;

const PURE_STATIC_HINT =
  /^\s*(?:build|create|make|design)\s+(?:a\s+|an\s+)?(?:simple\s+|clean\s+|minimal\s+)?(?:landing\s+page|portfolio\s+page|marketing\s+site|calculator|unit\s+converter|pomodoro\s+timer|stopwatch|clock|tic[\s-]?tac[\s-]?toe|snake\s+game|2048\s+game|color\s+picker)\b/i;

/**
 * Infers which Cognix Cloud capabilities a user's prompt clearly requires so `runAgent`
 * can provision Database, Auth, and Storage *before* Turn 0 (v0-style zero-pause readiness)
 * whenever automatic Cloud provisioning is enabled on the server.
 */
export function inferPromptCloudFeatures(prompt: string): CloudFeature[] {
  const text = prompt.trim();
  if (!text) return [];

  const needsAuth = AUTH_PATTERNS.test(text);
  const needsStorage = STORAGE_PATTERNS.test(text);
  const emailNegated = EMAIL_NEGATED_PATTERNS.test(text);
  const needsEmail = !emailNegated && EMAIL_POSITIVE_PATTERNS.test(text);
  const needsDbExplicit = DATABASE_PATTERNS.test(text);

  if (!needsAuth && !needsStorage && !needsEmail && !needsDbExplicit) {
    return [];
  }

  // Guard against a purely static landing page that casually says "sign up button" without real app behavior
  if (PURE_STATIC_HINT.test(text) && !needsStorage && !needsDbExplicit && !/\b(?:password|session|account|database|workspace|dashboard)\b/i.test(text)) {
    return [];
  }

  const features = new Set<CloudFeature>();
  if (needsDbExplicit || needsAuth || needsStorage) {
    features.add("database");
  }
  if (needsAuth) {
    features.add("auth");
  }
  if (needsStorage) {
    features.add("storage");
  }
  if (needsEmail) {
    features.add("email");
  }

  return [...features];
}
